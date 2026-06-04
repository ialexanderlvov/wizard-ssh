/** Wire every command onto a commander program. */

import type { Command } from 'commander';
import type { SortKey } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { DATA_DIR } from '../core/paths.js';
import * as ui from '../ui/index.js';
import { setRuntime } from '../ui/runtime.js';
import { tr } from '../i18n/index.js';

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
    throw new WizardError(tr.cmd.sortInvalid(SORT_KEYS.join(', ')));
  }
  return value as SortKey;
}

export function registerCommands(program: Command): void {
  // ---- global flags (scripting) ----
  program.option('-y, --yes', tr.cmd.optYes).option('--non-interactive', tr.cmd.optNonInteractive);
  program.hook('preAction', (thisCommand) => {
    const o = thisCommand.opts<{ yes?: boolean; nonInteractive?: boolean }>();
    setRuntime({ assumeYes: Boolean(o.yes), nonInteractive: Boolean(o.nonInteractive) });
  });

  // ---- top-level quick connect ----
  program
    .command('connect [name]')
    .alias('up')
    .alias('go')
    .description(tr.cmd.connectDesc)
    .option('--tmux [session]', tr.cmd.optTmux)
    .action(async (name: string | undefined, opts: { tmux?: string | boolean }) => {
      const code = await quickConnectByName(name, { tmux: tmuxOpt(opts.tmux) });
      if (code) process.exitCode = code;
    });

  // ---- servers ----
  const server = program
    .command('server')
    .alias('srv')
    .alias('s')
    .description(tr.cmd.serverGroupDesc);
  server
    .command('connect [name]')
    .alias('c')
    .description(tr.cmd.serverConnectDesc)
    .option('--tmux [session]', tr.cmd.optTmux)
    .action(async (n: string | undefined, opts: { tmux?: string | boolean }) => {
      const code = await serverCmd.connectServerFlow(n, { tmux: tmuxOpt(opts.tmux) });
      if (code) process.exitCode = code;
    });
  server
    .command('add [name]')
    .alias('new')
    .description(tr.cmd.serverAddDesc)
    .option(`--host <${tr.cmd.hostArg}>`, tr.cmd.serverAddOptHost)
    .option('--user <user>', tr.cmd.optSshUser)
    .option('--port <port>', tr.cmd.optSshPort)
    .option('--auth <agent|key>', tr.cmd.optAuthMethod)
    .option('--key <path>', tr.cmd.optKeyPath)
    .option('--desc <text>', tr.cmd.optDesc)
    .option('--tags <csv>', tr.cmd.optTags)
    .action(async (name: string | undefined, o: Record<string, string>) => {
      if (o.host || ui.runtime.nonInteractive) addServerNonInteractive(name, o);
      else await serverCmd.addServer(name ? { name } : {});
    });
  server
    .command('edit [name]')
    .description(tr.cmd.serverEditDesc)
    .action((n?: string) => serverCmd.editServer(n));
  server
    .command('remove [name]')
    .alias('rm')
    .alias('delete')
    .description(tr.cmd.serverRemoveDesc)
    .action((n?: string) => serverCmd.removeServerFlow(n));
  server
    .command('list')
    .alias('ls')
    .description(tr.cmd.serverListDesc)
    .option('-s, --sort <key>', 'recent|name|uses|created|updated')
    .option('-r, --reverse', tr.cmd.optReverseOrder)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { sort?: string; reverse?: boolean; json?: boolean }) => {
      serverCmd.listServers({ sort: parseSort(o.sort), reverse: o.reverse, json: o.json });
    });
  server.action(() => server.help());

  // ---- tunnels ----
  const tunnel = program
    .command('tunnel')
    .alias('tun')
    .alias('t')
    .description(tr.cmd.tunnelGroupDesc);
  tunnel
    .command('connect [name]')
    .alias('up')
    .description(tr.cmd.tunnelConnectDesc)
    .action(async (n?: string) => {
      const code = await tunnelCmd.connectTunnelFlow(n);
      if (code) process.exitCode = code;
    });
  tunnel
    .command('add')
    .alias('new')
    .description(tr.cmd.tunnelAddDesc)
    .option('--name <name>', tr.cmd.tunnelAddOptName)
    .option('--type <local|remote|dynamic>', tr.cmd.tunnelAddOptType)
    .option('--local <port>', tr.cmd.tunnelAddOptLocal)
    .option('--remote-host <host>', tr.cmd.tunnelAddOptRemoteHost)
    .option('--remote-port <port>', tr.cmd.tunnelAddOptRemotePort)
    .option('--alias <alias>', tr.cmd.tunnelAddOptAlias)
    .option(`--host <${tr.cmd.hostArg}>`, tr.cmd.tunnelAddOptHost)
    .option('--user <user>', tr.cmd.tunnelAddOptSshUserWithHost)
    .option('--port <port>', tr.cmd.tunnelAddOptSshPortWithHost)
    .option('--auth <agent|key>', tr.cmd.optAuthMethod)
    .option('--key <path>', tr.cmd.optKeyPath)
    .option('--desc <text>', tr.cmd.optDesc)
    .option('--tags <csv>', tr.cmd.optTags)
    .action(async (o: Record<string, string>) => {
      if (o.local || o.alias || o.host || ui.runtime.nonInteractive) addTunnelNonInteractive(o);
      else await tunnelCmd.addTunnel();
    });
  tunnel
    .command('start [name]')
    .alias('bg')
    .description(tr.cmd.tunnelStartDesc)
    .action(async (n?: string) => {
      const code = await tunnelCmd.tunnelUpFlow(n);
      if (code) process.exitCode = code;
    });
  tunnel
    .command('sessions')
    .alias('ps')
    .description(tr.cmd.tunnelSessionsDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => tunnelCmd.listSessions(o));
  tunnel
    .command('down [name]')
    .alias('stop')
    .description(tr.cmd.tunnelDownDesc)
    .option('--all', tr.cmd.tunnelDownOptAll)
    .action(async (n: string | undefined, o: { all?: boolean }) => {
      const code = await tunnelCmd.tunnelDownFlow(n, o);
      if (code) process.exitCode = code;
    });
  tunnel
    .command('temp')
    .alias('tmp')
    .description(tr.cmd.tunnelTempDesc)
    .action(async () => {
      const code = await tunnelCmd.raiseTemporaryTunnel();
      if (code) process.exitCode = code;
    });
  tunnel
    .command('edit [name]')
    .description(tr.cmd.tunnelEditDesc)
    .action((n?: string) => tunnelCmd.editTunnel(n));
  tunnel
    .command('remove [name]')
    .alias('rm')
    .alias('delete')
    .description(tr.cmd.tunnelRemoveDesc)
    .action((n?: string) => tunnelCmd.removeTunnelFlow(n));
  tunnel
    .command('list')
    .alias('ls')
    .description(tr.cmd.tunnelListDesc)
    .option('-s, --sort <key>', 'recent|name|uses|created|updated')
    .option('-r, --reverse', tr.cmd.optReverseOrder)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { sort?: string; reverse?: boolean; json?: boolean }) => {
      tunnelCmd.listTunnels({ sort: parseSort(o.sort), reverse: o.reverse, json: o.json });
    });
  tunnel.action(() => tunnel.help());

  // ---- ~/.ssh/config ----
  const config = program.command('config').alias('cfg').description(tr.cmd.configGroupDesc);
  config
    .command('list')
    .alias('ls')
    .description(tr.cmd.configListDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => {
      configCmd.listConfigHosts(o);
    });
  config
    .command('connect [alias]')
    .alias('c')
    .description(tr.cmd.configConnectDesc)
    .action(async (a?: string) => {
      const code = await configCmd.connectConfigHostFlow(a);
      if (code) process.exitCode = code;
    });
  config
    .command('add')
    .alias('new')
    .description(tr.cmd.configAddDesc)
    .action(() => configCmd.addConfigHost());
  config
    .command('edit [alias]')
    .description(tr.cmd.configEditDesc)
    .action((a?: string) => configCmd.editConfigHost(a));
  config
    .command('remove [alias]')
    .alias('rm')
    .alias('delete')
    .description(tr.cmd.configRemoveDesc)
    .action((a?: string) => configCmd.removeConfigHostFlow(a));
  config.action(() => config.help());

  // ---- search ----
  program
    .command('search [query]')
    .alias('find')
    .description(tr.cmd.searchDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((q: string | undefined, o: { json?: boolean }) => searchFlow(q, o));

  // ---- actions ----
  program
    .command('check [name]')
    .description(tr.cmd.checkDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action(async (n: string | undefined, o: { json?: boolean }) => {
      const code = await actions.checkFlow(n, o);
      if (code) process.exitCode = code;
    });
  program
    .command('copy-id [name]')
    .alias('copyid')
    .description(tr.cmd.copyIdDesc)
    .action(async (n?: string) => {
      const code = await actions.copyIdFlow(n);
      if (code) process.exitCode = code;
    });
  program
    .command('run [name] [command...]')
    .description(tr.cmd.runDesc)
    .passThroughOptions()
    .allowUnknownOption()
    .action(async (n: string | undefined, command: string[]) => {
      const code = await actions.runFlow(n, command ?? []);
      if (code) process.exitCode = code;
    });
  program
    .command('transfer [name]')
    .alias('scp')
    .description(tr.cmd.transferDesc)
    .action(async (n?: string) => {
      const code = await actions.transferFlow(n);
      if (code) process.exitCode = code;
    });

  // ---- fleet status ----
  program
    .command('status')
    .alias('ps')
    .description(tr.cmd.statusDesc)
    .option('--json', tr.cmd.optOutputJson)
    .option('--servers', tr.cmd.statusOptServers)
    .option('--tunnels', tr.cmd.statusOptTunnels)
    .option('--tag <tag>', tr.cmd.statusOptTag)
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
  const keys = program.command('keys').alias('key').description(tr.cmd.keysGroupDesc);
  keys
    .command('list')
    .alias('ls')
    .description(tr.cmd.keysListDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => {
      keysCmd.listKeysCommand(o);
    });
  keys
    .command('gen')
    .alias('new')
    .alias('generate')
    .description(tr.cmd.keysGenDesc)
    .action(async () => {
      await keysCmd.generateKeyFlow();
    });
  keys
    .command('remove [path]')
    .alias('rm')
    .alias('delete')
    .description(tr.cmd.keysRemoveDesc)
    .action((p?: string) => keysCmd.deleteKeyCommand(p));
  keys.action(() => keysCmd.keysMenu());

  // ---- known_hosts ----
  program
    .command('forget-host [name]')
    .alias('known-hosts')
    .description(tr.cmd.forgetHostDesc)
    .option('--list', tr.cmd.forgetHostOptList)
    .option('--json', tr.cmd.optOutputJsonWithList)
    .action(async (n: string | undefined, o: { list?: boolean; json?: boolean }) => {
      if (o.list) {
        actions.knownHostsListFlow({ json: o.json });
        return;
      }
      const code = await actions.forgetHostKeyFlow(n);
      if (code) process.exitCode = code;
    });

  // ---- tag groups ----
  const group = program.command('group').description(tr.cmd.groupDesc);
  group
    .command('list')
    .alias('ls')
    .description(tr.cmd.groupListDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => actions.groupListFlow(o));
  group
    .command('check <tag>')
    .description(tr.cmd.groupCheckDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action(async (tag: string, o: { json?: boolean }) => {
      const code = await actions.groupCheckFlow(tag, o);
      if (code) process.exitCode = code;
    });
  group.action(() => group.help());

  // ---- diagnostics ----
  program
    .command('doctor')
    .description(tr.cmd.doctorDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => {
      const code = doctor(o);
      if (code) process.exitCode = code;
    });
  program
    .command('info')
    .alias('env')
    .description(tr.cmd.infoDesc)
    .option('--json', tr.cmd.optOutputJson)
    .action((o: { json?: boolean }) => {
      info(o);
    });

  // ---- vault / settings / io ----
  program
    .command('vault')
    .description(tr.cmd.vaultDesc)
    .action(() => vaultFlow());
  program
    .command('settings')
    .description(tr.cmd.settingsDesc)
    .action(() => settingsFlow());
  program
    .command('export [file]')
    .description(tr.cmd.exportDesc)
    .action((f?: string) => {
      exportData(f);
    });
  program
    .command('import <file>')
    .description(tr.cmd.importDesc)
    .option('--replace', tr.cmd.importOptReplace)
    .action((f: string, o: { replace?: boolean }) => importData(f, o));

  // ---- misc ----
  program
    .command('path')
    .description(tr.cmd.pathDesc)
    .action(() => console.log(DATA_DIR));
  program
    .command('menu')
    .description(tr.cmd.menuDesc)
    .action(async () => {
      const { mainMenu } = await import('./menu.js');
      ui.printBanner();
      await mainMenu();
    });

  program.addHelpText('after', tr.cmd.helpExamples);
}
