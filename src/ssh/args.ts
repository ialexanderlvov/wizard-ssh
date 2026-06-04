/** Build `ssh` argument vectors for connecting and for forward/reverse/dynamic
 *  tunnels. The destination is either a ~/.ssh/config alias or user@host. */

import type { ConnectionTarget, Tunnel } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { expandHome } from '../utils/strings.js';
import { shJoin } from '../utils/shell.js';
import { isValidTmuxSession } from '../utils/validators.js';
import { tr } from '../i18n/index.js';

const ROBUST_OPTS = [
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=30',
  '-o',
  'ServerAliveCountMax=3',
];

/** For PASSWORD auth: the plaintext password is handed to ssh via sshpass's
 *  SSHPASS env var, which ssh would otherwise pass on to any helper it spawns —
 *  a ProxyCommand, a ProxyJump's `ssh -W`, or a PermitLocalCommand script —
 *  leaking the secret into those children's environment. Disabling proxying and
 *  local commands keeps it from escaping sshpass→ssh. Exported as ONE source of
 *  truth so every password-auth spawn (connect, scp, ssh-copy-id) applies the
 *  exact same defense and the paths can't drift. */
export const PASSWORD_NO_PROXY_OPTS = [
  '-o',
  'ProxyCommand=none',
  '-o',
  'ProxyJump=none',
  '-o',
  'PermitLocalCommand=no',
];

/** Options shared by connect & tunnel (everything except the destination). */
export function targetOptions(t: ConnectionTarget): string[] {
  const args: string[] = [...ROBUST_OPTS];

  // For ad-hoc IPs/domains we relax host-key checking for friction-free use.
  // For named ~/.ssh/config hosts we keep the user's normal host-key policy.
  if (t.hostMode !== 'sshconfig') {
    // TOFU (accept-new) only for key/agent auth. For PASSWORD auth we must NOT
    // auto-accept an unknown host key — a first-connect MITM would otherwise
    // capture the password. ssh's default (ask) shows the fingerprint to confirm.
    if (t.auth !== 'password') args.push('-o', 'StrictHostKeyChecking=accept-new');
    if (t.sshPort && Number(t.sshPort) !== 22) args.push('-p', String(t.sshPort));
  }

  if (t.auth === 'key' && t.keyPath) {
    // -i alone only ADDS the key — the agent may still offer its own keys first
    // and trip "Too many authentication failures" on strict servers. IdentitiesOnly=yes
    // makes the choice deterministic: only configured / -i keys are tried, never the
    // agent's surplus (it still honours every IdentityFile from ~/.ssh/config).
    args.push('-i', expandHome(t.keyPath), '-o', 'IdentitiesOnly=yes');
  } else if (t.auth === 'password') {
    args.push('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no');
    // Stop SSHPASS leaking into a ProxyCommand/ProxyJump/LocalCommand child.
    // (Direct IP/manual hosts have no proxy anyway, so this is a no-op there; use
    // key/agent auth if you genuinely need a jump host.)
    args.push(...PASSWORD_NO_PROXY_OPTS);
  }
  return args;
}

export function destination(t: ConnectionTarget): string {
  if (t.hostMode === 'sshconfig') return t.sshHost;
  return `${t.user || 'root'}@${t.host}`;
}

/** Bracket an IPv6 literal so its colons can't shift the colon-delimited fields
 *  of a -L/-R forward spec (e.g. a host of "0.0.0.0:1" smuggling a bind addr). */
const fwdHost = (h: string): string => (h.includes(':') ? `[${h}]` : h);

/** Forward spec for a tunnel: -L (local), -R (remote/reverse), -D (dynamic). */
export function forwardFlags(t: Tunnel): string[] {
  if (t.type === 'dynamic') return ['-D', String(t.localPort)];
  if (t.type === 'remote') {
    // Reverse: expose THIS machine's service on the server.
    // ssh -R <serverPort>:<localTargetHost>:<localTargetPort>
    return ['-R', `${t.remotePort}:${fwdHost(t.remoteHost || 'localhost')}:${t.localPort}`];
  }
  // Local: bring a remote service to THIS machine.
  // ssh -L <localPort>:<remoteHost>:<remotePort>
  return ['-L', `${t.localPort}:${fwdHost(t.remoteHost || '127.0.0.1')}:${t.remotePort}`];
}

export interface ConnectOptions {
  /** attach/create a tmux session on the remote (true → "wssh", string → name) */
  tmux?: string | boolean;
  /** launch via mosh instead of ssh (interactive server shells only) */
  mosh?: boolean;
}

/** Build the `mosh` argv from a target. mosh wraps ssh for the handshake, so ssh
 *  options (port, identity, robustness) ride along via `--ssh`; the destination
 *  is the ~/.ssh/config alias or user@host. Password auth is unsupported. */
export function buildMoshArgs(t: ConnectionTarget): string[] {
  // mosh re-splits (and may shell-evaluate) the --ssh value, so quote each token
  // — an unquoted key path could word-split or inject ssh options (ProxyCommand).
  const sshCmd = shJoin(['ssh', ...targetOptions(t)]);
  const dest = destination(t);
  // mosh has no portable `--` end-of-options marker (unlike every ssh builder),
  // so guard the destination directly: a leading-dash alias — only reachable via
  // a hand-edited ~/.ssh/config — would otherwise be parsed by mosh as an option.
  if (dest.startsWith('-')) throw new WizardError(tr.ssh.argsBadMoshDest);
  return ['--ssh', sshCmd, dest];
}

// A literal `--` ends ssh option parsing, so a destination/alias that begins
// with `-` (e.g. an imported `-oProxyCommand=…`) is treated as the host operand,
// never as an ssh option. Placed right before the destination in every builder.
const END_OPTS = '--';

/** Interactive shell connect: `ssh [opts] -- dest`. With `tmux`, request a tty
 *  and run `tmux new-session -A -s <name>` so the session survives drops. */
export function buildConnectArgs(t: ConnectionTarget, opts: ConnectOptions = {}): string[] {
  if (opts.tmux) {
    const session = typeof opts.tmux === 'string' && opts.tmux.trim() ? opts.tmux.trim() : 'wssh';
    // The session name becomes a REMOTE command word (`tmux … -s <name>`), which
    // ssh hands to the remote login shell — reject shell metacharacters so it
    // can't smuggle a remote command (and so a name with spaces/`-` doesn't
    // silently break the session).
    if (!isValidTmuxSession(session)) throw new WizardError(tr.ssh.argsBadTmuxSession);
    return [
      ...targetOptions(t),
      '-t',
      END_OPTS,
      destination(t),
      'tmux',
      'new-session',
      '-A',
      '-s',
      session,
    ];
  }
  return [...targetOptions(t), END_OPTS, destination(t)];
}

/** Run a one-off remote command: `ssh [opts] -- dest <cmd...>`. The `--` guards
 *  both the destination and the command words from being parsed as ssh options. */
export function buildRunArgs(t: ConnectionTarget, command: string[]): string[] {
  return [...targetOptions(t), END_OPTS, destination(t), ...command];
}

/** Background tunnel: `ssh -N <forward> [opts] -- dest`. */
export function buildTunnelArgs(t: Tunnel): string[] {
  return [
    '-N',
    ...forwardFlags(t),
    '-o',
    'ExitOnForwardFailure=yes',
    ...targetOptions(t),
    END_OPTS,
    destination(t),
  ];
}
