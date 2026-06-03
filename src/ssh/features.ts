/** Extra SSH capabilities: reachability check, ssh-copy-id, remote command,
 *  file transfer (scp). All operate on a saved ConnectionTarget. */

import net from 'node:net';
import type { ConnectionTarget, Server } from '../core/types.js';
import { capture, commandExists } from '../utils/exec.js';
import { expandHome } from '../utils/strings.js';
import { destination, targetOptions, buildRunArgs } from './args.js';
import { runProgram, runSshInherit } from './runner.js';

export interface Endpoint {
  host: string;
  port: number;
}

/** Resolve a target to a concrete host:port (follows ~/.ssh/config via `ssh -G`). */
export function resolveEndpoint(t: ConnectionTarget): Endpoint {
  if (t.hostMode !== 'sshconfig') {
    return { host: t.host, port: t.sshPort || 22 };
  }
  const res = capture('ssh', ['-G', t.sshHost]);
  let host = t.sshHost;
  let port = 22;
  if (res.status === 0) {
    for (const line of res.stdout.split('\n')) {
      const [key, ...rest] = line.trim().split(/\s+/);
      const value = rest.join(' ');
      if (key === 'hostname' && value) host = value;
      else if (key === 'port' && value) port = Number(value) || 22;
    }
  }
  return { host, port };
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

/** Copy a public key to the server (`ssh-copy-id`). */
export async function copyId(
  server: Server,
  pubKeyPath: string | null,
  password?: string,
): Promise<number> {
  if (!commandExists('ssh-copy-id')) {
    return Promise.reject(new Error('ssh-copy-id не найден в PATH.'));
  }
  const args: string[] = [];
  if (pubKeyPath) args.push('-i', expandHome(pubKeyPath));
  if (server.hostMode !== 'sshconfig' && server.sshPort && server.sshPort !== 22) {
    args.push('-p', String(server.sshPort));
  }
  args.push(destination(server));
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

export interface TransferOptions {
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  recursive?: boolean;
}

function buildScpArgs(t: ConnectionTarget, opts: TransferOptions): string[] {
  const args: string[] = ['-o', 'ConnectTimeout=15'];
  if (opts.recursive) args.push('-r');
  if (t.hostMode !== 'sshconfig') {
    args.push('-o', 'StrictHostKeyChecking=accept-new');
    if (t.sshPort && t.sshPort !== 22) args.push('-P', String(t.sshPort)); // scp uses -P
  }
  if (t.auth === 'key' && t.keyPath) args.push('-i', expandHome(t.keyPath));
  else if (t.auth === 'password')
    args.push('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no');

  const remoteSpec = `${destination(t)}:${opts.remotePath}`;
  return opts.direction === 'upload'
    ? [...args, expandHome(opts.localPath), remoteSpec]
    : [...args, remoteSpec, expandHome(opts.localPath)];
}

/** Transfer files via scp (uses the same auth as a connect). */
export async function transfer(
  server: Server,
  opts: TransferOptions,
  password?: string,
): Promise<number> {
  if (!commandExists('scp')) return Promise.reject(new Error('scp не найден в PATH.'));
  return runProgram('scp', buildScpArgs(server, opts), password);
}

export { targetOptions };
