/** ssh-agent integration: probe the running agent, list loaded identities,
 *  add/remove keys. Pure `ssh-add` wrapper — prompts/menus live in commands. */

import { spawn } from 'node:child_process';
import { capture, commandExists } from '../utils/exec.js';
import { expandHome } from '../utils/strings.js';

export interface AgentIdentity {
  bits: number;
  /** SHA256:… fingerprint */
  fingerprint: string;
  comment: string;
  type: string;
}

/** 'running' — agent reachable with ≥1 identity; 'empty' — reachable, none;
 *  'unavailable' — no ssh-add binary or no reachable agent (SSH_AUTH_SOCK). */
export type AgentStatus = 'running' | 'empty' | 'unavailable';

export interface AgentProbe {
  status: AgentStatus;
  identities: AgentIdentity[];
}

/** Parse `ssh-add -l` lines, e.g. "256 SHA256:nThbg6… user@host (ED25519)". */
export function parseAgentList(stdout: string): AgentIdentity[] {
  const out: AgentIdentity[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)\s+\(([^)]+)\)\s*$/);
    if (m)
      out.push({
        bits: Number(m[1]) || 0,
        fingerprint: m[2] ?? '',
        comment: (m[3] ?? '').trim(),
        type: m[4] ?? '',
      });
  }
  return out;
}

/** Whether ssh-add exists, probed once per process — the binary can't appear
 *  or vanish mid-run, and probeAgent sits on the interactive agent-menu redraw
 *  path where an extra `which` spawn per pass is pure waste (same caching
 *  pattern as rsyncSupportsInfoProgress). */
let sshAddOnPath: boolean | undefined;
function hasSshAdd(): boolean {
  sshAddOnPath ??= commandExists('ssh-add');
  return sshAddOnPath;
}

/** `ssh-add -l` exit codes: 0 → identities listed; 1 → agent up but empty;
 *  2 → could not contact the agent. */
export function probeAgent(): AgentProbe {
  if (!hasSshAdd()) return { status: 'unavailable', identities: [] };
  const res = capture('ssh-add', ['-l']);
  if (res.status === 0) return { status: 'running', identities: parseAgentList(res.stdout) };
  if (res.status === 1) return { status: 'empty', identities: [] };
  return { status: 'unavailable', identities: [] };
}

/** Add a key to the agent (stdio inherited — ssh-add may prompt for the key's
 *  passphrase). On macOS `useKeychain` also stores that passphrase in the user
 *  Keychain (`--apple-use-keychain`), so future adds are silent. */
export function agentAddKey(
  privPath: string,
  opts: { useKeychain?: boolean } = {},
): Promise<number> {
  const args: string[] = [];
  if (opts.useKeychain) args.push('--apple-use-keychain');
  args.push('--', expandHome(privPath)); // `--` so a dash-leading path stays an operand
  return new Promise((resolve) => {
    const child = spawn('ssh-add', args, { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    // code=null → killed by a signal (aborted passphrase prompt): a failure,
    // same convention as agentRemoveKey below.
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Remove one key (by private-key path) or every identity (path = null). */
export function agentRemoveKey(privPath: string | null): number {
  const args = privPath ? ['-d', '--', expandHome(privPath)] : ['-D'];
  return capture('ssh-add', args).status ?? 1;
}
