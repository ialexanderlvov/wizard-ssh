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

/** Split a comma/space separated tag string into clean tags. */
export function parseTags(input: string): string[] {
  return String(input ?? '')
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}
