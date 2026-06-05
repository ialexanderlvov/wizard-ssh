/** Extra SSH capabilities: reachability check, ssh-copy-id, remote command,
 *  file transfer (scp). All operate on a saved ConnectionTarget. */

import net from 'node:net';
import type { ConnectionTarget, Server } from '../core/types.js';
import { capture, captureAsync, commandExists } from '../utils/exec.js';
import { expandHome } from '../utils/strings.js';
import { shJoin } from '../utils/shell.js';
import { destination, targetOptions, buildRunArgs, PASSWORD_NO_PROXY_OPTS } from './args.js';
import { parseSshGOutput } from './gconfig.js';
import { runProgram, runSshInherit } from './runner.js';
import { tr } from '../i18n/index.js';

export interface Endpoint {
  host: string;
  port: number;
}

/** Resolve a target to a concrete host:port (follows ~/.ssh/config via `ssh -G`). */
export function resolveEndpoint(t: ConnectionTarget): Endpoint {
  if (t.hostMode !== 'sshconfig') {
    return { host: t.host, port: t.sshPort || 22 };
  }
  const res = capture('ssh', ['-G', '--', t.sshHost]);
  return res.status === 0
    ? parseSshGOutput(res.stdout, t.sshHost, 22)
    : { host: t.sshHost, port: 22 };
}

export interface CheckResult {
  host: string;
  port: number;
  open: boolean;
  ms: number;
}

/** TCP reachability of host:port within `timeoutMs`. */
export function checkTcp(host: string, port: number, timeoutMs = 5000): Promise<CheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, open, ms: Date.now() - started });
    };
    // An out-of-range port makes socket.connect throw synchronously
    // (ERR_SOCKET_BAD_PORT), which would leave this Promise unsettled.
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      finish(false);
      return;
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

export async function healthCheck(t: ConnectionTarget): Promise<CheckResult> {
  const ep = resolveEndpoint(t);
  return checkTcp(ep.host, ep.port);
}

/** Async endpoint resolution: never blocks the event loop, so many config hosts
 *  can be resolved (and then checked) concurrently for a fleet dashboard. */
export async function resolveEndpointAsync(t: ConnectionTarget): Promise<Endpoint> {
  if (t.hostMode !== 'sshconfig') {
    return { host: t.host, port: t.sshPort || 22 };
  }
  const res = await captureAsync('ssh', ['-G', '--', t.sshHost], 10_000);
  return res.status === 0
    ? parseSshGOutput(res.stdout, t.sshHost, 22)
    : { host: t.sshHost, port: 22 };
}

export interface FleetTarget {
  name: string;
  kind: 'server' | 'tunnel';
  target: ConnectionTarget;
}

export interface FleetStatus extends FleetTarget {
  result: CheckResult;
}

/** Run an async mapper over items with a bounded concurrency, preserving order. */
async function mapPool<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as I, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Check reachability of many targets at once (bounded concurrency). */
export function healthCheckAll(
  targets: readonly FleetTarget[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<FleetStatus[]> {
  const concurrency = opts.concurrency ?? 8;
  return mapPool(targets, concurrency, async (t) => {
    const ep = await resolveEndpointAsync(t.target);
    const result = await checkTcp(ep.host, ep.port, opts.timeoutMs ?? 5000);
    return { ...t, result };
  });
}

/** Copy a public key to the server (`ssh-copy-id`). */
export async function copyId(
  server: Server,
  pubKeyPath: string | null,
  password?: string,
): Promise<number> {
  if (!commandExists('ssh-copy-id')) {
    return Promise.reject(new Error(tr.ssh.featuresCopyIdNotFound));
  }
  const args: string[] = [];
  if (pubKeyPath) args.push('-i', expandHome(pubKeyPath));
  if (server.hostMode !== 'sshconfig' && server.sshPort && server.sshPort !== 22) {
    args.push('-p', String(server.sshPort));
  }
  // ssh-copy-id runs ssh under the hood, so for password auth it must carry the
  // same proxy-disabling overrides as targetOptions — otherwise SSHPASS leaks
  // into a ProxyJump/ProxyCommand child (ssh-copy-id forwards `-o` to ssh).
  if (server.auth === 'password') {
    args.push('-o', 'PreferredAuthentications=password', ...PASSWORD_NO_PROXY_OPTS);
  }
  args.push('--', destination(server)); // end options: a leading-dash dest stays an operand
  return runProgram('ssh-copy-id', args, password);
}

/** Execute a one-off command over SSH (stdio inherited). */
export async function runCommand(
  server: Server,
  command: string[],
  password?: string,
): Promise<number> {
  return runSshInherit(buildRunArgs(server, command), password);
}

export type TransferTool = 'scp' | 'rsync';

export interface TransferOptions {
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  /** scp: copy directories recursively (rsync archive mode covers this). */
  recursive?: boolean;
  /** which transfer tool to use (default scp) */
  tool?: TransferTool;
  // rsync-only options:
  /** archive mode (-a): recurse + preserve perms/times/links. Default on for rsync. */
  archive?: boolean;
  /** compress in transit (-z) */
  compress?: boolean;
  /** delete extraneous files at the destination (--delete) */
  delete?: boolean;
  /** dry run, change nothing (-n) */
  dryRun?: boolean;
}

function buildScpArgs(t: ConnectionTarget, opts: TransferOptions): string[] {
  const args: string[] = ['-o', 'ConnectTimeout=15'];
  if (opts.recursive) args.push('-r');
  if (t.hostMode !== 'sshconfig') {
    if (t.auth !== 'password') args.push('-o', 'StrictHostKeyChecking=accept-new'); // see targetOptions
    if (t.sshPort && t.sshPort !== 22) args.push('-P', String(t.sshPort)); // scp uses -P
  }
  if (t.auth === 'key' && t.keyPath)
    args.push('-i', expandHome(t.keyPath), '-o', 'IdentitiesOnly=yes'); // pin the chosen key
  else if (t.auth === 'password')
    // Mirror targetOptions(): without these, an SSHPASS-carrying scp to a config
    // host with a ProxyJump/ProxyCommand would leak the password into that child.
    args.push(
      '-o',
      'PreferredAuthentications=password',
      '-o',
      'PubkeyAuthentication=no',
      ...PASSWORD_NO_PROXY_OPTS,
    );

  const remoteSpec = `${destination(t)}:${opts.remotePath}`;
  // `--` so a local path beginning with `-` is a file operand, not an scp option.
  return opts.direction === 'upload'
    ? [...args, '--', expandHome(opts.localPath), remoteSpec]
    : [...args, '--', remoteSpec, expandHome(opts.localPath)];
}

/** rsync over SSH. The SSH transport (port/key/auth) is passed via `-e`, so
 *  config aliases, custom ports and password auth all work the same as scp. */
function buildRsyncArgs(t: ConnectionTarget, opts: TransferOptions): string[] {
  // rsync re-splits the -e transport string, so quote each token — an unquoted
  // key path could word-split or inject ssh options (ProxyCommand → RCE).
  const sshCmd = shJoin(['ssh', ...targetOptions(t)]);
  const args: string[] = ['-e', sshCmd, '-h']; // -h: human-readable sizes
  if (opts.archive ?? true) args.push('-a');
  else if (opts.recursive) args.push('-r');
  if (opts.compress) args.push('-z');
  if (opts.delete) args.push('--delete');
  if (opts.dryRun) args.push('-n');
  // --info=progress2 shows the OVERALL transfer: percent, bytes, speed, ETA and
  // files-to-go — i.e. "% done / how much is left". -v names each file as it goes
  // so the current file is visible too. (Plain --progress is only per-file.)
  args.push('--info=progress2', '-v');

  const remoteSpec = `${destination(t)}:${opts.remotePath}`;
  // `--` so a local path beginning with `-` is a file operand, not an rsync option.
  return opts.direction === 'upload'
    ? [...args, '--', expandHome(opts.localPath), remoteSpec]
    : [...args, '--', remoteSpec, expandHome(opts.localPath)];
}

/** Resolve a transfer to the program + argv it would run — shared by the
 *  foreground {@link transfer} and the background runner so both build identical
 *  commands. */
export function transferArgv(
  server: Server,
  opts: TransferOptions,
): { program: TransferTool; args: string[] } {
  return opts.tool === 'rsync'
    ? { program: 'rsync', args: buildRsyncArgs(server, opts) }
    : { program: 'scp', args: buildScpArgs(server, opts) };
}

/** Transfer files via scp or rsync (uses the same auth as a connect). */
export async function transfer(
  server: Server,
  opts: TransferOptions,
  password?: string,
): Promise<number> {
  const { program, args } = transferArgv(server, opts);
  if (!commandExists(program)) {
    return Promise.reject(
      new Error(program === 'rsync' ? tr.ssh.featuresRsyncNotFound : tr.ssh.featuresScpNotFound),
    );
  }
  return runProgram(program, args, password);
}

export { targetOptions };
