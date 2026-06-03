/** Reader for ~/.ssh/config: connectable Host aliases (+ metadata), following
 *  Include directives and skipping wildcard / negated patterns. Also exposes a
 *  block-range view of the MAIN file so the writer can splice safely. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SshConfigHost } from '../core/types.js';
import { SSH_CONFIG_FILE } from '../core/paths.js';

export interface Block {
  aliases: string[];
  params: Array<{ key: string; value: string }>;
  source: string;
  /** line range in the source file [start, end) — only meaningful for main */
  start: number;
  end: number;
}

/** Split a directive value honouring "double quoted paths with spaces". */
export function splitTokens(value: string): string[] {
  const out: string[] = [];
  const rx = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(value)) !== null) out.push(m[1] != null ? m[1] : (m[2] ?? ''));
  return out.filter(Boolean);
}

function expandGlob(pattern: string, baseDir: string): string[] {
  let p = pattern;
  if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
  else if (!path.isAbsolute(p)) p = path.join(baseDir, p);

  if (!/[*?]/.test(p)) return fs.existsSync(p) ? [p] : [];

  const dir = path.dirname(p);
  const base = path.basename(p);
  const rx = new RegExp(
    '^' +
      base
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
  );
  try {
    return fs
      .readdirSync(dir)
      .filter((e) => rx.test(e))
      .map((e) => path.join(dir, e))
      .filter((f) => {
        try {
          return fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Parse a file into blocks. Follows Include unless `followIncludes` is false. */
function parseBlocks(file: string, followIncludes: boolean, seen = new Set<string>()): Block[] {
  const real = path.resolve(file);
  if (seen.has(real)) return [];
  seen.add(real);

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return parseLines(text.split(/\r?\n/), file, followIncludes, seen);
}

/** Parse an already-read, \n-split line array into blocks. The writer reads the
 *  file ONCE and reuses the same array for splicing — so block indices and the
 *  edited array can never drift (avoids a read-twice race). */
export function blocksFromLines(lines: string[], file: string): Block[] {
  return parseLines(lines, file, false, new Set<string>());
}

function parseLines(
  lines: string[],
  file: string,
  followIncludes: boolean,
  seen: Set<string>,
): Block[] {
  const blocks: Block[] = [];
  const baseDir = path.dirname(file);
  let current: Block | null = null;

  const closeAt = (idx: number): void => {
    if (current) {
      current.end = idx;
      blocks.push(current);
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\w+)[\s=]+(.+)$/);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();

    if (key === 'include' && followIncludes) {
      closeAt(i);
      for (const token of splitTokens(value)) {
        for (const inc of expandGlob(token, baseDir)) {
          blocks.push(...parseBlocks(inc, followIncludes, seen));
        }
      }
      continue;
    }

    if (key === 'host' || key === 'match') {
      closeAt(i);
      if (key === 'host') {
        const aliases = splitTokens(value).filter(
          (a) => !a.includes('*') && !a.includes('?') && !a.startsWith('!'),
        );
        current = { aliases, params: [], source: file, start: i, end: lines.length };
      }
      continue;
    }

    if (current) current.params.push({ key: m[1] ?? '', value });
  }
  closeAt(lines.length);
  return blocks;
}

function param(block: Block, name: string): string {
  const found = block.params.find((p) => p.key.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

function blockToHost(block: Block, alias: string): SshConfigHost {
  return {
    alias,
    hostName: param(block, 'HostName'),
    user: param(block, 'User'),
    port: param(block, 'Port'),
    identityFile: param(block, 'IdentityFile'),
    proxyJump: param(block, 'ProxyJump'),
    params: block.params.slice(),
    source: block.source,
  };
}

/** Deduplicated, sorted alias list (first definition wins for metadata). */
export function listHosts(): SshConfigHost[] {
  if (!fs.existsSync(SSH_CONFIG_FILE)) return [];
  const byAlias = new Map<string, SshConfigHost>();
  for (const block of parseBlocks(SSH_CONFIG_FILE, true)) {
    for (const alias of block.aliases) {
      if (!byAlias.has(alias)) byAlias.set(alias, blockToHost(block, alias));
    }
  }
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}

export function getHost(alias: string): SshConfigHost | null {
  return listHosts().find((h) => h.alias === alias) ?? null;
}

export const hasConfig = (): boolean => fs.existsSync(SSH_CONFIG_FILE);

/** Blocks of the MAIN config only, with line ranges, for the writer. */
export function mainBlocks(): Block[] {
  if (!fs.existsSync(SSH_CONFIG_FILE)) return [];
  return parseBlocks(SSH_CONFIG_FILE, false);
}
