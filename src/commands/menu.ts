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

import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as actions from './actions.js';
import * as keysCmd from './keys.js';
import { quickConnect } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { importExportMenu } from './import-export.js';

interface MenuItem {
  label: string;
  value: string;
}

/** Title shown as the root breadcrumb; read lazily so a language switch applies. */
const root = (): string => tr.menu.root;

/** A navigation menu using the list prompt; returns the chosen value or BACK.
 *  `crumbs` are the ancestor titles shown before the active one. */
async function menuChoose(
  message: string,
  items: MenuItem[],
  crumbs: string[] = [],
): Promise<string | typeof ui.BACK> {
  const res = await ui.pickFromList<MenuItem>({
    message,
    items,
    render: (i) => i.label,
    search: (i) => i.label,
    pageSize: 14,
    crumbs,
    indent: crumbs.length * 2,
  });
  return res === ui.BACK ? ui.BACK : res.value;
}

/** A submenu loop: PromptAbort inside an action returns to this menu, not exit. */
async function loop(
  title: string,
  crumbs: string[],
  items: MenuItem[],
  run: (action: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    ui.clearScreen();
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(title, items, crumbs);
    } catch (e) {
      if (e instanceof PromptAbortError) return;
      throw e;
    }
    if (action === ui.BACK) return;
    ui.clearScreen(); // wipe the menu before the action's own output
    try {
      await run(action);
    } catch (e) {
      if (e instanceof PromptAbortError) ui.printInfo(tr.common.cancelled);
      else ui.printError(tr.common.error(e instanceof Error ? e.message : String(e)));
    }
    await ui.pause();
  }
}

/** Filterable browse of entities → per-item action menu (connect/edit/delete). */
async function browseEntities(
  crumbs: string[],
  list: () => Entity[],
  connect: (e: Entity) => Promise<number>,
  edit: (name: string) => Promise<void>,
  remove: (name: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    ui.clearScreen();
    const items = list();
    if (!items.length) {
      ui.printWarn(tr.common.listEmpty);
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
        return; // a connect blocks until done; leave the browser afterwards
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
      { label: tr.menu.servers.add, value: 'add' },
      { label: tr.menu.servers.duplicate, value: 'duplicate' },
    ],
    async (a) => {
      if (a === 'add') await serverCmd.addServer();
      else if (a === 'duplicate') await serverCmd.duplicateServerFlow();
      else if (a === 'list')
        await browseEntities(
          [root(), tr.menu.servers.title],
          () => servers.all(),
          (e) => serverCmd.connectServer(e as Server),
          (name) => serverCmd.editServer(name),
          (name) => serverCmd.removeServerFlow(name),
        );
    },
  );

const tunnelsMenu = (): Promise<void> =>
  loop(
    tr.menu.tunnels.title,
    [root()],
    [
      { label: tr.menu.tunnels.list, value: 'list' },
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
      else if (a === 'bg') await backgroundTunnelsMenu();
      else if (a === 'temp') await tempTunnelsMenu();
      else if (a === 'list')
        await browseEntities(
          [root(), tr.menu.tunnels.title],
          () => tunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel),
          (name) => tunnelCmd.editTunnel(name),
          (name) => tunnelCmd.removeTunnelFlow(name),
        );
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
      else if (a === 'list')
        await browseEntities(
          [root(), tr.menu.tunnels.title, tr.menu.temp.crumb],
          () => tempTunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel, tempTunnels),
          (name) => tunnelCmd.editTunnel(name, tempTunnels),
          (name) => tunnelCmd.removeTunnelFlow(name, tempTunnels),
        );
    },
  );

const backgroundTunnelsMenu = (): Promise<void> =>
  loop(
    tr.menu.background.title,
    [root(), tr.menu.tunnels.title],
    [
      { label: tr.menu.background.list, value: 'list' },
      { label: tr.menu.background.up, value: 'up' },
      { label: tr.menu.background.logs, value: 'logs' },
      { label: tr.menu.background.down, value: 'down' },
      { label: tr.menu.background.downAll, value: 'downAll' },
    ],
    async (a) => {
      if (a === 'list') tunnelCmd.listSessions();
      else if (a === 'up') await tunnelCmd.tunnelUpFlow();
      else if (a === 'logs') await tunnelCmd.tunnelLogsFlow();
      else if (a === 'down') await tunnelCmd.tunnelDownFlow();
      else if (a === 'downAll') await tunnelCmd.tunnelDownFlow(undefined, { all: true });
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
      { label: tr.menu.actions.groups, value: 'groups' },
    ],
    async (a) => {
      if (a === 'status') await actions.statusFlow();
      else if (a === 'check') await actions.checkFlow();
      else if (a === 'copyId') await actions.copyIdFlow();
      else if (a === 'run') await actions.runFlow(undefined, []);
      else if (a === 'transfer') await actions.transferFlow();
      else if (a === 'groups') actions.groupListFlow();
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
    } catch (e) {
      if (e instanceof PromptAbortError) ui.printInfo(tr.common.cancelled);
      else ui.printError(tr.common.error(e instanceof Error ? e.message : String(e)));
      await ui.pause();
    }
  }
}
