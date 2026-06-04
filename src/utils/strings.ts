import os from 'node:os';
import path from 'node:path';

/** ~/foo → /Users/you/foo */
export function expandHome(p: string | null | undefined): string {
  if (!p) return p ?? '';
  if (p === '~') return os.homedir();
  return p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** /Users/you/foo → ~/foo (compact display) */
export function tilde(p: string | null | undefined): string {
  if (!p) return '';
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export function slugify(s: string): string {
  const out = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return out || 'item';
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;

/** Remove ANSI colour codes (for filtering / width math). */
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

// All C0/C1 control bytes, incl. ESC (0x1b) — the prefix of every terminal
// escape/OSC/CSI sequence. Built via the constructor so the source carries no
// literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');

/** Strip control/escape bytes from text that originated in an untrusted store
 *  (a ~/.ssh/config `#wssh` annotation or an imported bundle) before it is ever
 *  printed, so a crafted description/tag can't emit raw terminal escape
 *  sequences (cursor moves, OSC-8 hyperlink spoofing, title rewrites). */
export const stripControl = (s: string | null | undefined): string =>
  String(s ?? '').replace(CONTROL_RE, '');

/** Split a comma/space separated tag string into clean tags. */
export function parseTags(input: string): string[] {
  return String(input ?? '')
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}
