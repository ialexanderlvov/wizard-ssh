/** Interactive main menu — built on the custom list prompt (filter + Tab-sort +
 *  Esc/«← Назад»). Each navigation step clears the screen and shows a breadcrumb
 *  (with depth indent), so only the active menu is visible. */

import { PromptAbortError } from '../core/errors.js';
import type { Entity, Server, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import * as ui from '../ui/index.js';
import { detailBox } from '../ui/format.js';
import { tr } from '../i18n/index.js';

import { loop, menuChoose } from './menu-kit.js';
import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as actions from './actions.js';
import * as keysCmd from './keys.js';
import * as snippetCmd from './snippets.js';
import * as autostartCmd from './autostart.js';
import { quickConnect } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { importExportMenu } from './import-export.js';
import { backupSshFlow } from './backup.js';

/** Title shown as the root breadcrumb; read lazily so a language switch applies. */
const root = (): string => tr.menu.root;

/** Pick a tag from a pre-scanned inventory, then run `fn` on it. Returns what
 *  the loop() handler needs: `true` (navigation, skip the pause) when the user
 *  backed out of the picker with nothing printed; void when the empty-inventory
 *  warning or the flow's own output is on screen and should be read. The
 *  entities are scanned ONCE and handed to the flow via `pool`, so one menu
 *  action never parses ~/.ssh/config twice. */
async function withTag(
  source: actions.TagSource,
  message: string,
  fn: (tag: string, pool: actions.TagPool) => Promise<unknown> | unknown,
): Promise<boolean | void> {
  const pool: actions.TagPool = {
    ...(source !== 'tunnels' ? { servers: servers.all() } : {}),
    ...(source !== 'servers' ? { tunnels: tunnels.all(), tempTunnels: tempTunnels.all() } : {}),
  };
  const rows = actions.tagCounts(source, pool);
  if (!rows.length) {
    ui.printWarn(tr.actions.groupsEmpty);
    return; // pause: keep the warning readable
  }
  const tag = await actions.pickTagFrom(rows, message);
  if (tag === null) return true; // backed out — nothing printed, skip the pause
  await fn(tag, pool);
}

/** Filterable browse of entities → per-item action menu (connect/check/edit/delete). */
async function browseEntities(
  crumbs: string[],
  list: () => Entity[],
  connect: (e: Entity) => Promise<number>,
  edit: (name: string) => Promise<void>,
  remove: (name: string) => Promise<void>,
  check: (e: Entity) => Promise<unknown>,
): Promise<void> {
  for (;;) {
    ui.clearScreen();
    const items = list();
    if (!items.length) {
      ui.printWarn(tr.common.listEmpty);
      await ui.pause(); // the caller skips its pause for this nav view — keep the note readable
      return;
    }
    const picked = await ui.pickFromList<Entity>({
      message: tr.menu.browseTitle,
      items,
      render: ui.entityRowRenderer(items),
      search: ui.entitySearch,
      sorts: ui.ENTITY_SORTS,
      pageSize: 14,
      crumbs,
      indent: crumbs.length * 2,
    });
    if (picked === ui.BACK) return;
    ui.clearScreen();
    console.log(detailBox(picked) + '\n');
    const act = await menuChoose(
      picked.name,
      [
        { label: tr.menu.entityAction.connect, value: 'connect' },
        { label: tr.menu.entityAction.check, value: 'check' },
        { label: tr.menu.entityAction.edit, value: 'edit' },
        { label: tr.menu.entityAction.remove, value: 'remove' },
      ],
      [...crumbs, tr.menu.browseTitle],
    );
    if (act === ui.BACK) continue;
    ui.clearScreen(); // wipe the detail/action menu before the action's output
    try {
      if (act === 'connect') {
        await connect(picked);
        await ui.pause(); // let the session result be read before leaving the browser
        return; // a connect blocks until done; leave the browser afterwards
      }
      if (act === 'check') {
        await check(picked);
        await ui.pause(); // let the reachability result be read, then back to the list
        continue;
      }
      if (act === 'edit') await edit(picked.name);
      if (act === 'remove') await remove(picked.name);
    } catch (e) {
      if (!(e instanceof PromptAbortError)) throw e;
      ui.printInfo(tr.common.cancelled);
    }
  }
}

const serversMenu = (): Promise<void> =>
  loop(
    tr.menu.servers.title,
    [root()],
    [
      { label: tr.menu.servers.list, value: 'list' },
      { label: tr.menu.servers.checkAll, value: 'checkAll' },
      { label: tr.menu.servers.add, value: 'add' },
      { label: tr.menu.servers.duplicate, value: 'duplicate' },
    ],
    async (a) => {
      if (a === 'add') await serverCmd.addServer();
      else if (a === 'duplicate') await serverCmd.duplicateServerFlow();
      else if (a === 'checkAll') await actions.statusFlow({ serversOnly: true });
      else if (a === 'list') {
        await browseEntities(
          [root(), tr.menu.servers.title],
          () => servers.all(),
          (e) => serverCmd.connectServer(e as Server),
          (name) => serverCmd.editServer(name),
          (name) => serverCmd.removeServerFlow(name),
          (e) => actions.checkTarget(e, e.name),
        );
        return true; // navigation: Esc out of the list returns here, no pause
      }
    },
  );

const tunnelsMenu = (): Promise<void> =>
  loop(
    tr.menu.tunnels.title,
    [root()],
    [
      { label: tr.menu.tunnels.list, value: 'list' },
      { label: tr.menu.tunnels.checkAll, value: 'checkAll' },
      { label: tr.menu.tunnels.quick, value: 'quick' },
      { label: tr.menu.tunnels.bg, value: 'bg' },
      { label: tr.menu.tunnels.temp, value: 'temp' },
      { label: tr.menu.tunnels.add, value: 'add' },
      { label: tr.menu.tunnels.clone, value: 'clone' },
    ],
    async (a) => {
      if (a === 'add') await tunnelCmd.addTunnel();
      else if (a === 'clone') await tunnelCmd.cloneTunnelFlow();
      else if (a === 'quick') await tunnelCmd.createAndRaiseTunnel();
      else if (a === 'checkAll') await actions.statusFlow({ tunnelsOnly: true });
      else if (a === 'bg') {
        await backgroundTunnelsMenu();
        return true; // navigation: returns straight back to this menu
      } else if (a === 'temp') {
        await tempTunnelsMenu();
        return true; // navigation
      } else if (a === 'list') {
        await browseEntities(
          [root(), tr.menu.tunnels.title],
          () => tunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel),
          (name) => tunnelCmd.editTunnel(name),
          (name) => tunnelCmd.removeTunnelFlow(name),
          (e) => actions.checkTarget(e, e.name),
        );
        return true; // navigation
      }
    },
  );

const tempTunnelsMenu = (): Promise<void> =>
  loop(
    tr.menu.temp.title,
    [root(), tr.menu.tunnels.title],
    [
      { label: tr.menu.temp.list, value: 'list' },
      { label: tr.menu.temp.create, value: 'create' },
    ],
    async (a) => {
      if (a === 'create') await tunnelCmd.raiseTemporaryTunnel();
      else if (a === 'list') {
        await browseEntities(
          [root(), tr.menu.tunnels.title, tr.menu.temp.crumb],
          () => tempTunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel, tempTunnels),
          (name) => tunnelCmd.editTunnel(name, tempTunnels),
          (name) => tunnelCmd.removeTunnelFlow(name, tempTunnels),
          (e) => actions.checkTarget(e, e.name),
        );
        return true; // navigation
      }
    },
  );

const backgroundTunnelsMenu = (): Promise<void> =>
  loop(
    tr.menu.background.title,
    [root(), tr.menu.tunnels.title],
    [
      { label: tr.menu.background.list, value: 'list' },
      { label: tr.menu.background.up, value: 'up' },
      { label: tr.menu.background.upTag, value: 'upTag' },
      { label: tr.menu.background.logs, value: 'logs' },
      { label: tr.menu.background.down, value: 'down' },
      { label: tr.menu.background.downTag, value: 'downTag' },
      { label: tr.menu.background.downAll, value: 'downAll' },
      { label: tr.menu.background.autostart, value: 'autostart' },
    ],
    async (a) => {
      if (a === 'list') await tunnelCmd.listSessions();
      else if (a === 'up') await tunnelCmd.tunnelUpFlow();
      else if (a === 'upTag')
        return withTag('tunnels', tr.menu.background.pickTag, (tag) =>
          tunnelCmd.tunnelUpByTagFlow(tag),
        );
      else if (a === 'logs') await tunnelCmd.tunnelLogsFlow();
      else if (a === 'down') await tunnelCmd.tunnelDownFlow();
      else if (a === 'downTag')
        return withTag('tunnels', tr.menu.background.pickTag, (tag) =>
          tunnelCmd.tunnelDownByTagFlow(tag),
        );
      else if (a === 'downAll') await tunnelCmd.tunnelDownFlow(undefined, { all: true });
      else if (a === 'autostart') {
        await autostartMenu();
        return true; // navigation
      }
    },
  );

const autostartMenu = (): Promise<void> =>
  loop(
    tr.menu.autostart.title,
    [root(), tr.menu.tunnels.title, tr.menu.background.crumb],
    [
      { label: tr.menu.autostart.list, value: 'list' },
      { label: tr.menu.autostart.add, value: 'add' },
      { label: tr.menu.autostart.remove, value: 'remove' },
    ],
    async (a) => {
      if (a === 'list') autostartCmd.autostartListFlow();
      else if (a === 'add') await autostartCmd.autostartAddFlow();
      else if (a === 'remove') await autostartCmd.autostartRemoveFlow();
    },
  );

const groupsMenu = (): Promise<void> =>
  loop(
    tr.menu.groups.title,
    [root(), tr.menu.actions.title],
    [
      { label: tr.menu.groups.list, value: 'list' },
      { label: tr.menu.groups.check, value: 'check' },
      { label: tr.menu.groups.run, value: 'run' },
    ],
    async (a) => {
      if (a === 'list') actions.groupListFlow();
      else if (a === 'check')
        return withTag('all', tr.menu.groups.pickTag, (tag, pool) =>
          actions.groupCheckFlow(tag, { pool }),
        );
      else if (a === 'run')
        // group run targets servers, so offer server tags only
        return withTag('servers', tr.menu.groups.pickTag, (tag, pool) =>
          actions.groupRunFlow(tag, [], { pool: pool.servers }),
        );
    },
  );

const snippetsMenu = (): Promise<void> =>
  loop(
    tr.menu.snippets.title,
    [root(), tr.menu.actions.title],
    [
      { label: tr.menu.snippets.list, value: 'list' },
      { label: tr.menu.snippets.add, value: 'add' },
      { label: tr.menu.snippets.remove, value: 'remove' },
    ],
    async (a) => {
      if (a === 'list') snippetCmd.listSnippetsFlow();
      else if (a === 'add') await snippetCmd.addSnippetFlow();
      else if (a === 'remove') await snippetCmd.removeSnippetFlow();
    },
  );

const actionsMenu = (): Promise<void> =>
  loop(
    tr.menu.actions.title,
    [root()],
    [
      { label: tr.menu.actions.status, value: 'status' },
      { label: tr.menu.actions.check, value: 'check' },
      { label: tr.menu.actions.copyId, value: 'copyId' },
      { label: tr.menu.actions.run, value: 'run' },
      { label: tr.menu.actions.transfer, value: 'transfer' },
      { label: tr.menu.actions.bgTransfers, value: 'bgTransfers' },
      { label: tr.menu.actions.snippets, value: 'snippets' },
      { label: tr.menu.actions.groups, value: 'groups' },
    ],
    async (a) => {
      if (a === 'status') await actions.statusFlow();
      else if (a === 'check') await actions.checkFlow();
      else if (a === 'copyId') await actions.copyIdFlow();
      else if (a === 'run') await actions.runFlow(undefined, []);
      else if (a === 'transfer') await actions.transferFlow();
      else if (a === 'bgTransfers') await actions.transferLogsFlow();
      else if (a === 'snippets') {
        await snippetsMenu();
        return true; // navigation
      } else if (a === 'groups') {
        await groupsMenu();
        return true; // navigation
      }
    },
  );

export async function mainMenu(): Promise<void> {
  ui.ensureInteractive(tr.menu.ensure);
  const bye = (): void => console.log(ui.chalk.dim(tr.menu.goodbye));
  // The first screen keeps the startup banner/notices above it; every later
  // visit to the main menu clears so only it is shown.
  let first = true;
  for (;;) {
    if (!first) ui.clearScreen();
    first = false;
    const counts = tr.menu.counts(servers.all().length, tunnels.all().length);
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(`${root()}  ·  ${counts}`, [
        { label: tr.menu.main.quick, value: 'quick' },
        { label: tr.menu.main.servers, value: 'servers' },
        { label: tr.menu.main.tunnels, value: 'tunnels' },
        { label: tr.menu.main.actions, value: 'actions' },
        { label: tr.menu.main.keys, value: 'keys' },
        { label: tr.menu.main.forget, value: 'forget' },
        { label: tr.menu.main.search, value: 'search' },
        { label: tr.menu.main.vault, value: 'vault' },
        { label: tr.menu.main.settings, value: 'settings' },
        { label: tr.menu.main.io, value: 'io' },
        { label: tr.menu.main.backup, value: 'backup' },
        { label: tr.menu.main.exit, value: 'exit' },
      ]);
    } catch (e) {
      if (e instanceof PromptAbortError) {
        bye();
        return;
      }
      throw e;
    }
    if (action === ui.BACK || action === 'exit') {
      bye();
      return;
    }

    ui.clearScreen(); // every action/submenu opens on a clean screen
    try {
      if (action === 'quick') {
        await quickConnect();
        await ui.pause();
      } else if (action === 'servers') await serversMenu();
      else if (action === 'tunnels') await tunnelsMenu();
      else if (action === 'actions') await actionsMenu();
      else if (action === 'keys') await keysCmd.keysMenu([root()]);
      else if (action === 'forget') {
        await actions.forgetHostKeyFlow();
        await ui.pause();
      } else if (action === 'search') {
        await searchFlow();
        await ui.pause();
      } else if (action === 'vault') await vaultFlow();
      else if (action === 'settings') await settingsFlow();
      else if (action === 'io') await importExportMenu();
      else if (action === 'backup') {
        backupSshFlow();
        await ui.pause();
      }
    } catch (e) {
      // Esc / Ctrl+C out of a top-level flow → straight back to the main menu;
      // only a genuine error is worth pausing on.
      if (!(e instanceof PromptAbortError)) {
        ui.printError(tr.common.error(e instanceof Error ? e.message : String(e)));
        await ui.pause();
      }
    }
  }
}
