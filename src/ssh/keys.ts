/** SSH key discovery, inspection, generation and deletion. Pure filesystem +
 *  `ssh-keygen` wrapper — no prompts (the picker/menus live in the UI/command
 *  layers) and no store coupling (reference lookup lives in commands/keys.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { capture, commandExists } from '../utils/exec.js';
import { tr } from '../i18n/index.js';
import { expandHome } from '../utils/strings.js';

function looksPrivate(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(80);
    const n = fs.readSync(fd, buf, 0, 80, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString('utf8').includes('PRIVATE KEY');
  } catch {
    return false;
  }
}

/** Private keys found in ~/.ssh (one level deep). */
export function findSshKeys(): string[] {
  const found: string[] = [];
  const scan = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) scan(full, depth - 1);
      } else if (e.isFile()) {
        if (/\.(pub|old|bak)$/.test(e.name)) continue;
        if (['known_hosts', 'config', 'authorized_keys'].includes(e.name)) continue;
        if (looksPrivate(full)) found.push(full);
      }
    }
  };
  scan(path.join(os.homedir(), '.ssh'), 1);
  return found;
}

/** `~/.ssh/id_ed25519` → `~/.ssh/id_ed25519.pub`. */
export function pubPathFor(privPath: string): string {
  return `${privPath}.pub`;
}

/** The public-key text (`ssh-ed25519 AAAA… comment`), or null if no `.pub`. */
export function publicKeyText(privPath: string): string | null {
  const pub = pubPathFor(expandHome(privPath));
  try {
    return fs.readFileSync(pub, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export interface KeyFingerprint {
  bits: number;
  hash: string;
  comment: string;
  type: string;
}

/** Parse `ssh-keygen -l -f <file>` for a key's fingerprint. Reads the `.pub`
 *  when present so a passphrase-protected key never triggers a prompt. */
export function keyFingerprint(privPath: string): KeyFingerprint | null {
  if (!commandExists('ssh-keygen')) return null;
  const abs = expandHome(privPath);
  const target = fs.existsSync(pubPathFor(abs)) ? pubPathFor(abs) : abs;
  const res = capture('ssh-keygen', ['-l', '-f', target]);
  if (res.status !== 0) return null;
  // e.g. "256 SHA256:nThbg6… user@host (ED25519)"
  const m = res.stdout.trim().match(/^(\d+)\s+(\S+)\s+(.*)\s+\(([^)]+)\)\s*$/);
  if (!m) return null;
  return {
    bits: Number(m[1]) || 0,
    hash: m[2] ?? '',
    comment: (m[3] ?? '').trim(),
    type: m[4] ?? '',
  };
}

export interface KeyInfo {
  /** absolute private-key path */
  path: string;
  /** absolute `.pub` path */
  pubPath: string;
  hasPub: boolean;
  /** key algorithm (ED25519, RSA, …) or '?' when unknown */
  type: string;
  bits: number;
  /** SHA256:… fingerprint, or '' when ssh-keygen is unavailable */
  fingerprint: string;
  comment: string;
}

/** Every private key under ~/.ssh, enriched with fingerprint metadata. */
export function listKeys(): KeyInfo[] {
  return findSshKeys().map((p) => {
    const fp = keyFingerprint(p);
    return {
      path: p,
      pubPath: pubPathFor(p),
      hasPub: fs.existsSync(pubPathFor(p)),
      type: fp?.type ?? '?',
      bits: fp?.bits ?? 0,
      fingerprint: fp?.hash ?? '',
      comment: fp?.comment ?? '',
    };
  });
}

/** Whether a private key is passphrase-protected. Uses `ssh-keygen -y -P ''`,
 *  which exits 0 on a plaintext key and non-zero on an encrypted one — without
 *  prompting. Returns null when undeterminable (no ssh-keygen, sk-key, or any
 *  other error) so callers don't over-report. */
export function isKeyEncrypted(privPath: string): boolean | null {
  if (!commandExists('ssh-keygen')) return null;
  const abs = expandHome(privPath);
  const res = capture('ssh-keygen', ['-y', '-P', '', '-f', abs]);
  if (res.status === 0) return false; // empty passphrase worked → not encrypted
  if (/passphrase|incorrect|decrypt/i.test(res.stderr)) return true;
  return null; // unparseable / unrelated error
}

/** Machine-readable weakness tags for a key. */
export type KeyIssue = 'weak-rsa' | 'unencrypted' | 'no-pub' | 'orphan';

export interface KeyAudit extends KeyInfo {
  encrypted: boolean | null;
  /** referenced by zero servers/tunnels (only set when some entity has keys) */
  orphan: boolean;
  issues: KeyIssue[];
}

/** Pure weakness classification (exposed for testing). */
export function keyIssues(
  info: Pick<KeyInfo, 'type' | 'bits' | 'hasPub'>,
  encrypted: boolean | null,
  orphan: boolean,
): KeyIssue[] {
  const issues: KeyIssue[] = [];
  if (/rsa/i.test(info.type) && info.bits > 0 && info.bits < 2048) issues.push('weak-rsa');
  if (encrypted === false) issues.push('unencrypted');
  if (!info.hasPub) issues.push('no-pub');
  if (orphan) issues.push('orphan');
  return issues;
}

/** Audit every ~/.ssh key for weakness/hygiene issues. `referenced` is the set
 *  of absolute key paths used by servers/tunnels; orphan flags are only emitted
 *  when it's non-empty (so a fresh install doesn't mark everything orphan). */
export function auditKeys(referenced: ReadonlySet<string> = new Set()): KeyAudit[] {
  const track = referenced.size > 0;
  return listKeys().map((k) => {
    const isSk = /sk/i.test(k.type);
    const encrypted = isSk ? null : isKeyEncrypted(k.path);
    const orphan = track && !referenced.has(path.resolve(expandHome(k.path)));
    return { ...k, encrypted, orphan, issues: keyIssues(k, encrypted, orphan) };
  });
}

export type KeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'ed25519-sk' | 'ecdsa-sk';

/** FIDO/U2F security-key backed types — require a hardware authenticator. */
export const SK_KEY_TYPES: readonly KeyType[] = ['ed25519-sk', 'ecdsa-sk'];

export const isSkKeyType = (type: KeyType): boolean => SK_KEY_TYPES.includes(type);

export interface GenerateKeyOptions {
  /** private-key path to create (its `.pub` is written alongside) */
  path: string;
  type?: KeyType;
  /** RSA only — key size in bits (default 4096) */
  bits?: number;
  comment?: string;
  /** when true, ssh-keygen prompts for a passphrase; else the key is passphraseless */
  withPassphrase?: boolean;
}

/** A sensible default key comment: `user@host-YYYY-MM-DD`. */
export function defaultKeyComment(): string {
  const user = (() => {
    try {
      return os.userInfo().username;
    } catch {
      return 'user';
    }
  })();
  return `${user}@${os.hostname()}-${new Date().toISOString().slice(0, 10)}`;
}

/** Build the ssh-keygen argument vector (exposed for testing). */
export function buildKeygenArgs(opts: GenerateKeyOptions): string[] {
  const type = opts.type ?? 'ed25519';
  const args = ['-t', type];
  if (type === 'rsa') args.push('-b', String(opts.bits ?? 4096));
  args.push('-f', expandHome(opts.path), '-C', opts.comment ?? defaultKeyComment());
  if (!opts.withPassphrase) args.push('-N', '');
  return args;
}

/** Generate a key pair via ssh-keygen (stdio inherited so it can prompt for a
 *  passphrase and print the randomart). Resolves with the exit code. */
export function generateKey(opts: GenerateKeyOptions): Promise<number> {
  if (!commandExists('ssh-keygen')) {
    return Promise.reject(new Error(tr.ssh.keysKeygenNotFound));
  }
  const args = buildKeygenArgs(opts);
  return new Promise((resolve) => {
    const child = spawn('ssh-keygen', args, { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 0));
  });
}

/** Delete a private key and its `.pub` sibling. Returns the paths removed.
 *  Containment: refuses to touch anything outside ~/.ssh, so a stray or
 *  hand-edited keyPath can never make this remove an unrelated file. */
export function deleteKey(privPath: string): { removed: string[] } {
  const abs = path.resolve(expandHome(privPath));
  const sshRoot = path.resolve(path.join(os.homedir(), '.ssh'));
  const inSsh = (p: string): boolean => p === sshRoot || p.startsWith(sshRoot + path.sep);
  const removed: string[] = [];
  if (!inSsh(abs)) return { removed }; // never delete outside ~/.ssh
  for (const f of [abs, pubPathFor(abs)]) {
    try {
      if (fs.existsSync(f)) {
        fs.rmSync(f);
        removed.push(f);
      }
    } catch {
      /* best effort */
    }
  }
  return { removed };
}
