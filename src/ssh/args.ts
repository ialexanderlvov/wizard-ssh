/** Build `ssh` argument vectors for connecting and for forward/reverse/dynamic
 *  tunnels. The destination is either a ~/.ssh/config alias or user@host. */

import type { ConnectionTarget, Tunnel } from '../core/types.js';
import { expandHome } from '../utils/strings.js';

const ROBUST_OPTS = [
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=30',
  '-o',
  'ServerAliveCountMax=3',
];

/** Options shared by connect & tunnel (everything except the destination). */
export function targetOptions(t: ConnectionTarget): string[] {
  const args: string[] = [...ROBUST_OPTS];

  // For ad-hoc IPs/domains we relax host-key checking for friction-free use.
  // For named ~/.ssh/config hosts we keep the user's normal host-key policy.
  if (t.hostMode !== 'sshconfig') {
    args.push('-o', 'StrictHostKeyChecking=accept-new');
    if (t.sshPort && Number(t.sshPort) !== 22) args.push('-p', String(t.sshPort));
  }

  if (t.auth === 'key' && t.keyPath) {
    args.push('-i', expandHome(t.keyPath));
  } else if (t.auth === 'password') {
    args.push('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no');
  }
  return args;
}

export function destination(t: ConnectionTarget): string {
  if (t.hostMode === 'sshconfig') return t.sshHost;
  return `${t.user || 'root'}@${t.host}`;
}

/** Forward spec for a tunnel: -L (local), -R (remote/reverse), -D (dynamic). */
export function forwardFlags(t: Tunnel): string[] {
  if (t.type === 'dynamic') return ['-D', String(t.localPort)];
  if (t.type === 'remote') {
    // Reverse: expose THIS machine's service on the server.
    // ssh -R <serverPort>:<localTargetHost>:<localTargetPort>
    return ['-R', `${t.remotePort}:${t.remoteHost || 'localhost'}:${t.localPort}`];
  }
  // Local: bring a remote service to THIS machine.
  // ssh -L <localPort>:<remoteHost>:<remotePort>
  return ['-L', `${t.localPort}:${t.remoteHost || '127.0.0.1'}:${t.remotePort}`];
}

/** Interactive shell connect: `ssh [opts] dest`. */
export function buildConnectArgs(t: ConnectionTarget): string[] {
  return [...targetOptions(t), destination(t)];
}

/** Run a one-off remote command: `ssh [opts] dest -- <cmd...>`. */
export function buildRunArgs(t: ConnectionTarget, command: string[]): string[] {
  return [...targetOptions(t), destination(t), '--', ...command];
}

/** Background tunnel: `ssh -N <forward> [opts] dest`. */
export function buildTunnelArgs(t: Tunnel): string[] {
  return [
    '-N',
    ...forwardFlags(t),
    '-o',
    'ExitOnForwardFailure=yes',
    ...targetOptions(t),
    destination(t),
  ];
}
