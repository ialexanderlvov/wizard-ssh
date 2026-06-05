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
import { backupSshFlow } from './backup.js';
import { completeFromProgram, completionScript, type Shell } from './completion.js';
import { manFlow } from './man.js';

/** Normalize commander's `--tmux [session]`: bare flag (true) → default name. */
const tmuxOpt = (v: unknown): string | boolean | undefined =>
  v === true ? true : typeof v === 'string' ? v : undefined;

/** Parse a `--tail <n>` flag to a positive integer, or undefined (→ the viewer's
 *  default). Without this, `--tail abc`/`--tail 0`/`--tail -1` become NaN/≤0 and
 *  the viewer would dump the ENTIRE log instead of erroring or defaulting. */
const parseTail = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

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
    .option('--mosh', tr.cmd.optMosh)
    .action(async (name: string | undefined, opts: { tmux?: string | boolean; mosh?: boolean }) => {
      const code = await quickConnectByName(name, { tmux: tmuxOpt(opts.tmux), mosh: opts.mosh });
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
    .option('--mosh', tr.cmd.optMosh)
    .action(async (n: string | undefined, opts: { tmux?: string | boolean; mosh?: boolean }) => {
      const code = await serverCmd.connectServerFlow(n, {
        tmux: tmuxOpt(opts.tmux),
        mosh: opts.mosh,
      });
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
  server
    .command('duplicate [name] [newName]')
    .alias('dup')
    .description(tr.cmd.serverDuplicateDesc)
    .action((n?: string, nn?: string) => serverCmd.duplicateServerFlow(n, nn));
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
  tunnel
    .command('clone [name] [newName]')
    .alias('cp')
    .description(tr.cmd.tunnelCloneDesc)
    .action((n?: string, nn?: string) => tunnelCmd.cloneTunnelFlow(n, nn));
  tunnel
    .command('logs [name]')
    .alias('log')
    .description(tr.cmd.tunnelLogsDesc)
    .option('--tail <n>', tr.cmd.tunnelLogsOptTail)
    .option('-f, --follow', tr.cmd.tunnelLogsOptFollow)
    .action(async (n: string | undefined, o: { tail?: string; follow?: boolean }) => {
      const code = await tunnelCmd.tunnelLogsFlow(n, {
        tail: parseTail(o.tail),
        follow: o.follow,
      });
      if (code) process.exitCode = code;
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
    .option('--tool <scp|rsync>', tr.cmd.transferOptTool)
    .option('--upload', tr.cmd.transferOptUpload)
    .option('--download', tr.cmd.transferOptDownload)
    .option('--local <path>', tr.cmd.transferOptLocal)
    .option('--remote <path>', tr.cmd.transferOptRemote)
    .option('--recursive', tr.cmd.transferOptRecursive)
    .option('--compress', tr.cmd.transferOptCompress)
    .option('--delete', tr.cmd.transferOptDelete)
    .option('--dry-run', tr.cmd.transferOptDryRun)
    .option('--bg', tr.cmd.transferOptBg)
    .action(
      async (
        n: string | undefined,
        o: {
          tool?: string;
          upload?: boolean;
          download?: boolean;
          local?: string;
          remote?: string;
          recursive?: boolean;
          compress?: boolean;
          delete?: boolean;
          dryRun?: boolean;
          bg?: boolean;
        },
      ) => {
        if (o.upload && o.download) throw new WizardError(tr.cmd.transferBothDirections);
        if (o.tool && o.tool !== 'scp' && o.tool !== 'rsync')
          throw new WizardError(tr.cmd.transferBadTool('scp, rsync'));
        const code = await actions.transferFlow(n, {
          tool: o.tool as 'scp' | 'rsync' | undefined,
          direction: o.upload ? 'upload' : o.download ? 'download' : undefined,
          local: o.local,
          remote: o.remote,
          recursive: o.recursive,
          compress: o.compress,
          delete: o.delete,
          dryRun: o.dryRun,
          bg: o.bg,
        });
        if (code) process.exitCode = code;
      },
    );
  // background transfer monitoring (one-shot processes started with `transfer --bg`)
  program
    .command('transfers')
    .description(tr.cmd.transfersDesc)
    .option('--log <id>', tr.cmd.transfersOptLog)
    .option('--tail <n>', tr.cmd.tunnelLogsOptTail)
    .option('-f, --follow', tr.cmd.tunnelLogsOptFollow)
    .option('--json', tr.cmd.optOutputJson)
    .action(async (o: { log?: string; tail?: string; follow?: boolean; json?: boolean }) => {
      if (o.log !== undefined || o.follow || o.tail !== undefined) {
        const code = await actions.transferLogsFlow(o.log, {
          tail: parseTail(o.tail),
          follow: o.follow,
        });
        if (code) process.exitCode = code;
        return;
      }
      actions.transferSessionsFlow({ json: o.json });
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
    .option('--list-stale-keys', tr.cmd.doctorOptListStale)
    .action((o: { json?: boolean; listStaleKeys?: boolean }) => {
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
    .option('--force', tr.cmd.exportOptForce)
    .action((f: string | undefined, o: { force?: boolean }) => {
      exportData(f, { force: o.force });
    });
  program
    .command('import <file>')
    .description(tr.cmd.importDesc)
    .option('--replace', tr.cmd.importOptReplace)
    .action((f: string, o: { replace?: boolean }) => importData(f, o));

  // ---- misc ----
  program
    .command('backup [dir]')
    .description(tr.cmd.backupDesc)
    .action((dir?: string) => {
      const code = backupSshFlow(dir);
      if (code) process.exitCode = code;
    });
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
  program
    .command('man')
    .description(tr.cmd.manDesc)
    .option('--roff', tr.cmd.manOptRoff)
    .action((o: { roff?: boolean }) => {
      const code = manFlow(program, { roff: o.roff });
      if (code) process.exitCode = code;
    });

  // ---- shell completion ----
  const SHELLS: Shell[] = ['bash', 'zsh', 'fish'];
  program
    .command('completion <shell>')
    .description(tr.cmd.completionDesc)
    .action((shell: string) => {
      const s = shell.toLowerCase() as Shell;
      if (!SHELLS.includes(s)) throw new WizardError(tr.cmd.completionBadShell(SHELLS.join(', ')));
      console.log(completionScript(s));
    });
  // Hidden helper the completion scripts call on <TAB>: prints candidates, one per
  // line. It must NEVER throw or print noise to stdout (it would corrupt the shell
  // completion), so everything is swallowed.
  program
    .command('complete [words...]', { hidden: true })
    .allowUnknownOption()
    .action((words: string[] | undefined) => {
      try {
        const out = completeFromProgram(program, words ?? []);
        if (out.length) console.log(out.join('\n'));
      } catch {
        /* completion is best-effort — never break the user's shell */
      }
    });

  program.addHelpText('after', tr.cmd.helpExamples);
}
