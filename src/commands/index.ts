/** Wire every command onto a commander program. */

import type { Command } from 'commander';
import type { SortKey } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { DATA_DIR } from '../core/paths.js';
import * as ui from '../ui/index.js';

import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as configCmd from './config.js';
import * as actions from './actions.js';
import { quickConnectByName } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { exportData, importData } from './import-export.js';

const SORT_KEYS: SortKey[] = ['recent', 'name', 'uses', 'created', 'updated'];

function parseSort(value: string | undefined): SortKey | undefined {
  if (!value) return undefined;
  if (!SORT_KEYS.includes(value as SortKey)) {
    throw new WizardError(`--sort должно быть одним из: ${SORT_KEYS.join(', ')}`);
  }
  return value as SortKey;
}

export function registerCommands(program: Command): void {
  // ---- top-level quick connect ----
  program
    .command('connect [name]')
    .alias('up')
    .alias('go')
    .description('подключиться (сервер / туннель / алиас ~/.ssh/config)')
    .action(async (name?: string) => {
      const code = await quickConnectByName(name);
      if (code) process.exitCode = code;
    });

  // ---- servers ----
  const server = program
    .command('server')
    .alias('srv')
    .alias('s')
    .description('управление серверами (SSH-шелл)');
  server
    .command('connect [name]')
    .alias('c')
    .description('подключиться к серверу')
    .action(async (n?: string) => {
      const code = await serverCmd.connectServerFlow(n);
      if (code) process.exitCode = code;
    });
  server
    .command('add')
    .alias('new')
    .description('добавить сервер')
    .action(async () => {
      await serverCmd.addServer();
    });
  server
    .command('edit [name]')
    .description('редактировать сервер')
    .action((n?: string) => serverCmd.editServer(n));
  server
    .command('remove [name]')
    .alias('rm')
    .alias('delete')
    .description('удалить сервер(ы)')
    .action((n?: string) => serverCmd.removeServerFlow(n));
  server
    .command('list')
    .alias('ls')
    .description('список серверов')
    .option('-s, --sort <key>', 'recent|name|uses|created|updated')
    .option('-r, --reverse', 'обратный порядок')
    .option('--json', 'вывести JSON')
    .action((o: { sort?: string; reverse?: boolean; json?: boolean }) => {
      serverCmd.listServers({ sort: parseSort(o.sort), reverse: o.reverse, json: o.json });
    });
  server.action(() => server.help());

  // ---- tunnels ----
  const tunnel = program
    .command('tunnel')
    .alias('tun')
    .alias('t')
    .description('управление туннелями (-L/-R/-D)');
  tunnel
    .command('connect [name]')
    .alias('up')
    .description('поднять туннель')
    .action(async (n?: string) => {
      const code = await tunnelCmd.connectTunnelFlow(n);
      if (code) process.exitCode = code;
    });
  tunnel
    .command('add')
    .alias('new')
    .description('добавить туннель')
    .action(async () => {
      await tunnelCmd.addTunnel();
    });
  tunnel
    .command('temp')
    .alias('tmp')
    .description('временный туннель на любой хост (без сохранения)')
    .action(async () => {
      const code = await tunnelCmd.raiseTemporaryTunnel();
      if (code) process.exitCode = code;
    });
  tunnel
    .command('edit [name]')
    .description('редактировать туннель')
    .action((n?: string) => tunnelCmd.editTunnel(n));
  tunnel
    .command('remove [name]')
    .alias('rm')
    .alias('delete')
    .description('удалить туннель(и)')
    .action((n?: string) => tunnelCmd.removeTunnelFlow(n));
  tunnel
    .command('list')
    .alias('ls')
    .description('список туннелей')
    .option('-s, --sort <key>', 'recent|name|uses|created|updated')
    .option('-r, --reverse', 'обратный порядок')
    .option('--json', 'вывести JSON')
    .action((o: { sort?: string; reverse?: boolean; json?: boolean }) => {
      tunnelCmd.listTunnels({ sort: parseSort(o.sort), reverse: o.reverse, json: o.json });
    });
  tunnel.action(() => tunnel.help());

  // ---- ~/.ssh/config ----
  const config = program.command('config').alias('cfg').description('управление ~/.ssh/config');
  config
    .command('list')
    .alias('ls')
    .description('список хостов')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => {
      configCmd.listConfigHosts(o);
    });
  config
    .command('connect [alias]')
    .alias('c')
    .description('подключиться к хосту из конфига')
    .action(async (a?: string) => {
      const code = await configCmd.connectConfigHostFlow(a);
      if (code) process.exitCode = code;
    });
  config
    .command('add')
    .alias('new')
    .description('добавить хост')
    .action(() => configCmd.addConfigHost());
  config
    .command('edit [alias]')
    .description('редактировать хост')
    .action((a?: string) => configCmd.editConfigHost(a));
  config
    .command('remove [alias]')
    .alias('rm')
    .alias('delete')
    .description('удалить хост')
    .action((a?: string) => configCmd.removeConfigHostFlow(a));
  config.action(() => config.help());

  // ---- search ----
  program
    .command('search [query]')
    .alias('find')
    .description('поиск по серверам, туннелям и ~/.ssh/config')
    .action((q?: string) => searchFlow(q));

  // ---- actions ----
  program
    .command('check [name]')
    .description('проверить доступность сервера/туннеля')
    .action(async (n?: string) => {
      const code = await actions.checkFlow(n);
      if (code) process.exitCode = code;
    });
  program
    .command('copy-id [name]')
    .alias('copyid')
    .description('установить SSH-ключ на сервер (ssh-copy-id)')
    .action(async (n?: string) => {
      const code = await actions.copyIdFlow(n);
      if (code) process.exitCode = code;
    });
  program
    .command('run [name] [command...]')
    .description('выполнить команду на сервере: wssh run <name> -- <cmd>')
    .passThroughOptions()
    .allowUnknownOption()
    .action(async (n: string | undefined, command: string[]) => {
      const code = await actions.runFlow(n, command ?? []);
      if (code) process.exitCode = code;
    });
  program
    .command('transfer [name]')
    .alias('scp')
    .description('передача файлов по scp или rsync')
    .action(async (n?: string) => {
      const code = await actions.transferFlow(n);
      if (code) process.exitCode = code;
    });

  // ---- vault / settings / io ----
  program
    .command('vault')
    .description('управление хранилищем паролей')
    .action(() => vaultFlow());
  program
    .command('settings')
    .description('настройки по умолчанию')
    .action(() => settingsFlow());
  program
    .command('export [file]')
    .description('экспортировать все списки в файл')
    .action((f?: string) => {
      exportData(f);
    });
  program
    .command('import <file>')
    .description('импортировать списки из файла')
    .option('--replace', 'заменить существующие списки')
    .action((f: string, o: { replace?: boolean }) => importData(f, o));

  // ---- misc ----
  program
    .command('path')
    .description('путь к директории с данными')
    .action(() => console.log(DATA_DIR));
  program
    .command('menu')
    .description('открыть интерактивное меню')
    .action(async () => {
      const { mainMenu } = await import('./menu.js');
      ui.printBanner();
      await mainMenu();
    });
}
