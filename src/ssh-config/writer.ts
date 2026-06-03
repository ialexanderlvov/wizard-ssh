/** Safe CRUD into the real ~/.ssh/config. Every write is preceded by a
 *  timestamped backup under ~/.wizard-ssh/backups. Only single-alias Host
 *  blocks are auto-managed; multi-alias / Match blocks are left untouched. */

import fs from 'node:fs';
import path from 'node:path';
import { SSH_CONFIG_FILE, SSH_DIR, FILES, ensureDir } from '../core/paths.js';
import { WizardError } from '../core/errors.js';
import type { SshConfigEntry } from './types.js';
import { blocksFromLines } from './parser.js';
import { parseWsshComment, serializeWssh } from './wssh.js';

export function backupConfig(): string | null {
  if (!fs.existsSync(SSH_CONFIG_FILE)) return null;
  ensureDir(FILES.backupsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(FILES.backupsDir, `ssh-config.${stamp}.bak`);
  fs.copyFileSync(SSH_CONFIG_FILE, dest);
  return dest;
}

function ensureConfigFile(): void {
  ensureDir(SSH_DIR);
  fs.chmodSync(SSH_DIR, 0o700);
  if (!fs.existsSync(SSH_CONFIG_FILE)) {
    fs.writeFileSync(SSH_CONFIG_FILE, '', { mode: 0o600 });
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

function writeLines(lines: string[]): void {
  let text = lines.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  fs.writeFileSync(SSH_CONFIG_FILE, text.replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
}

export function formatBlock(entry: SshConfigEntry): string[] {
  const out: string[] = [];
  const meta = serializeWssh(entry.wssh);
  if (meta) out.push(meta); // `#wssh {...}` directly above the Host
  out.push(`Host ${entry.alias}`);
  for (const { key, value } of entry.params) {
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
    if (block.aliases.length === 1 && block.aliases[0] === alias) {
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
  if (!entry.alias.trim()) throw new WizardError('Алиас не может быть пустым.');
  ensureConfigFile();
  const backup = backupConfig();
  const lines = readLines();
  const block = formatBlock(entry);
  const existing = findManaged(lines, entry.alias);

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
