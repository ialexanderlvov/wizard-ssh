/** Reader for ~/.ssh/config: connectable Host aliases (+ metadata), following
 *  Include directives and skipping wildcard / negated patterns. Also exposes a
 *  block-range view of the MAIN file so the writer can splice safely. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SshConfigHost, WsshMeta } from '../core/types.js';
import { SSH_CONFIG_FILE } from '../core/paths.js';
import { stripControl } from '../utils/strings.js';
import { parseWsshComment } from './wssh.js';

export interface Block {
  aliases: string[];
  /** number of RAW patterns on the `Host` line BEFORE wildcard/negation filtering.
   *  A block is only safe to splice when it has exactly one pattern total — e.g.
   *  `Host * prod` collapses to the single alias "prod" but must NOT be rewritten
   *  (doing so would drop the `*` and clobber the user's global defaults). */
  patternCount: number;
  params: Array<{ key: string; value: string }>;
  source: string;
  /** line range in the source file [start, end) — only meaningful for main */
  start: number;
  end: number;
  /** parsed `#wssh {...}` comment directly above the Host line, if any */
  meta: WsshMeta | null;
  /** line where the block's leading content starts: the `#wssh` line if present,
   *  otherwise the `Host` line (used by the writer to splice atomically) */
  metaStart: number;
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

// Bound Include nesting (OpenSSH uses 16). The `seen` set already breaks cycles;
// this also caps a pathological deep-but-acyclic Include chain.
const MAX_INCLUDE_DEPTH = 16;

/** Parse a file into blocks. Follows Include unless `followIncludes` is false. */
function parseBlocks(
  file: string,
  followIncludes: boolean,
  seen = new Set<string>(),
  depth = 0,
): Block[] {
  if (depth > MAX_INCLUDE_DEPTH) return [];
  const real = path.resolve(file);
  if (seen.has(real)) return [];
  seen.add(real);

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return parseLines(text.split(/\r?\n/), file, followIncludes, seen, depth);
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
  depth = 0,
): Block[] {
  const blocks: Block[] = [];
  const baseDir = path.dirname(file);
  let current: Block | null = null;
  // A `#wssh {...}` comment seen between blocks is held until the next Host.
  let pendingMeta: WsshMeta | null = null;
  let pendingMetaStart = -1;

  const closeAt = (idx: number): void => {
    if (current) {
      current.end = idx;
      blocks.push(current);
      current = null;
    }
  };

  // The trimmed next non-blank line at/after `from` (for `#wssh` look-ahead).
  const nextNonBlank = (from: number): string => {
    for (let k = from; k < lines.length; k++) {
      const t = (lines[k] ?? '').trim();
      if (t) return t;
    }
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (!line) continue; // blank line: keep any pending #wssh (allow a gap)
    if (line.startsWith('#')) {
      const meta = parseWsshComment(line);
      // A `#wssh` annotation belongs to the Host block that FOLLOWS it — but only
      // when a `Host` line actually comes next. A stray/inline `#wssh` inside a
      // block (only possible via a hand-edited config; the writer never emits one
      // mid-block) is otherwise treated as a plain comment: it must NOT close the
      // current block, drop its later params, or mis-bind its auth/secretId to the
      // next host.
      if (meta && /^host[\s=]/i.test(nextNonBlank(i + 1))) {
        closeAt(i);
        pendingMeta = meta;
        pendingMetaStart = i;
      } else if (!meta && !current) {
        // A non-#wssh comment between blocks detaches any pending #wssh, matching
        // the writer (which only treats an immediately-adjacent #wssh as ours).
        pendingMeta = null;
        pendingMetaStart = -1;
      }
      continue;
    }
    const m = line.match(/^(\w+)[\s=]+(.+)$/);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();

    if (key === 'include' && followIncludes) {
      closeAt(i);
      pendingMeta = null;
      for (const token of splitTokens(value)) {
        for (const inc of expandGlob(token, baseDir)) {
          blocks.push(...parseBlocks(inc, followIncludes, seen, depth + 1));
        }
      }
      continue;
    }

    if (key === 'host' || key === 'match') {
      closeAt(i);
      if (key === 'host') {
        const tokens = splitTokens(value);
        // strip control/escape bytes: the alias is both a display string and a
        // map key, so sanitizing here keeps reader and writer (both via
        // parseLines) consistent while neutralizing terminal-escape spoofing from
        // an untrusted ~/.ssh/config.
        const aliases = tokens
          .filter((a) => !a.includes('*') && !a.includes('?') && !a.startsWith('!'))
          .map(stripControl)
          .filter(Boolean);
        current = {
          aliases,
          patternCount: tokens.length,
          params: [],
          source: file,
          start: i,
          end: lines.length,
          meta: pendingMeta,
          metaStart: pendingMeta ? pendingMetaStart : i,
        };
      }
      pendingMeta = null;
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
  // Manageable only when it is a single-PATTERN block (exactly one alias, no
  // extra wildcard/negation patterns) living in the MAIN config — those are the
  // ones the writer can safely splice in place without dropping sibling patterns.
  const manageable =
    block.aliases.length === 1 &&
    block.patternCount === 1 &&
    path.resolve(block.source) === path.resolve(SSH_CONFIG_FILE);
  // Strip control/escape bytes from the connection fields the renderers print
  // (alias is already sanitized in parseLines). An untrusted/Included config
  // could otherwise smuggle terminal escapes through HostName/User/ProxyJump/etc.
  return {
    alias,
    hostName: stripControl(param(block, 'HostName')),
    user: stripControl(param(block, 'User')),
    port: stripControl(param(block, 'Port')),
    identityFile: stripControl(param(block, 'IdentityFile')),
    proxyJump: stripControl(param(block, 'ProxyJump')),
    params: block.params.slice(),
    source: block.source,
    wssh: block.meta,
    manageable,
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
