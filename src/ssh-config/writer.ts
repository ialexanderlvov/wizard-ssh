/** Safe CRUD into the real ~/.ssh/config. Every write is preceded by a
 *  timestamped backup under ~/.wizard-ssh/backups. Only single-alias Host
 *  blocks are auto-managed; multi-alias / Match blocks are left untouched. */

import fs from 'node:fs';
import path from 'node:path';
import { SSH_CONFIG_FILE, SSH_DIR, FILES, ensureDir } from '../core/paths.js';
import { WizardError } from '../core/errors.js';
import { hasUnsafeChars } from '../utils/validators.js';
import { atomicWrite } from '../utils/atomic.js';
import type { SshConfigEntry } from './types.js';
import { blocksFromLines, getHost } from './parser.js';
import { parseWsshComment, serializeWssh } from './wssh.js';
import { tr } from '../i18n/index.js';

/** Last-resort defense against ssh_config directive injection: a CR/LF (or any
 *  control char) in an alias/key/value would be written as extra physical lines,
 *  smuggling arbitrary directives (ProxyCommand → RCE) into ~/.ssh/config. Every
 *  write funnels through formatBlock, so guarding here closes ALL callers
 *  (create/update/replaceAll/import/migrate), even ones that skipped validation. */
function assertConfigSafe(label: string, value: string): void {
  if (hasUnsafeChars(value)) throw new WizardError(tr.vault.writerUnsafeChar(label));
}

export function backupConfig(): string | null {
  if (!fs.existsSync(SSH_CONFIG_FILE)) return null;
  ensureDir(FILES.backupsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(FILES.backupsDir, `ssh-config.${stamp}.bak`);
  fs.copyFileSync(SSH_CONFIG_FILE, dest);
  return dest;
}

/** Remove permission bits looser than `max` (tighten-only — never grants access
 *  nor clobbers a stricter mode the user chose). */
function tightenPerms(target: string, max: number): void {
  try {
    const mode = fs.statSync(target).mode & 0o777;
    if (mode & ~max) fs.chmodSync(target, mode & max);
  } catch {
    /* best-effort */
  }
}

function ensureConfigFile(): void {
  ensureDir(SSH_DIR);
  tightenPerms(SSH_DIR, 0o700);
  if (!fs.existsSync(SSH_CONFIG_FILE)) {
    fs.writeFileSync(SSH_CONFIG_FILE, '', { mode: 0o600 });
  } else {
    tightenPerms(SSH_CONFIG_FILE, 0o600);
  }
}

// Split on /\r?\n/ so a CRLF config doesn't leave stray \r in the array and
// produce mixed line endings once we splice in our (LF-only) block lines.
function readLines(): string[] {
  try {
    return fs.readFileSync(SSH_CONFIG_FILE, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Atomic write (tmp + fsync + rename) so a concurrent run or a crash mid-write
 *  can't tear the file (last-writer-wins is still possible, but never a
 *  half-written ~/.ssh/config). Resolves through a symlink so a symlinked config
 *  (dotfiles repo) is updated in place, not replaced by a regular file. The tmp
 *  is created with an unpredictable name and an exclusive, no-follow open so a
 *  pre-planted symlink (e.g. if the resolved dir is group/world-writable) can't
 *  redirect the write. */
function writeLines(lines: string[]): void {
  let text = lines.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  text = text.replace(/\n{3,}/g, '\n\n');

  let target = SSH_CONFIG_FILE;
  try {
    target = fs.realpathSync(SSH_CONFIG_FILE);
  } catch {
    /* file may not exist yet — write at the canonical path */
  }
  atomicWrite(target, text);
}

export function formatBlock(entry: SshConfigEntry): string[] {
  const out: string[] = [];
  assertConfigSafe(tr.vault.writerAliasLabel, entry.alias);
  const meta = serializeWssh(entry.wssh);
  if (meta) out.push(meta); // `#wssh {...}` directly above the Host
  out.push(`Host ${entry.alias}`);
  for (const { key, value } of entry.params) {
    assertConfigSafe(tr.vault.writerParamLabel(key.trim()), key);
    assertConfigSafe(tr.vault.writerValueLabel(key.trim()), value);
    if (key.trim() && value.trim()) out.push(`    ${key.trim()} ${value.trim()}`);
  }
  return out;
}

/** Find a single-alias managed block within the SAME line array we will edit
 *  (no re-read), so indices and the spliced array can never drift. `metaStart`
 *  also swallows a contiguous `#wssh` comment directly above the Host (skipping
 *  only blank lines) so upsert/remove replace OUR annotation in place, while
 *  never touching a hand-written user comment. */
function findManaged(
  lines: string[],
  alias: string,
): { start: number; contentEnd: number; metaStart: number } | null {
  for (const block of blocksFromLines(lines, SSH_CONFIG_FILE)) {
    // Single-PATTERN only: `block.aliases` filters out wildcards/negations, so a
    // `Host * prod` block would otherwise look like it manages "prod" and a
    // rewrite/remove would silently drop the `*`. patternCount guards that.
    if (block.patternCount === 1 && block.aliases.length === 1 && block.aliases[0] === alias) {
      // Trim trailing blank/comment lines so we preserve the gap before the next block.
      let contentEnd = block.end;
      while (contentEnd > block.start + 1) {
        const l = (lines[contentEnd - 1] ?? '').trim();
        if (l && !l.startsWith('#')) break;
        contentEnd--;
      }
      // Walk up over blank lines; if a `#wssh` comment sits above, absorb it.
      let metaStart = block.start;
      let j = block.start - 1;
      while (j >= 0 && (lines[j] ?? '').trim() === '') j--;
      if (j >= 0 && parseWsshComment(lines[j] ?? '')) metaStart = j;
      return { start: block.start, contentEnd, metaStart };
    }
  }
  return null;
}

/** Create or update a Host block. Returns the backup path (if a backup was made). */
export function upsertHost(entry: SshConfigEntry): { backup: string | null; created: boolean } {
  if (!entry.alias.trim()) throw new WizardError(tr.vault.writerAliasEmpty);
  ensureConfigFile();
  const lines = readLines();
  const existing = findManaged(lines, entry.alias);

  // No managed block in the MAIN file, but the alias resolves through an Include
  // (i.e. it is defined in a DIFFERENT file). Appending a fresh block to the main
  // file would create a cross-file split-brain duplicate that ssh silently
  // shadows. Refuse, mirroring the interactive update path which declines
  // unmanageable hosts. (A non-manageable block in the MAIN file — e.g.
  // `Host * prod` — is intentionally left to the append path below, which adds a
  // sibling managed block without clobbering the wildcard defaults.) Checked
  // before the backup so a refusal leaves no spurious backup.
  if (!existing) {
    const resolved = getHost(entry.alias);
    if (resolved && path.resolve(resolved.source) !== path.resolve(SSH_CONFIG_FILE))
      throw new WizardError(tr.vault.writerAliasInInclude(entry.alias));
  }

  const backup = backupConfig();
  const block = formatBlock(entry);

  if (existing) {
    lines.splice(existing.metaStart, existing.contentEnd - existing.metaStart, ...block);
    writeLines(lines);
    return { backup, created: false };
  }

  // Append a fresh block.
  const trimmed = [...lines];
  while (trimmed.length && (trimmed[trimmed.length - 1] ?? '').trim() === '') trimmed.pop();
  if (trimmed.length) trimmed.push('');
  trimmed.push(...block);
  writeLines(trimmed);
  return { backup, created: true };
}

/** Remove a managed single-alias Host block. Returns false if not found/managed. */
export function removeHost(alias: string): { removed: boolean; backup: string | null } {
  if (!fs.existsSync(SSH_CONFIG_FILE)) return { removed: false, backup: null };
  const lines = readLines();
  const existing = findManaged(lines, alias);
  if (!existing) return { removed: false, backup: null };
  const backup = backupConfig();
  let deleteEnd = existing.contentEnd;
  // swallow one trailing blank line to avoid leaving a gap
  if ((lines[deleteEnd] ?? '').trim() === '') deleteEnd++;
  // metaStart also removes our leading `#wssh` annotation, if any.
  lines.splice(existing.metaStart, deleteEnd - existing.metaStart);
  writeLines(lines);
  return { removed: true, backup };
}

/** True only when the alias is a single-alias block we can safely manage. */
export function isManageable(alias: string): boolean {
  return findManaged(readLines(), alias) !== null;
}
