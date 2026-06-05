/** known_hosts helpers — list saved entries and forget a host's key via
 *  `ssh-keygen -R <host>` (after a legitimate rebuild / "REMOTE HOST
 *  IDENTIFICATION HAS CHANGED" warning). */

import fs from 'node:fs';
import path from 'node:path';
import { SSH_DIR } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { tr } from '../i18n/index.js';

export const KNOWN_HOSTS_FILE = path.join(SSH_DIR, 'known_hosts');

export interface KnownHost {
  /** host token as stored, e.g. "1.2.3.4" or "[example.com]:2222" */
  host: string;
  /** key algorithms recorded for this host (ssh-ed25519, ecdsa-sha2-…, …) */
  keyTypes: string[];
}

/** Parse ~/.ssh/known_hosts into a deduped host list, newest first — entries
 *  lower in the file (added later) come out on top. Hashed entries
 *  (HashKnownHosts, "|1|…") can't be shown in plaintext and are skipped — but
 *  `ssh-keygen -R` still removes them when you pass the exact host/IP. */
export function listKnownHosts(): KnownHost[] {
  let text: string;
  try {
    text = fs.readFileSync(KNOWN_HOSTS_FILE, 'utf8');
  } catch {
    return [];
  }
  const byHost = new Map<string, Set<string>>();
  const lastLine = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = (lines[idx] ?? '').trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    // Optional leading marker: @cert-authority / @revoked
    let i = 0;
    if (tokens[i]?.startsWith('@')) i++;
    const hostField = tokens[i];
    const keyType = tokens[i + 1] ?? '';
    if (!hostField || hostField.startsWith('|')) continue; // hashed → unreadable
    for (const h of hostField.split(',')) {
      if (!h) continue;
      const set = byHost.get(h) ?? new Set<string>();
      if (keyType) set.add(keyType);
      byHost.set(h, set);
      lastLine.set(h, idx); // track the latest line a host appears on
    }
  }
  // Sort by latest line descending → the most recently added entries first.
  return [...byHost.entries()]
    .map(([host, types]) => ({ host, keyTypes: [...types].sort() }))
    .sort((a, b) => (lastLine.get(b.host) ?? 0) - (lastLine.get(a.host) ?? 0));
}

/** True when ssh's stderr indicates a host-key verification failure / change —
 *  i.e. the server's key no longer matches the one saved in known_hosts. */
export function isHostKeyError(stderr: string): boolean {
  if (!stderr) return false;
  return /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|POSSIBLE DNS SPOOFING/i.test(
    stderr,
  );
}

/** The known_hosts host token for a host:port. Non-default ports are stored in
 *  the bracketed `[host]:port` form; port 22 is stored as the bare host. */
export function knownHostsToken(host: string, port: number): string {
  return port && port !== 22 ? `[${host}]:${port}` : host;
}

/** Remove every key for `host` from known_hosts (`ssh-keygen -R <host> -f file`).
 *  The file is passed explicitly so it edits exactly the known_hosts we list
 *  (ssh-keygen otherwise resolves ~ via the passwd db, not $HOME). */
export function forgetHostKey(host: string): { ok: boolean; removed?: boolean; message: string } {
  if (!commandExists('ssh-keygen')) return { ok: false, message: tr.ssh.hostkeyNoKeygen };
  const target = host.trim();
  if (!target) return { ok: false, message: tr.ssh.hostkeyEmptyHost };
  if (!fs.existsSync(KNOWN_HOSTS_FILE)) return { ok: false, message: tr.ssh.hostkeyFileNotFound };
  // ssh-keygen -R exits 0 even when NOTHING matched — an absent host, a custom-port
  // host stored as `[h]:port` but probed by bare name, or a hashed / @cert-authority
  // / @revoked entry it cannot remove. Diff the file around the call so we can
  // report a genuine no-op distinctly instead of a misleading "removed" (which
  // makes a user think they reset trust when the stale key is still pinned).
  let before = '';
  try {
    before = fs.readFileSync(KNOWN_HOSTS_FILE, 'utf8');
  } catch {
    /* treat unreadable as empty */
  }
  // `-R <host>` binds the NEXT argv element as its operand unconditionally, so a
  // leading-dash host (only reachable via a hand-edited record) is consumed as the
  // hostname, never parsed as a flag — no option-injection. (A trailing `--`
  // doesn't apply here since the host is -R's operand, not a positional.)
  const res = capture('ssh-keygen', ['-R', target, '-f', KNOWN_HOSTS_FILE]);
  if (res.status === 0) {
    let after = before;
    try {
      after = fs.readFileSync(KNOWN_HOSTS_FILE, 'utf8');
    } catch {
      /* keep `before` → counts as no change */
    }
    if (after === before)
      return { ok: true, removed: false, message: tr.ssh.hostkeyNothingRemoved(target) };
    return { ok: true, removed: true, message: tr.ssh.hostkeyRemoved(target) };
  }
  return {
    ok: false,
    message: (res.stderr || res.stdout || tr.ssh.hostkeyKeygenFailed).trim(),
  };
}
