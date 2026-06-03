/** Interactive main menu. Ctrl+C anywhere exits cleanly. */

import { PromptAbortError } from '../core/errors.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import * as ui from '../ui/index.js';

import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as configCmd from './config.js';
import * as actions from './actions.js';
import { quickConnect } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { importExportMenu } from './import-export.js';

async function loop(
  title: string,
  items: Array<ui.Choice<string>>,
  run: (action: string) => Promise<void>,
): Promise<void> {
  for (;;) {
    const action = await ui.choose<string>({
      message: title,
      choices: [...items, { name: '↩  Назад', value: 'back' }],
    });
    if (action === 'back') return;
    await run(action);
    await ui.pause();
  }
}

const serversMenu = (): Promise<void> =>
  loop(
    '🖥  Серверы',
    [
      { name: '🔌 Подключиться', value: 'connect' },
      { name: '➕ Добавить', value: 'add' },
      { name: '✏️  Редактировать', value: 'edit' },
      { name: '🗑  Удалить', value: 'remove' },
      { name: '📋 Список', value: 'list' },
    ],
    async (a) => {
      if (a === 'connect') await serverCmd.connectServerFlow();
      else if (a === 'add') await serverCmd.addServer();
      else if (a === 'edit') await serverCmd.editServer();
      else if (a === 'remove') await serverCmd.removeServerFlow();
      else if (a === 'list') serverCmd.listServers({});
    },
  );

const tunnelsMenu = (): Promise<void> =>
  loop(
    '🚇 Туннели',
    [
      { name: '🔌 Поднять туннель', value: 'connect' },
      { name: '➕ Добавить', value: 'add' },
      { name: '✏️  Редактировать', value: 'edit' },
      { name: '🗑  Удалить', value: 'remove' },
      { name: '📋 Список', value: 'list' },
    ],
    async (a) => {
      if (a === 'connect') await tunnelCmd.connectTunnelFlow();
      else if (a === 'add') await tunnelCmd.addTunnel();
      else if (a === 'edit') await tunnelCmd.editTunnel();
      else if (a === 'remove') await tunnelCmd.removeTunnelFlow();
      else if (a === 'list') tunnelCmd.listTunnels({});
    },
  );

const configMenu = (): Promise<void> =>
  loop(
    '🗂  ~/.ssh/config',
    [
      { name: '📋 Список', value: 'list' },
      { name: '🔌 Подключиться к хосту', value: 'connect' },
      { name: '➕ Добавить хост', value: 'add' },
      { name: '✏️  Редактировать', value: 'edit' },
      { name: '🗑  Удалить', value: 'remove' },
    ],
    async (a) => {
      if (a === 'list') configCmd.listConfigHosts();
      else if (a === 'connect') await configCmd.connectConfigHostFlow();
      else if (a === 'add') await configCmd.addConfigHost();
      else if (a === 'edit') await configCmd.editConfigHost();
      else if (a === 'remove') await configCmd.removeConfigHostFlow();
    },
  );

const actionsMenu = (): Promise<void> =>
  loop(
    '🛠  Действия по SSH',
    [
      { name: '🔎 Проверка доступности', value: 'check' },
      { name: '📋 ssh-copy-id (ключ на сервер)', value: 'copyId' },
      { name: '⚡ Выполнить команду', value: 'run' },
      { name: '📂 Передача файлов (scp)', value: 'transfer' },
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
  for (;;) {
    const counts = `${servers.all().length} серв · ${tunnels.all().length} тун`;
    let action: string;
    try {
      action = await ui.choose<string>({
        message: `Главное меню  (${counts})`,
        pageSize: 14,
        choices: [
          { name: '🔌 Быстрое подключение', value: 'quick' },
          { name: '🖥  Серверы ▸', value: 'servers' },
          { name: '🚇 Туннели ▸', value: 'tunnels' },
          { name: '🗂  ~/.ssh/config ▸', value: 'config' },
          { name: '🛠  Действия (check/copy-id/run/scp) ▸', value: 'actions' },
          { name: '🔍 Поиск по всему', value: 'search' },
          { name: '🔐 Хранилище паролей', value: 'vault' },
          { name: '⚙️  Настройки', value: 'settings' },
          { name: '📦 Экспорт / импорт', value: 'io' },
          { name: '🚪 Выход', value: 'exit' },
        ],
      });
    } catch (e) {
      if (e instanceof PromptAbortError) {
        console.log(ui.chalk.dim('\nПока! 👋\n'));
        return;
      }
      throw e;
    }

    try {
      if (action === 'exit') {
        console.log(ui.chalk.dim('\nПока! 👋\n'));
        return;
      }
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
      else if (action === 'settings') {
        await settingsFlow();
        await ui.pause();
      } else if (action === 'io') await importExportMenu();
    } catch (e) {
      if (e instanceof PromptAbortError) {
        console.log(ui.chalk.dim('\nПока! 👋\n'));
        return;
      }
      ui.printError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      await ui.pause();
    }
  }
}
