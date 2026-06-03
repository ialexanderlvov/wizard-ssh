/** Interactive main menu — built on the custom list prompt (filter + Tab-sort +
 *  Esc/«← Назад»). No emoji in selectable rows. */

import { PromptAbortError } from '../core/errors.js';
import type { Entity, Server, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import * as ui from '../ui/index.js';
import { detailBox } from '../ui/format.js';

import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as configCmd from './config.js';
import * as actions from './actions.js';
import { quickConnect } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { importExportMenu } from './import-export.js';

interface MenuItem {
  label: string;
  value: string;
}

/** A navigation menu using the list prompt; returns the chosen value or BACK. */
async function menuChoose(message: string, items: MenuItem[]): Promise<string | typeof ui.BACK> {
  const res = await ui.pickFromList<MenuItem>({
    message,
    items,
    render: (i) => i.label,
    search: (i) => i.label,
    pageSize: 14,
  });
  return res === ui.BACK ? ui.BACK : res.value;
}

/** A submenu loop: PromptAbort inside an action returns to this menu, not exit. */
async function loop(
  title: string,
  items: MenuItem[],
  run: (action: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(title, items);
    } catch (e) {
      if (e instanceof PromptAbortError) return;
      throw e;
    }
    if (action === ui.BACK) return;
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
  title: string,
  list: () => Entity[],
  connect: (e: Entity) => Promise<number>,
  edit: (name: string) => Promise<void>,
  remove: (name: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    const items = list();
    if (!items.length) {
      ui.printWarn('Список пуст.');
      return;
    }
    const picked = await ui.pickFromList<Entity>({
      message: title,
      items,
      render: ui.entityRowRenderer(items),
      search: ui.entitySearch,
      sorts: ui.ENTITY_SORTS,
      pageSize: 14,
    });
    if (picked === ui.BACK) return;
    console.log('\n' + detailBox(picked));
    const act = await menuChoose(picked.name, [
      { label: 'Подключиться', value: 'connect' },
      { label: 'Редактировать', value: 'edit' },
      { label: 'Удалить', value: 'remove' },
    ]);
    if (act === ui.BACK) continue;
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
    'Серверы',
    [
      { label: 'Список / подключиться', value: 'list' },
      { label: 'Добавить', value: 'add' },
    ],
    async (a) => {
      if (a === 'add') await serverCmd.addServer();
      else if (a === 'list')
        await browseEntities(
          'Серверы',
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
    [
      { label: 'Список / поднять', value: 'list' },
      { label: 'Создать и сразу поднять', value: 'quick' },
      { label: 'Добавить', value: 'add' },
    ],
    async (a) => {
      if (a === 'add') await tunnelCmd.addTunnel();
      else if (a === 'quick') await tunnelCmd.createAndRaiseTunnel();
      else if (a === 'list')
        await browseEntities(
          'Туннели',
          () => tunnels.all(),
          (e) => tunnelCmd.connectTunnel(e as Tunnel),
          (name) => tunnelCmd.editTunnel(name),
          (name) => tunnelCmd.removeTunnelFlow(name),
        );
    },
  );

const configMenu = (): Promise<void> =>
  loop(
    '~/.ssh/config',
    [
      { label: 'Список / подключиться', value: 'list' },
      { label: 'Добавить хост', value: 'add' },
      { label: 'Редактировать', value: 'edit' },
      { label: 'Удалить', value: 'remove' },
    ],
    async (a) => {
      if (a === 'list') await configCmd.connectConfigHostFlow();
      else if (a === 'add') await configCmd.addConfigHost();
      else if (a === 'edit') await configCmd.editConfigHost();
      else if (a === 'remove') await configCmd.removeConfigHostFlow();
    },
  );

const actionsMenu = (): Promise<void> =>
  loop(
    'Действия по SSH',
    [
      { label: 'Проверка доступности', value: 'check' },
      { label: 'ssh-copy-id (ключ на сервер)', value: 'copyId' },
      { label: 'Выполнить команду', value: 'run' },
      { label: 'Передача файлов', value: 'transfer' },
    ],
    async (a) => {
      if (a === 'check') await actions.checkFlow();
      else if (a === 'copyId') await actions.copyIdFlow();
      else if (a === 'run') await actions.runFlow(undefined, []);
      else if (a === 'transfer') await actions.transferFlow();
    },
  );

export async function mainMenu(): Promise<void> {
  ui.ensureInteractive('Интерактивное меню');
  const bye = (): void => console.log(ui.chalk.dim('\nПока! 👋\n'));
  for (;;) {
    const counts = `${servers.all().length} серв · ${tunnels.all().length} тун`;
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(`Главное меню  (${counts})`, [
        { label: 'Быстрое подключение', value: 'quick' },
        { label: 'Серверы ▸', value: 'servers' },
        { label: 'Туннели ▸', value: 'tunnels' },
        { label: '~/.ssh/config ▸', value: 'config' },
        { label: 'Действия ▸', value: 'actions' },
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

    try {
      if (action === 'quick') {
        await quickConnect();
        await ui.pause();
      } else if (action === 'servers') await serversMenu();
      else if (action === 'tunnels') await tunnelsMenu();
      else if (action === 'config') await configMenu();
      else if (action === 'actions') await actionsMenu();
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
