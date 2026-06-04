/** Wire every command onto a commander program. */

import type { Command } from 'commander';
import type { SortKey } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { DATA_DIR } from '../core/paths.js';
import * as ui from '../ui/index.js';
import { setRuntime } from '../ui/runtime.js';

import * as serverCmd from './servers.js';
import * as tunnelCmd from './tunnels.js';
import * as configCmd from './config.js';
import * as actions from './actions.js';
import * as keysCmd from './keys.js';
import { addServerNonInteractive, addTunnelNonInteractive } from './noninteractive.js';
import { doctor } from './doctor.js';
import { info } from './info.js';
import { quickConnectByName } from './connect.js';
import { searchFlow } from './search.js';
import { settingsFlow, vaultFlow } from './settings.js';
import { exportData, importData } from './import-export.js';

/** Normalize commander's `--tmux [session]`: bare flag (true) → default name. */
const tmuxOpt = (v: unknown): string | boolean | undefined =>
  v === true ? true : typeof v === 'string' ? v : undefined;

const SORT_KEYS: SortKey[] = ['recent', 'name', 'uses', 'created', 'updated'];

function parseSort(value: string | undefined): SortKey | undefined {
  if (!value) return undefined;
  if (!SORT_KEYS.includes(value as SortKey)) {
    throw new WizardError(`--sort должно быть одним из: ${SORT_KEYS.join(', ')}`);
  }
  return value as SortKey;
}

export function registerCommands(program: Command): void {
  // ---- global flags (scripting) ----
  program
    .option('-y, --yes', 'отвечать «да» на все подтверждения (для скриптов)')
    .option('--non-interactive', 'никогда не открывать интерактивные подсказки');
  program.hook('preAction', (thisCommand) => {
    const o = thisCommand.opts<{ yes?: boolean; nonInteractive?: boolean }>();
    setRuntime({ assumeYes: Boolean(o.yes), nonInteractive: Boolean(o.nonInteractive) });
  });

  // ---- top-level quick connect ----
  program
    .command('connect [name]')
    .alias('up')
    .alias('go')
    .description('подключиться (сервер / туннель / алиас ~/.ssh/config)')
    .option('--tmux [session]', 'открыть/переподключиться к tmux-сессии на сервере')
    .action(async (name: string | undefined, opts: { tmux?: string | boolean }) => {
      const code = await quickConnectByName(name, { tmux: tmuxOpt(opts.tmux) });
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
    .option('--tmux [session]', 'открыть/переподключиться к tmux-сессии на сервере')
    .action(async (n: string | undefined, opts: { tmux?: string | boolean }) => {
      const code = await serverCmd.connectServerFlow(n, { tmux: tmuxOpt(opts.tmux) });
      if (code) process.exitCode = code;
    });
  server
    .command('add [name]')
    .alias('new')
    .description('добавить сервер (с флагами — без вопросов)')
    .option('--host <ip|домен>', 'HostName (включает неинтерактивный режим)')
    .option('--user <user>', 'SSH-пользователь')
    .option('--port <port>', 'SSH-порт')
    .option('--auth <agent|key>', 'способ авторизации')
    .option('--key <path>', 'путь к приватному ключу (для --auth key)')
    .option('--desc <text>', 'описание')
    .option('--tags <csv>', 'теги через запятую')
    .action(async (name: string | undefined, o: Record<string, string>) => {
      if (o.host || ui.runtime.nonInteractive) addServerNonInteractive(name, o);
      else await serverCmd.addServer(name ? { name } : {});
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
    .description('добавить туннель (с флагами — без вопросов)')
    .option('--name <name>', 'имя туннеля')
    .option('--type <local|remote|dynamic>', 'тип проброса')
    .option('--local <port>', 'локальный порт')
    .option('--remote-host <host>', 'хост на дальней стороне')
    .option('--remote-port <port>', 'порт на дальней стороне')
    .option('--alias <alias>', 'хост из ~/.ssh/config')
    .option('--host <ip|домен>', 'хост (вместо --alias)')
    .option('--user <user>', 'SSH-пользователь (с --host)')
    .option('--port <port>', 'SSH-порт (с --host)')
    .option('--auth <agent|key>', 'способ авторизации')
    .option('--key <path>', 'путь к приватному ключу (для --auth key)')
    .option('--desc <text>', 'описание')
    .option('--tags <csv>', 'теги через запятую')
    .action(async (o: Record<string, string>) => {
      if (o.local || o.alias || o.host || ui.runtime.nonInteractive) addTunnelNonInteractive(o);
      else await tunnelCmd.addTunnel();
    });
  tunnel
    .command('start [name]')
    .alias('bg')
    .description('поднять туннель в фоне (agent/key)')
    .action(async (n?: string) => {
      const code = await tunnelCmd.tunnelUpFlow(n);
      if (code) process.exitCode = code;
    });
  tunnel
    .command('sessions')
    .alias('ps')
    .description('список фоновых туннелей')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => tunnelCmd.listSessions(o));
  tunnel
    .command('down [name]')
    .alias('stop')
    .description('остановить фоновый туннель (или все: --all)')
    .option('--all', 'остановить все')
    .action(async (n: string | undefined, o: { all?: boolean }) => {
      const code = await tunnelCmd.tunnelDownFlow(n, o);
      if (code) process.exitCode = code;
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
    .option('--json', 'вывести JSON')
    .action((q: string | undefined, o: { json?: boolean }) => searchFlow(q, o));

  // ---- actions ----
  program
    .command('check [name]')
    .description('проверить доступность сервера/туннеля')
    .option('--json', 'вывести JSON')
    .action(async (n: string | undefined, o: { json?: boolean }) => {
      const code = await actions.checkFlow(n, o);
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

  // ---- fleet status ----
  program
    .command('status')
    .alias('ps')
    .description('массовая проверка доступности (дашборд)')
    .option('--json', 'вывести JSON')
    .option('--servers', 'только серверы')
    .option('--tunnels', 'только туннели')
    .option('--tag <tag>', 'только с этим тегом')
    .action(async (o: { json?: boolean; servers?: boolean; tunnels?: boolean; tag?: string }) => {
      const code = await actions.statusFlow({
        json: o.json,
        serversOnly: o.servers,
        tunnelsOnly: o.tunnels,
        tag: o.tag,
      });
      if (code) process.exitCode = code;
    });

  // ---- ssh keys ----
  const keys = program.command('keys').alias('key').description('управление SSH-ключами (~/.ssh)');
  keys
    .command('list')
    .alias('ls')
    .description('список ключей с отпечатками')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => {
      keysCmd.listKeysCommand(o);
    });
  keys
    .command('gen')
    .alias('new')
    .alias('generate')
    .description('сгенерировать новый ключ (ssh-keygen)')
    .action(async () => {
      await keysCmd.generateKeyFlow();
    });
  keys
    .command('remove [path]')
    .alias('rm')
    .alias('delete')
    .description('удалить ключ (покажет, кто на него ссылается)')
    .action((p?: string) => keysCmd.deleteKeyCommand(p));
  keys.action(() => keysCmd.keysMenu());

  // ---- known_hosts ----
  program
    .command('forget-host [name]')
    .alias('known-hosts')
    .description('known_hosts: удалить запись (ssh-keygen -R) или показать (--list)')
    .option('--list', 'показать записи known_hosts')
    .option('--json', 'вывести JSON (с --list)')
    .action(async (n: string | undefined, o: { list?: boolean; json?: boolean }) => {
      if (o.list) {
        actions.knownHostsListFlow({ json: o.json });
        return;
      }
      const code = await actions.forgetHostKeyFlow(n);
      if (code) process.exitCode = code;
    });

  // ---- tag groups ----
  const group = program.command('group').description('группы серверов/туннелей по тегам');
  group
    .command('list')
    .alias('ls')
    .description('теги и их размеры')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => actions.groupListFlow(o));
  group
    .command('check <tag>')
    .description('проверить доступность всех с тегом')
    .option('--json', 'вывести JSON')
    .action(async (tag: string, o: { json?: boolean }) => {
      const code = await actions.groupCheckFlow(tag, o);
      if (code) process.exitCode = code;
    });
  group.action(() => group.help());

  // ---- diagnostics ----
  program
    .command('doctor')
    .description('диагностика окружения (бинари, права, конфиг)')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => {
      const code = doctor(o);
      if (code) process.exitCode = code;
    });
  program
    .command('info')
    .alias('env')
    .description('сводка окружения, путей и инвентаря')
    .option('--json', 'вывести JSON')
    .action((o: { json?: boolean }) => {
      info(o);
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

  program.addHelpText(
    'after',
    `
Примеры:
  wssh                          интерактивное меню
  wssh connect prod             подключиться к серверу/туннелю «prod»
  wssh connect prod --tmux      войти в постоянную tmux-сессию
  wssh run prod -- uptime       выполнить команду на сервере
  wssh server add prod --host 10.0.0.5 --user deploy --auth key --key ~/.ssh/id_ed25519
  wssh tunnel add --alias prod --type local --local 8080 --remote-port 80
  wssh tunnel start prod-db     поднять туннель в фоне
  wssh tunnel sessions          какие туннели работают в фоне
  wssh status --json            доступность всего парка (для скриптов)
  wssh keys gen                 сгенерировать SSH-ключ
  wssh doctor                   проверить окружение
  WSSH_VAULT_PASSPHRASE=… wssh run prod -- ls   неинтерактивно (пароль из env)`,
  );
}
