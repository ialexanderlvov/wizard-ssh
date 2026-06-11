/** Extra actions: reachability check, fleet status, ssh-copy-id, remote command,
 *  file transfer, known_hosts, tag groups. */

import fs from 'node:fs';
import type { ConnectionTarget, Server } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { settings } from '../store/settings.store.js';
import { transferSessions, type TransferSession } from '../store/transfer-sessions.store.js';
import { snippets, type Snippet } from '../store/snippets.store.js';
import { findSshKeys } from '../ssh/keys.js';
import {
  healthCheck,
  healthCheckAll,
  copyId,
  runCommand,
  runCommandOnAll,
  transfer,
  transferArgv,
} from '../ssh/features.js';
import type { FleetTarget, TransferOptions, TransferTool } from '../ssh/features.js';
import { forgetHostKey, knownHostsToken, listKnownHosts } from '../ssh/hostkey.js';
import type { KnownHost } from '../ssh/hostkey.js';
import { resolveEndpoint } from '../ssh/features.js';
import { startTransferDetached } from '../ssh/runner.js';
import { destination } from '../ssh/args.js';
import { shQuote } from '../utils/shell.js';
import * as ui from '../ui/index.js';
import { renderStatusTable } from '../ui/tables.js';
import { targetSummary } from '../ui/format.js';
import { tilde } from '../utils/strings.js';
import { commandExists } from '../utils/exec.js';
import { newId } from '../utils/id.js';
import { tailFile, followLog } from '../utils/logtail.js';
import { resolveEntity, resolvePassword } from './helpers.js';
import { tr } from '../i18n/index.js';

/** Resolve a server, or fall back to a tunnel (both are connection targets). */
async function resolveServerLike(
  name: string | undefined,
  message: string,
): Promise<Server | null> {
  const server = await resolveEntity(servers, name, message);
  return server;
}

export async function checkTarget(target: ConnectionTarget, label: string): Promise<boolean> {
  ui.printSection('🔎', tr.actions.checkSection(label));
  const result = await healthCheck(target);
  if (result.open) {
    ui.printOk(tr.actions.reachable(result.host, result.port, result.ms));
  } else {
    ui.printError(tr.actions.unreachable(result.host, result.port, result.ms));
  }
  return result.open;
}

export async function checkFlow(name?: string, opts: { json?: boolean } = {}): Promise<number> {
  // try servers first, then tunnels
  const server = name ? servers.findByName(name) : null;
  const tunnel = !server && name ? tunnels.findByName(name) : null;
  const direct = server ?? tunnel;

  if (opts.json) {
    if (!direct) {
      ui.printError(tr.actions.notFoundJson(name ?? ''));
      return 1;
    }
    const res = await healthCheck(direct);
    console.log(JSON.stringify({ name: direct.name, ...res }, null, 2));
    return res.open ? 0 : 2;
  }

  if (direct) return (await checkTarget(direct, direct.name)) ? 0 : 2;

  const picked = await resolveServerLike(name, tr.actions.pickCheck);
  if (!picked) return 0;
  return (await checkTarget(picked, picked.name)) ? 0 : 2;
}

// ---------- fleet status (mass parallel check) ----------

export interface StatusOptions {
  json?: boolean;
  /** restrict to servers only / tunnels only */
  serversOnly?: boolean;
  tunnelsOnly?: boolean;
  /** restrict to entities carrying this tag */
  tag?: string;
}

function fleetTargets(opts: StatusOptions): FleetTarget[] {
  const out: FleetTarget[] = [];
  const tagged = (tags: string[]): boolean => !opts.tag || tags.includes(opts.tag);
  if (!opts.tunnelsOnly)
    for (const s of servers.all())
      if (tagged(s.tags)) out.push({ name: s.name, kind: 'server', target: s });
  if (!opts.serversOnly)
    for (const t of tunnels.all())
      if (tagged(t.tags)) out.push({ name: t.name, kind: 'tunnel', target: t });
  return out;
}

/** Check every server/tunnel (optionally filtered) at once and show a dashboard. */
export async function statusFlow(opts: StatusOptions = {}): Promise<number> {
  const targets = fleetTargets(opts);
  if (!targets.length) {
    if (opts.json) console.log('[]');
    else ui.printWarn(tr.actions.noTargets);
    return 0;
  }
  if (!opts.json) ui.printSection('📡', tr.actions.statusChecking(targets.length));
  const results = await healthCheckAll(targets, { concurrency: 10 });
  if (opts.json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          name: r.name,
          kind: r.kind,
          host: r.result.host,
          port: r.result.port,
          open: r.result.open,
          ms: r.result.ms,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(renderStatusTable(results));
    const down = results.filter((r) => !r.result.open).length;
    if (down) ui.printWarn(tr.actions.someDown(down, results.length));
    else ui.printOk(tr.actions.allUp(results.length));
  }
  return results.some((r) => !r.result.open) ? 2 : 0;
}

// ---------- known_hosts ----------

function applyForget(host: string): number {
  const res = forgetHostKey(host);
  if (!res.ok) {
    ui.printError(res.message);
    return 1;
  }
  // ok but nothing actually matched → warn (not a success tick) so the user knows
  // trust wasn't reset, but it's not an error exit.
  if (res.removed === false) ui.printWarn(res.message);
  else ui.printOk(res.message);
  return 0;
}

/** List the readable entries currently in ~/.ssh/known_hosts. */
export function knownHostsListFlow(opts: { json?: boolean } = {}): void {
  const entries = listKnownHosts();
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (!entries.length) {
    ui.printWarn(tr.actions.knownHostsEmpty);
    return;
  }
  ui.printSection('🧾', tr.actions.knownHostsSection(entries.length));
  for (const e of entries)
    console.log(`  ${ui.chalk.bold(e.host)}  ${ui.chalk.dim(e.keyTypes.join(', '))}`);
}

/** Forget a host's saved key (`ssh-keygen -R`). With an argument: a server name
 *  resolves to its host, otherwise it's treated as a literal IP/host. Without one:
 *  pick from the actual known_hosts entries, or type an IP/host by hand. */
export async function forgetHostKeyFlow(name?: string): Promise<number> {
  if (name) {
    const server = servers.findByName(name);
    // A non-default port is stored in known_hosts as `[host]:port`, so resolve the
    // full token (not just the host) — otherwise `ssh-keygen -R host` matches
    // nothing for a custom-port server yet still reports success.
    let token = name;
    if (server) {
      const ep = resolveEndpoint(server);
      token = knownHostsToken(ep.host, ep.port);
    }
    // Destructive: drops the pinned key, disabling MITM protection for this host
    // until it is trusted again. Confirm first (auto-yes under --yes for scripts).
    const ok = await ui.confirm({
      message: tr.actions.forgetConfirm(token),
      default: false,
    });
    if (!ok) {
      ui.printInfo(tr.common.cancelled);
      return 0;
    }
    return applyForget(token);
  }

  ui.ensureInteractive(tr.actions.knownHostsEnsure);
  const entries = listKnownHosts();
  type Item = { kind: 'manual' } | { kind: 'entry'; entry: KnownHost };
  const items: Item[] = [
    { kind: 'manual' },
    ...entries.map((entry) => ({ kind: 'entry' as const, entry })),
  ];
  const picked = await ui.pickFromList<Item>({
    message: tr.actions.forgetPick,
    items,
    render: (it) =>
      it.kind === 'manual'
        ? ui.chalk.green(tr.actions.manualEntry)
        : `${ui.chalk.bold(it.entry.host)}  ${ui.chalk.dim(it.entry.keyTypes.join(', '))}`,
    search: (it) => (it.kind === 'manual' ? tr.actions.manualSearch : it.entry.host),
    pageSize: 14,
  });
  if (picked === ui.BACK) return 0;

  let host: string;
  if (picked.kind === 'manual') {
    host = (
      await ui.text({
        message: tr.actions.manualPrompt,
        validate: (v) => v.trim().length > 0 || tr.common.notEmpty,
      })
    ).trim();
  } else {
    host = picked.entry.host;
  }
  return host ? applyForget(host) : 0;
}

// ---------- tag groups ----------

export function groupListFlow(opts: { json?: boolean } = {}): void {
  const counts = new Map<string, number>();
  for (const s of servers.all()) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of tunnels.all())
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (opts.json) {
    console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
    return;
  }
  if (!rows.length) {
    ui.printWarn(tr.actions.groupsEmpty);
    return;
  }
  ui.printSection('🏷', tr.actions.groupsSection(rows.length));
  for (const [tag, n] of rows)
    console.log(`  ${ui.chalk.cyan('#' + tag)}  ${ui.chalk.dim(`${n}`)}`);
}

/** Check every entity carrying a tag (parallel). */
export async function groupCheckFlow(tag: string, opts: { json?: boolean } = {}): Promise<number> {
  if (!tag.trim()) {
    ui.printError(tr.actions.groupNeedsTag);
    return 1;
  }
  return statusFlow({ tag: tag.trim(), json: opts.json });
}

/** Run one command on every server carrying a tag, in parallel, with a per-host
 *  output dump and an exit-code summary (a tiny pssh). Password-auth servers are
 *  skipped: a parallel captured run can't host the interactive sshpass lifecycle
 *  (same rule as background tunnels/transfers). */
export async function groupRunFlow(
  tag: string,
  command: string[],
  opts: { json?: boolean } = {},
): Promise<number> {
  if (!tag.trim()) {
    ui.printError(tr.actions.groupRunNeedsTag);
    return 1;
  }
  const tagged = servers.all().filter((s) => s.tags.includes(tag.trim()));
  if (!tagged.length) {
    if (opts.json) console.log('[]');
    else ui.printWarn(tr.actions.groupRunNoServers(tag.trim()));
    return 0;
  }
  const skipped = tagged.filter((s) => s.auth === 'password');
  const targets = tagged.filter((s) => s.auth !== 'password');

  let cmd = command;
  if (!cmd.length) {
    // JSON mode is for scripts — never open an interactive prompt there (a
    // non-TTY would die on ensureInteractive AFTER promising machine output).
    if (opts.json) {
      ui.printError(tr.actions.groupRunJsonNeedsCommand);
      return 1;
    }
    ui.ensureInteractive(tr.actions.runEnsure);
    const line = await ui.text({
      message: tr.actions.runPrompt,
      validate: (v) => v.trim().length > 0 || tr.common.empty,
    });
    // ssh space-joins the remote argv and the remote shell re-splits it, so the
    // line must travel as ONE quoted sh argument or only its first word runs.
    cmd = ['sh', '-lc', shQuote(line)];
  }

  // Skipped password-auth hosts must stay visible in JSON too — otherwise a
  // script concludes every tagged host ran the command.
  const skippedJson = skipped.map((s) => ({
    name: s.name,
    code: null,
    stdout: '',
    stderr: '',
    skipped: 'password-auth',
  }));
  if (skipped.length && !opts.json)
    ui.printWarn(tr.actions.groupRunSkippedPassword(skipped.map((s) => s.name).join(', ')));
  if (!targets.length) {
    if (opts.json) console.log(JSON.stringify(skippedJson, null, 2));
    else ui.printError(tr.actions.groupRunNoTargets(tag.trim()));
    return 1;
  }

  if (!opts.json) ui.printSection('⚡', tr.actions.groupRunSection(tag.trim(), targets.length));
  const results = await runCommandOnAll(targets, cmd, { concurrency: 8 });
  for (const s of targets) servers.touch(s.id);

  if (opts.json) {
    console.log(JSON.stringify([...results, ...skippedJson], null, 2));
    return results.some((r) => r.code !== 0) ? 1 : 0;
  }
  for (const r of results) {
    const ok = r.code === 0;
    const head = ok
      ? `${ui.chalk.green('✔')} ${ui.chalk.bold(r.name)}`
      : `${ui.chalk.red('✖')} ${ui.chalk.bold(r.name)}  ${ui.chalk.red(
          r.code === null ? tr.actions.groupRunTimedOut : tr.actions.groupRunExit(r.code),
        )}`;
    console.log('\n' + head);
    // Success → stdout only (stderr is usually motd/banner noise); failure →
    // both streams, since the reason typically lands on stderr.
    const body = (ok ? r.stdout : `${r.stdout}${r.stderr}`).trimEnd();
    if (body)
      console.log(
        body
          .split('\n')
          .map((l) => '  ' + l)
          .join('\n'),
      );
  }
  const fail = results.filter((r) => r.code !== 0).length;
  console.log('');
  if (fail) ui.printWarn(tr.actions.groupRunSummaryFail(fail, results.length));
  else ui.printOk(tr.actions.groupRunSummaryOk(results.length));
  return fail ? 1 : 0;
}

export async function copyIdFlow(name?: string): Promise<number> {
  const server = await resolveServerLike(name, tr.actions.copyIdPick);
  if (!server) return 0;

  // Pick a public/identity key to install. A server with a known IdentityFile
  // (incl. config-backed servers) reuses it; otherwise we offer a picker.
  let keyPath: string | null = server.keyPath ?? null;
  const found = findSshKeys();
  if (!keyPath && found.length) {
    const DEFAULT = '__default__';
    const choice = await ui.choose<string>({
      message: tr.actions.copyIdKeyQuestion,
      choices: [
        ...found.map((k) => ({ name: `${tilde(k)}`, value: k })),
        { name: tr.actions.copyIdDefaultChoice, value: DEFAULT },
      ],
    });
    keyPath = choice === DEFAULT ? null : choice;
  }

  const password = await resolvePassword(server);
  ui.printSection('📋', tr.actions.copyIdSection(targetSummary(server)));
  try {
    const code = await copyId(server, keyPath, password);
    if (code === 0) ui.printOk(tr.actions.copyIdOk);
    else ui.printError(tr.actions.copyIdFailed(code));
    return code;
  } catch (e) {
    ui.printError((e as Error).message);
    return 1;
  }
}

export async function runFlow(
  name: string | undefined,
  command: string[],
  opts: { snippet?: string } = {},
): Promise<number> {
  const server = await resolveServerLike(name, tr.actions.runPick);
  if (!server) return 0;
  let cmd = command;
  if (!cmd.length && opts.snippet) {
    const sn = snippets.findByName(opts.snippet);
    if (!sn) {
      ui.printError(tr.actions.snippetNotFound(opts.snippet));
      return 1;
    }
    // A server-bound snippet must not run elsewhere — the interactive picker
    // enforces this via forServer(), the flag path has to as well.
    if (sn.server && sn.server.toLowerCase() !== server.name.toLowerCase()) {
      ui.printError(tr.actions.snippetWrongServer(sn.name, sn.server));
      return 1;
    }
    cmd = ['sh', '-lc', shQuote(sn.command)];
  }
  if (!cmd.length) {
    ui.ensureInteractive(tr.actions.runEnsure);
    // Offer the saved snippets applicable to this server before falling back to
    // a typed command — the repeated-command case is what snippets exist for.
    let line: string | null = null;
    const available = snippets.forServer(server.name);
    if (available.length) {
      type Item = { kind: 'manual' } | { kind: 'snippet'; snippet: Snippet };
      const items: Item[] = [
        { kind: 'manual' },
        ...available.map((snippet) => ({ kind: 'snippet' as const, snippet })),
      ];
      const picked = await ui.pickFromList<Item>({
        message: tr.actions.runPickSnippet,
        items,
        render: (it) =>
          it.kind === 'manual'
            ? ui.chalk.green(tr.actions.runManualEntry)
            : `${ui.chalk.bold(it.snippet.name)}  ${ui.chalk.dim(it.snippet.command)}`,
        search: (it) =>
          it.kind === 'manual'
            ? tr.actions.manualSearch
            : `${it.snippet.name} ${it.snippet.command}`,
        pageSize: 14,
      });
      if (picked === ui.BACK) return 0;
      if (picked.kind === 'snippet') line = picked.snippet.command;
    }
    if (line === null) {
      line = await ui.text({
        message: tr.actions.runPrompt,
        validate: (v) => v.trim().length > 0 || tr.common.empty,
      });
    }
    // ssh space-joins the remote argv and the remote shell re-splits it, so the
    // line must travel as ONE quoted sh argument or only its first word runs.
    cmd = ['sh', '-lc', shQuote(line)];
  }
  const password = await resolvePassword(server);
  servers.touch(server.id);
  ui.printSection('⚡', tr.actions.runSection(targetSummary(server)));
  return runCommand(server, cmd, password);
}

/** CLI flags for a (possibly non-interactive) transfer. Anything omitted is
 *  prompted for in an interactive session, or filled from the saved transfer
 *  defaults / errors when scripted. */
export interface TransferCliOptions {
  tool?: TransferTool;
  direction?: 'upload' | 'download';
  local?: string;
  remote?: string;
  recursive?: boolean;
  compress?: boolean;
  delete?: boolean;
  dryRun?: boolean;
  /** run detached in the background (key/agent auth only) */
  bg?: boolean;
}

export async function transferFlow(name?: string, cli: TransferCliOptions = {}): Promise<number> {
  const server = await resolveServerLike(name, tr.actions.transferPick);
  if (!server) return 0;
  const def = settings.get().transfer;
  const interactive = ui.isInteractive() && !ui.runtime.nonInteractive;

  // tool: flag → interactive picker (rsync only when installed) → saved default.
  let tool: TransferTool;
  const rsyncOk = commandExists('rsync');
  if (cli.tool) tool = cli.tool;
  else if (interactive) {
    const choices: Array<{ name: string; value: TransferTool }> = [
      { name: tr.actions.scpChoice, value: 'scp' },
    ];
    if (rsyncOk) choices.unshift({ name: tr.actions.rsyncChoice, value: 'rsync' });
    tool =
      choices.length > 1
        ? await ui.choose<TransferTool>({
            message: tr.actions.toolQuestion,
            choices,
            default: rsyncOk ? def.tool : 'scp',
          })
        : 'scp';
  } else tool = def.tool;

  // direction + paths: flag → prompt → (scripted) a clear error instead of hanging.
  let direction = cli.direction;
  if (!direction) {
    if (!interactive) throw new WizardError(tr.actions.transferNeedDirection);
    direction = await ui.choose<'upload' | 'download'>({
      message: tr.actions.directionQuestion,
      choices: [
        { name: tr.actions.uploadChoice, value: 'upload' },
        { name: tr.actions.downloadChoice, value: 'download' },
      ],
    });
  }
  let localPath = cli.local;
  // A blank/whitespace flag (`--local ''`) bypassed the non-empty check before and
  // produced an empty scp/rsync operand; treat it like "not provided".
  if (localPath === undefined || !localPath.trim()) {
    if (!interactive) throw new WizardError(tr.actions.transferNeedLocal);
    // Browse for the local path. Upload → must exist (a file, or a folder via its
    // "choose this folder" row); download → the target may be a new file/folder.
    localPath = await ui.promptPath({
      message: tr.actions.localPath,
      select: 'any',
      allowCreate: direction === 'download',
    });
  }
  let remotePath = cli.remote;
  if (remotePath === undefined || !remotePath.trim()) {
    if (!interactive) throw new WizardError(tr.actions.transferNeedRemote);
    remotePath = await ui.text({
      message: tr.actions.remotePath,
      validate: (v) => v.trim().length > 0 || tr.common.empty,
    });
  }

  // each toggle: explicit flag → interactive prompt → saved default. Under `--yes`
  // (assumeYes) we must NOT route through ui.confirm: it answers "yes" to every
  // confirmation, which would silently force --delete (destructive) and --dry-run
  // (a no-op transfer that still reports success). Treat --yes as "accept the
  // configured default" for these toggles, not "turn everything on".
  const ask = async (
    flag: boolean | undefined,
    message: string,
    dflt: boolean,
  ): Promise<boolean> => {
    if (flag !== undefined) return flag;
    if (interactive && !ui.runtime.assumeYes) return ui.confirm({ message, default: dflt });
    return dflt;
  };
  const opts: TransferOptions = { direction, localPath, remotePath, tool };
  if (tool === 'rsync') {
    opts.archive = true;
    opts.compress = await ask(cli.compress, tr.actions.rsyncCompress, def.compress);
    opts.delete = await ask(cli.delete, tr.actions.rsyncDelete, def.delete);
    opts.dryRun = await ask(cli.dryRun, tr.actions.rsyncDryRun, false);
  } else {
    opts.recursive = await ask(cli.recursive, tr.actions.scpRecursive, def.recursive);
  }

  // Background: spawn detached, log to a file, register a session to monitor.
  if (cli.bg) {
    // A detached process can't carry the SSHPASS lifecycle safely (same reason
    // background tunnels are key/agent-only), so refuse password auth here.
    if (server.auth === 'password') {
      ui.printError(tr.actions.transferBgNoPassword);
      return 1;
    }
    const { program, args } = transferArgv(server, opts);
    if (!commandExists(program)) {
      ui.printError(
        program === 'rsync' ? tr.ssh.featuresRsyncNotFound : tr.ssh.featuresScpNotFound,
      );
      return 1;
    }
    const id = newId();
    const { pid, logFile } = startTransferDetached(program, args, id);
    if (pid <= 0) {
      ui.printError(tr.actions.transferBgFailed);
      return 1;
    }
    const dest = `${destination(server)}:${remotePath}`;
    const summary = direction === 'upload' ? `${localPath} → ${dest}` : `${dest} → ${localPath}`;
    transferSessions.add({ id, name: server.name, tool, direction, summary, pid, logFile });
    ui.printOk(tr.actions.transferBgStarted(pid));
    ui.printInfo(tr.actions.transferBgMonitor(id));
    return 0;
  }

  const password = await resolvePassword(server);
  ui.printSection('📂', tr.actions.transferSection(tool, direction, targetSummary(server)));
  try {
    const code = await transfer(server, opts, password);
    if (code === 0) ui.printOk(tr.actions.transferOk);
    else ui.printError(tr.actions.transferFailed(tool, code));
    return code;
  } catch (e) {
    ui.printError((e as Error).message);
    return 1;
  }
}

/** List the file transfers currently running in the background (reaps finished). */
export function transferSessionsFlow(opts: { json?: boolean } = {}): void {
  const live = transferSessions.list();
  if (opts.json) {
    console.log(JSON.stringify(live, null, 2));
    return;
  }
  if (!live.length) {
    ui.printWarn(tr.actions.transferBgNone);
    return;
  }
  ui.printSection('🟢', tr.actions.transferBgSection(live.length));
  for (const s of live) {
    console.log(
      `  ${ui.chalk.bold(s.name)}  ${ui.chalk.dim(`${s.tool} ${s.direction}`)}  ${s.summary}` +
        `  ${ui.chalk.dim(`pid ${s.pid} · ${s.id.slice(0, 8)}`)}`,
    );
  }
}

/** Show (and optionally follow) a background transfer's log, picked by id/name. */
export async function transferLogsFlow(
  id?: string,
  opts: { tail?: number; follow?: boolean } = {},
): Promise<number> {
  const live = transferSessions.list();
  if (!live.length) {
    ui.printWarn(tr.actions.transferBgNone);
    return 0;
  }
  let target: TransferSession;
  if (id) {
    // Prefer an EXACT id, then an exact name; only then fall back to an id-prefix.
    // Two background transfers to the same server share a `name`, so a prefix/name
    // match can be ambiguous — surface that instead of silently picking the first.
    const lower = id.toLowerCase();
    const exact = live.find((s) => s.id === id);
    const matches =
      exact !== undefined
        ? [exact]
        : live.filter((s) => s.id.startsWith(id) || s.name.toLowerCase() === lower);
    if (matches.length === 0) {
      ui.printError(tr.actions.transferBgNotFound(id));
      return 1;
    }
    if (matches.length > 1) {
      ui.printError(tr.actions.transferBgAmbiguous(id));
      for (const s of matches)
        console.log(`  ${ui.chalk.bold(s.name)}  ${ui.chalk.dim(s.id.slice(0, 12))}  ${s.summary}`);
      return 1;
    }
    target = matches[0]!;
  } else if (live.length === 1) {
    target = live[0]!;
  } else {
    ui.ensureInteractive(tr.actions.transferBgLogsEnsure);
    const picked = await ui.pickFromList<TransferSession>({
      message: tr.actions.transferBgPick,
      items: live,
      render: (s) => `${ui.chalk.bold(s.name)}  ${ui.chalk.dim(s.summary)}  pid ${s.pid}`,
      search: (s) => `${s.name} ${s.summary}`,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    target = picked;
  }

  if (!fs.existsSync(target.logFile)) {
    ui.printWarn(tr.actions.transferBgLogMissing(tilde(target.logFile)));
    return 1;
  }
  ui.printSection('📜', tr.actions.transferBgLogsSection(target.name, tilde(target.logFile)));
  const lines = tailFile(target.logFile, opts.tail ?? 40);
  if (lines.length) console.log(lines.join('\n'));
  if (opts.follow) {
    ui.printInfo(ui.chalk.dim(tr.actions.transferBgFollowHint));
    await followLog(target.logFile);
  }
  return 0;
}
