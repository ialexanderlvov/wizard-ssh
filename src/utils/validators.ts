/** Control characters (incl. CR/LF) that must never reach a child-process argv
 *  or a ~/.ssh/config line: a newline would inject an arbitrary config directive
 *  (e.g. ProxyCommand) and other control chars are never valid in a host/user/
 *  path. This is the shared gate every input validator builds on. Built via the
 *  RegExp constructor so the source carries no literal control bytes. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');
export const hasUnsafeChars = (v: string): boolean => CONTROL_RE.test(v);

export function isValidPort(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v < 65536;
  if (typeof v !== 'string') return false;
  // Decimal digits only — reject 0x10 / 1e3 / 0b101 / 0o17 / '22.5', which
  // Number() would otherwise silently coerce to a different effective port.
  const s = v.trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 && n < 65536;
}

export function isValidHostOrIp(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 253 || hasUnsafeChars(s) || /\s/.test(s)) return false;
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (ipv4.test(s))
    return s.split('.').every((o) => o.length <= 3 && Number(o) >= 0 && Number(o) <= 255);
  // IPv6 (bare): hex groups separated by colons, allowing one "::" run.
  if (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s))
    return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(s) && !/:::/.test(s);
  const domain =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domain.test(s);
}

/** A safe forward-target host for a tunnel's -L/-R spec: a host/IP with no
 *  whitespace, control chars or stray colons that could shift the spec fields. */
export const isValidForwardHost = (v: unknown): boolean =>
  typeof v === 'string' && isValidHostOrIp(v.trim());

/** ~/.ssh/config Host alias: letters, digits, dot, dash, underscore. No globs/spaces. */
export const isValidSshAlias = (v: unknown): boolean =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.trim());

/** A safe SSH username token: no whitespace, control chars, or '@' (which would
 *  break user@host parsing). Conservative but covers typical unix / AD names. */
export const isValidUser = (v: unknown): boolean =>
  typeof v === 'string' && /^[A-Za-z0-9._\\-]{1,64}$/.test(v.trim());

/** A key path that is safe to write into ~/.ssh/config (IdentityFile) — any real
 *  filesystem path, as long as it carries no directive-injecting control chars. */
export const isSafeKeyPath = (v: unknown): boolean =>
  typeof v === 'string' && v.length > 0 && !hasUnsafeChars(v);

/** Human-friendly unique entity name. */
export const isValidName = (v: unknown): boolean =>
  typeof v === 'string' && /^[\w][\w .@:-]{0,63}$/.test(v.trim());

/** A tmux session name safe to hand to the REMOTE shell as a command word
 *  (`tmux new-session -A -s <name>`): letters, digits, dot, dash, underscore.
 *  No shell metacharacters (`;`, `$()`, backticks, spaces) — ssh joins remote
 *  command words and the remote login shell would otherwise interpret them. */
export const isValidTmuxSession = (v: unknown): boolean =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.trim());
