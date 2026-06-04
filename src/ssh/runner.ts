/** Spawn `ssh` (optionally wrapped in `sshpass`) for interactive connects and
 *  for tunnels, with careful lifecycle + fast-fail diagnostics. */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type StdioOptions } from 'node:child_process';
import boxen from 'boxen';
import type { ConnectionTarget, Server, Tunnel } from '../core/types.js';
import { FILES, ensureDir } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { expandHome } from '../utils/strings.js';
import { isValidPort } from '../utils/validators.js';
import { openInBrowser } from '../utils/platform.js';
import { chalk, accent } from '../ui/theme.js';
import { printSection, printInfo, printOk, printWarn, printError } from '../ui/messages.js';
import { confirm, isInteractive } from '../ui/prompts.js';
import { targetSummary } from '../ui/format.js';
import { tr } from '../i18n/index.js';
import { buildConnectArgs, buildMoshArgs, buildTunnelArgs, type ConnectOptions } from './args.js';
import { parseSshGOutput } from './gconfig.js';
import { forgetHostKey, isHostKeyError, knownHostsToken } from './hostkey.js';

export interface PreflightOptions {
  /** tunnels need valid forward ports */
  forwardPorts?: { local: number; remote: number | null; type: string };
}

/** Validate a target before spawning. Returns null when OK, else a message. */
export function preflight(t: ConnectionTarget, opts: PreflightOptions = {}): string | null {
  if (!commandExists('ssh')) return tr.ssh.runnerSshNotFound;

  if (t.hostMode === 'sshconfig') {
    if (!t.sshHost.trim()) return tr.ssh.runnerNoSshConfigAlias;
  } else if (!t.host.trim()) {
    return tr.ssh.runnerNoHost;
  }

  if (opts.forwardPorts) {
    const { local, remote, type } = opts.forwardPorts;
    if (!isValidPort(local)) return tr.ssh.runnerBadLocalPort(local);
    if (type !== 'dynamic' && !isValidPort(remote))
      return tr.ssh.runnerBadRemotePort(remote as number);
  }

  if (t.auth === 'key') {
    if (!t.keyPath) return tr.ssh.runnerKeyPathMissing;
    if (!fs.existsSync(expandHome(t.keyPath)))
      return tr.ssh.runnerKeyNotFound(expandHome(t.keyPath));
  }
  if (t.auth === 'password' && !commandExists('sshpass')) {
    return tr.ssh.runnerSshpassMissing;
  }
  return null;
}

interface SpawnResult {
  code: number;
  startedAt: number;
  /** ssh's stderr, captured only when `captureStderr` was requested (else ''). */
  stderr: string;
}

/** Core spawn: wraps in sshpass when a password is given. stdio inherited.
 *  `program` is normally `ssh`, but `scp`/`ssh-copy-id` reuse this too.
 *  With `captureStderr`, ssh's stderr is teed through to the terminal AND
 *  collected (capped) so the caller can react to diagnostics like a host-key
 *  mismatch — stdin/stdout stay attached to the tty so the shell works normally. */
function spawnPass(
  program: string,
  programArgs: string[],
  password: string | undefined,
  onSpawn?: () => void,
  captureStderr = false,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let cmd = program;
    let args = programArgs;
    let env: NodeJS.ProcessEnv = process.env;

    if (password !== undefined) {
      // sshpass -e reads the password from the child's SSHPASS env var. Unlike a
      // temp file this never touches disk — so a SIGKILL/crash can't leave the
      // plaintext password behind in /tmp — and needs no exit-time cleanup hook
      // (the old `process.on('exit')` per-spawn leaked listeners on reconnects).
      cmd = 'sshpass';
      args = ['-e', program, ...programArgs];
      env = { ...process.env, SSHPASS: password };
    }

    const stdio: StdioOptions = captureStderr ? ['inherit', 'inherit', 'pipe'] : 'inherit';
    const startedAt = Date.now();
    const child = spawn(cmd, args, { stdio, env });
    onSpawn?.();

    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(d); // keep the user seeing ssh's own output
      if (stderr.length < 16_384) stderr += d.toString('utf8');
    });

    const onSigint = (): void => {
      if (!child.killed) child.kill('SIGINT');
    };
    process.on('SIGINT', onSigint);

    const done = (code: number): void => {
      process.removeListener('SIGINT', onSigint);
      resolve({ code, startedAt, stderr });
    };

    child.on('error', (e: Error) => {
      printError(tr.ssh.runnerSpawnFailed(cmd, e.message));
      done(1);
    });
    child.on('close', (code) => done(code ?? 0));
  });
}

/** Resolve a target to the host:port that ssh records in known_hosts (follows
 *  ~/.ssh/config via `ssh -G`). Uses the shared leaf parser (ssh/gconfig) so the
 *  resolution stays identical to features' endpoint resolver. */
function knownHostsTarget(t: ConnectionTarget): string {
  if (t.hostMode === 'sshconfig') {
    const res = capture('ssh', ['-G', t.sshHost]);
    const { host, port } =
      res.status === 0 ? parseSshGOutput(res.stdout, t.sshHost, 22) : { host: t.sshHost, port: 22 };
    return knownHostsToken(host, port);
  }
  return knownHostsToken(t.host, t.sshPort || 22);
}

/** After a host-key verification failure: offer to forget the stale key and
 *  reconnect. Returns true when the key was removed (caller should retry). */
async function offerForgetHostKey(target: ConnectionTarget): Promise<boolean> {
  if (!isInteractive()) {
    printWarn(tr.ssh.runnerHostKeyChangedNonInteractive);
    return false;
  }
  const token = knownHostsTarget(target);
  printWarn(tr.ssh.runnerHostKeyChanged);
  const ok = await confirm({
    message: tr.ssh.runnerForgetPrompt(token),
    default: false,
  });
  if (!ok) {
    printInfo(tr.ssh.runnerKeptAsIs);
    return false;
  }
  const res = forgetHostKey(token);
  if (!res.ok) {
    printError(res.message);
    return false;
  }
  printOk(tr.ssh.runnerKeyForgotten);
  return true;
}

/** Run ssh with the given args (stdio inherited); resolve with exit code. */
export async function runSshInherit(args: string[], password?: string): Promise<number> {
  const { code } = await spawnPass('ssh', args, password);
  return code;
}

/** Run an arbitrary program (scp, ssh-copy-id) optionally via sshpass. */
export async function runProgram(
  program: string,
  args: string[],
  password?: string,
): Promise<number> {
  const { code } = await spawnPass(program, args, password);
  return code;
}

/** Interactive shell session to a server. Resolves with the exit code. On a
 *  host-key verification failure it offers to forget the stale key and reconnect
 *  once. */
export async function runInteractive(
  server: Server,
  password?: string,
  opts: ConnectOptions = {},
): Promise<number> {
  const err = preflight(server);
  if (err) {
    printError(err);
    return 1;
  }
  printSection('▶', tr.ssh.runnerConnecting(server.name));
  console.log(chalk.dim('  ' + targetSummary(server)) + '\n');

  const sshArgs = buildConnectArgs(server, opts);
  let triedForget = false;
  for (;;) {
    const { code, stderr } = await spawnPass('ssh', sshArgs, password, undefined, true);
    console.log('');

    // Reactive recovery: a changed host key fails fast with code 255.
    if (code !== 0 && !triedForget && isHostKeyError(stderr)) {
      triedForget = true;
      if (await offerForgetHostKey(server)) continue; // reconnect once
    }

    if (code === 0 || code === 130 || code === 255) printInfo(chalk.dim(tr.ssh.runnerSessionDone));
    else printError(tr.ssh.runnerSshExited(code));
    return code && code !== 130 ? code : 0;
  }
}

/** Connect via mosh (UDP, survives roaming/flaky links and sleep). mosh wraps
 *  ssh for the handshake. Password auth is unsupported by mosh — callers must
 *  route those to {@link runInteractive}. Resolves with the exit code. */
export async function runMosh(server: Server): Promise<number> {
  if (!commandExists('mosh')) {
    printError(tr.ssh.moshNotFound);
    return 1;
  }
  const err = preflight(server);
  if (err) {
    printError(err);
    return 1;
  }
  printSection('▶', tr.ssh.moshConnecting(server.name));
  console.log(chalk.dim('  ' + targetSummary(server)) + '\n');
  const { code } = await spawnPass('mosh', buildMoshArgs(server), undefined);
  console.log('');
  if (code === 0 || code === 130) printInfo(chalk.dim(tr.ssh.runnerSessionDone));
  else printError(tr.ssh.runnerSshExited(code));
  return code && code !== 130 ? code : 0;
}

export interface ReconnectDecision {
  reconnect: boolean;
  /** the attempt counter to carry into the next iteration */
  nextAttempt: number;
  delayMs: number;
  reason: 'interrupted' | 'clean-exit' | 'dropped' | 'retry' | 'gave-up';
}

const TUNNEL_HEALTHY_MS = 30_000;
const TUNNEL_MAX_SHORT_RETRIES = 5;

/** Exponential backoff in ms: 1s, 2s, 4s, 8s, 16s, capped at 30s. */
export function tunnelBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/** Pure auto-reconnect policy for a dropped tunnel. Never reconnect on a clean
 *  exit (0) or user interrupt (130); reconnect promptly after a long-lived drop
 *  (resetting backoff); bound rapid failures so a misconfig never hot-loops. */
export function decideReconnect(
  code: number,
  durationMs: number,
  attempt: number,
): ReconnectDecision {
  if (code === 130)
    return { reconnect: false, nextAttempt: attempt, delayMs: 0, reason: 'interrupted' };
  if (code === 0)
    return { reconnect: false, nextAttempt: attempt, delayMs: 0, reason: 'clean-exit' };
  if (durationMs >= TUNNEL_HEALTHY_MS)
    return { reconnect: true, nextAttempt: 1, delayMs: tunnelBackoffMs(1), reason: 'dropped' };
  const nextAttempt = attempt + 1;
  if (nextAttempt > TUNNEL_MAX_SHORT_RETRIES)
    return { reconnect: false, nextAttempt, delayMs: 0, reason: 'gave-up' };
  return { reconnect: true, nextAttempt, delayMs: tunnelBackoffMs(nextAttempt), reason: 'retry' };
}

/** A delay that resolves early (true) when `stopped()` becomes true. */
function interruptibleDelay(ms: number, stopped: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (stopped()) return resolve(true);
      if (Date.now() - started >= ms) return resolve(false);
      setTimeout(tick, Math.min(150, ms));
    };
    tick();
  });
}

function tunnelUpBox(tunnel: Tunnel, restored: boolean): string {
  const localUrl = `http://localhost:${tunnel.localPort}`;
  if (restored) {
    return (
      '\n' + chalk.green(tr.ssh.runnerTunnelRestored) + chalk.dim(`  → ${targetSummary(tunnel)}`)
    );
  }
  const lines = [chalk.bold.green(tr.ssh.runnerTunnelUp), ''];
  if (tunnel.type === 'local')
    lines.push(chalk.white((tunnel.description || tunnel.name) + ':  ') + accent(localUrl));
  else if (tunnel.type === 'dynamic')
    lines.push(chalk.white('SOCKS5 proxy:  ') + accent(`localhost:${tunnel.localPort}`));
  else
    lines.push(
      chalk.white(tr.ssh.runnerReverseActive) +
        chalk.dim(`  (server:${tunnel.remotePort} → ${tunnel.remoteHost}:${tunnel.localPort})`),
    );
  lines.push(chalk.dim(`→ ${targetSummary(tunnel)}`), '', chalk.dim(tr.ssh.runnerCloseHint));
  return '\n' + boxen(lines.join('\n'), { padding: 1, borderStyle: 'round', borderColor: 'green' });
}

export interface RunTunnelOptions {
  /** auto-restart the tunnel on an unexpected drop (until Ctrl+C). */
  autoReconnect?: boolean;
}

/** Bring up a tunnel and keep it running until Ctrl+C, optionally auto-restarting
 *  on an unexpected drop with exponential backoff. */
export async function runTunnel(
  tunnel: Tunnel,
  password?: string,
  opts: RunTunnelOptions = {},
): Promise<number> {
  const err = preflight(tunnel, {
    forwardPorts: { local: tunnel.localPort, remote: tunnel.remotePort, type: tunnel.type },
  });
  if (err) {
    printError(err);
    return 1;
  }

  const localUrl = `http://localhost:${tunnel.localPort}`;
  const sshArgs = buildTunnelArgs(tunnel);
  const autoReconnect = opts.autoReconnect ?? false;
  printSection('▶', tr.ssh.runnerRaisingTunnel(tunnel.name));
  console.log(chalk.dim('  $ ') + chalk.cyan('ssh') + ' ' + chalk.gray(sshArgs.join(' ')));
  if (autoReconnect) printInfo(chalk.dim(tr.ssh.runnerAutoReconnectHint));

  let opened = false;
  let raises = 0;
  let attempt = 0;
  let stop = false;
  let triedForget = false;
  let lastCode = 0;
  let lastStartedAt = Date.now();

  const onInt = (): void => {
    stop = true;
  };
  // In auto mode we own SIGINT at the loop level so Ctrl+C stops cleanly during
  // a backoff wait too (and never tears the process down mid-reconnect).
  if (autoReconnect) process.on('SIGINT', onInt);

  try {
    for (;;) {
      let upTimer: NodeJS.Timeout | undefined;
      const { code, startedAt, stderr } = await spawnPass(
        'ssh',
        sshArgs,
        password,
        () => {
          upTimer = setTimeout(() => {
            const restored = raises > 0;
            console.log(tunnelUpBox(tunnel, restored));
            raises++;
            // A confirmed-healthy run re-arms host-key recovery: a SECOND
            // legitimate key rotation later in this long-lived tunnel should be
            // offered the interactive forget again, not silently burn the
            // short-retry budget reconnecting against a stale key.
            triedForget = false;
            if (tunnel.type === 'local' && tunnel.openBrowser && !opened) {
              opened = true;
              openInBrowser(localUrl);
            }
          }, 1500);
        },
        true,
      );
      if (upTimer) clearTimeout(upTimer);
      lastCode = code;
      lastStartedAt = startedAt;

      if (stop) break;
      // A changed host key would just hot-loop the auto-reconnect — offer to
      // forget the stale key and retry once instead.
      if (code !== 0 && !triedForget && isHostKeyError(stderr)) {
        triedForget = true;
        if (await offerForgetHostKey(tunnel)) {
          attempt = 0;
          continue;
        }
        break;
      }
      if (!autoReconnect) break;
      const decision = decideReconnect(code, Date.now() - startedAt, attempt);
      if (!decision.reconnect) {
        if (decision.reason === 'gave-up') printWarn(tr.ssh.runnerTooManyRetries);
        break;
      }
      attempt = decision.nextAttempt;
      console.log('');
      printWarn(tr.ssh.runnerReconnecting(code, Math.round(decision.delayMs / 1000), attempt));
      if (await interruptibleDelay(decision.delayMs, () => stop)) break;
    }
  } finally {
    if (autoReconnect) process.removeListener('SIGINT', onInt);
  }

  const code = lastCode;
  const fast = Date.now() - lastStartedAt < 2500;
  console.log('');
  if (code === 0 || code === 130 || code === 255) printInfo(chalk.dim(tr.ssh.runnerTunnelClosed));
  else printError(tr.ssh.runnerSshExited(code));
  if (!autoReconnect && fast && code && code !== 130) {
    printWarn(tr.ssh.runnerPossibleConnectError(tunnel.localPort));
  }
  return code && code !== 130 ? code : 0;
}

export interface DetachedTunnel {
  pid: number;
  logFile: string;
}

/** Start a tunnel as a detached background process, logging to a file. Only safe
 *  for agent/key auth (a password tunnel would need an sshpass/SSHPASS lifecycle
 *  tied to this process) — the caller must guard that. */
export function startTunnelDetached(tunnel: Tunnel): DetachedTunnel {
  ensureDir(FILES.logsDir);
  const logFile = path.join(FILES.logsDir, `tunnel-${tunnel.id}.log`);
  // 0o600: tunnel logs can carry ssh's verbose diagnostics — keep them readable
  // only by the owner (the mode arg applies on creation; tighten a pre-existing
  // world-readable log too).
  const fd = fs.openSync(logFile, 'a', 0o600);
  try {
    fs.chmodSync(logFile, 0o600);
  } catch {
    /* best-effort */
  }
  try {
    const child = spawn('ssh', buildTunnelArgs(tunnel), {
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    child.unref();
    return { pid: child.pid ?? -1, logFile };
  } finally {
    fs.closeSync(fd);
  }
}
