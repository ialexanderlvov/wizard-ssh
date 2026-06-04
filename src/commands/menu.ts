/** Interactive main menu — built on the custom list prompt (filter + Tab-sort +
 *  Esc/«← Назад»). Each navigation step clears the screen and shows a breadcrumb
 *  (with depth indent), so only the active menu is visible. */

import { PromptAbortError } from '../core/errors.js';
import type { Entity, Server, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import * as ui from '../ui/index.js';
import { detailBox } from '../ui/format.js';

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

const ROOT = 'Главное меню';

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
      if (e instanceof PromptAbortError) ui.printInfo('Отменено.');
      else ui.printError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
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
      ui.printWarn('Список пуст.');
      return;
    }
    const picked = await ui.pickFromList<Entity>({
      message: 'Список',
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
        { label: 'Подключиться', value: 'connect' },
        { label: 'Редактировать', value: 'edit' },
        { label: 'Удалить', value: 'remove' },
      ],
      [...crumbs, 'Список'],
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
      ui.printInfo('Отменено.');
    }
  }
}

const serversMenu = (): Promise<void> =>
  loop(
    'Серверы / ~/.ssh/config',
    [ROOT],
    [
      { label: 'Список / подключиться', value: 'list' },
      { label: 'Добавить', value: 'add' },
    ],
    async (a) => {
      if (a === 'add') await serverCmd.addServer();
      else if (a === 'list')
        await browseEntities(
          [ROOT, 'Серверы / ~/.ssh/config'],
          () => servers.all(),
          (e) => serverCmd.connectServer(e as Server),
          (name) => serverCmd.editServer(name),
          (name) => serverCmd.removeServerFlow(name),
        );
    },
  );

const tunnelsMenu = (): Promise<void> =>
  loop(
    'Туннели',
    [ROOT],
    [
      { label: 'Список / поднять', value: 'list' },
      { label: 'Создать и сразу поднять (из ~/.ssh/config)', value: 'quick' },
      { label: 'Фоновые сессии ▸', value: 'bg' },
      { label: 'Временные туннели (на любой хост) ▸', value: 'temp' },
      { label: 'Добавить', value: 'add' },
    ],
    async (a) => {
      if (a === 'add') await tunnelCmd.addTunnel();
      else if (a === 'quick') await tunnelCmd.createAndRaiseTunnel();
      else if (a === 'bg') await backgroundTunnelsMenu();
      else if (a === 'temp') await tempTunnelsMenu();
      else if (a === 'list')
        await browseEntities(
          [ROOT, 'Туннели'],
          () => tunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel),
          (name) => tunnelCmd.editTunnel(name),
          (name) => tunnelCmd.removeTunnelFlow(name),
        );
    },
  );

const tempTunnelsMenu = (): Promise<void> =>
  loop(
    'Временные туннели',
    [ROOT, 'Туннели'],
    [
      { label: 'Список / поднять', value: 'list' },
      { label: 'Создать и поднять (на любой хост)', value: 'create' },
    ],
    async (a) => {
      if (a === 'create') await tunnelCmd.raiseTemporaryTunnel();
      else if (a === 'list')
        await browseEntities(
          [ROOT, 'Туннели', 'Временные'],
          () => tempTunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel, tempTunnels),
          (name) => tunnelCmd.editTunnel(name, tempTunnels),
          (name) => tunnelCmd.removeTunnelFlow(name, tempTunnels),
        );
    },
  );

const backgroundTunnelsMenu = (): Promise<void> =>
  loop(
    'Фоновые туннели',
    [ROOT, 'Туннели'],
    [
      { label: 'Список запущенных', value: 'list' },
      { label: 'Поднять в фоне', value: 'up' },
      { label: 'Остановить', value: 'down' },
      { label: 'Остановить все', value: 'downAll' },
    ],
    async (a) => {
      if (a === 'list') tunnelCmd.listSessions();
      else if (a === 'up') await tunnelCmd.tunnelUpFlow();
      else if (a === 'down') await tunnelCmd.tunnelDownFlow();
      else if (a === 'downAll') await tunnelCmd.tunnelDownFlow(undefined, { all: true });
    },
  );

const actionsMenu = (): Promise<void> =>
  loop(
    'Действия по SSH',
    [ROOT],
    [
      { label: 'Статус — проверить всё', value: 'status' },
      { label: 'Проверка доступности', value: 'check' },
      { label: 'ssh-copy-id (ключ на сервер)', value: 'copyId' },
      { label: 'Выполнить команду', value: 'run' },
      { label: 'Передача файлов', value: 'transfer' },
      { label: 'Группы по тегам', value: 'groups' },
      { label: 'Забыть host-key (known_hosts)', value: 'forget' },
    ],
    async (a) => {
      if (a === 'status') await actions.statusFlow();
      else if (a === 'check') await actions.checkFlow();
      else if (a === 'copyId') await actions.copyIdFlow();
      else if (a === 'run') await actions.runFlow(undefined, []);
      else if (a === 'transfer') await actions.transferFlow();
      else if (a === 'groups') actions.groupListFlow();
      else if (a === 'forget') await actions.forgetHostKeyFlow();
    },
  );

export async function mainMenu(): Promise<void> {
  ui.ensureInteractive('Интерактивное меню');
  const bye = (): void => console.log(ui.chalk.dim('\nПока! 👋\n'));
  // The first screen keeps the startup banner/notices above it; every later
  // visit to the main menu clears so only it is shown.
  let first = true;
  for (;;) {
    if (!first) ui.clearScreen();
    first = false;
    const counts = `${servers.all().length} серв · ${tunnels.all().length} тун`;
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(`${ROOT}  ·  ${counts}`, [
        { label: 'Быстрое подключение', value: 'quick' },
        { label: 'Серверы / ~/.ssh/config ▸', value: 'servers' },
        { label: 'Туннели ▸', value: 'tunnels' },
        { label: 'Действия ▸', value: 'actions' },
        { label: 'SSH-ключи ▸', value: 'keys' },
        { label: 'Поиск по всему', value: 'search' },
        { label: 'Хранилище паролей', value: 'vault' },
        { label: 'Настройки', value: 'settings' },
        { label: 'Экспорт / импорт', value: 'io' },
        { label: 'Выход', value: 'exit' },
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
      else if (action === 'keys') await keysCmd.keysMenu([ROOT]);
      else if (action === 'search') {
        await searchFlow();
        await ui.pause();
      } else if (action === 'vault') await vaultFlow();
      else if (action === 'settings') await settingsFlow();
      else if (action === 'io') await importExportMenu();
    } catch (e) {
      if (e instanceof PromptAbortError) ui.printInfo('Отменено.');
      else ui.printError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      await ui.pause();
    }
  }
}
