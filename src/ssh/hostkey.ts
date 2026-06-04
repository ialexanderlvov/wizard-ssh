/** known_hosts helpers — list saved entries and forget a host's key via
 *  `ssh-keygen -R <host>` (after a legitimate rebuild / "REMOTE HOST
 *  IDENTIFICATION HAS CHANGED" warning). */

import fs from 'node:fs';
import path from 'node:path';
import { SSH_DIR } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';

export const KNOWN_HOSTS_FILE = path.join(SSH_DIR, 'known_hosts');

export interface KnownHost {
  /** host token as stored, e.g. "1.2.3.4" or "[example.com]:2222" */
  host: string;
  /** key algorithms recorded for this host (ssh-ed25519, ecdsa-sha2-…, …) */
  keyTypes: string[];
}

/** Parse ~/.ssh/known_hosts into a deduped, sorted host list. Hashed entries
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
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
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
    }
  }
  return [...byHost.entries()]
    .map(([host, types]) => ({ host, keyTypes: [...types].sort() }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** Remove every key for `host` from known_hosts (`ssh-keygen -R <host> -f file`).
 *  The file is passed explicitly so it edits exactly the known_hosts we list
 *  (ssh-keygen otherwise resolves ~ via the passwd db, not $HOME). */
export function forgetHostKey(host: string): { ok: boolean; message: string } {
  if (!commandExists('ssh-keygen')) return { ok: false, message: 'ssh-keygen не найден в PATH.' };
  const target = host.trim();
  if (!target) return { ok: false, message: 'Пустой хост.' };
  if (!fs.existsSync(KNOWN_HOSTS_FILE))
    return { ok: false, message: 'Файл ~/.ssh/known_hosts не найден — удалять нечего.' };
  const res = capture('ssh-keygen', ['-R', target, '-f', KNOWN_HOSTS_FILE]);
  if (res.status === 0) return { ok: true, message: `Ключи для ${target} удалены из known_hosts.` };
  return {
    ok: false,
    message: (res.stderr || res.stdout || 'ssh-keygen завершился с ошибкой.').trim(),
  };
}
