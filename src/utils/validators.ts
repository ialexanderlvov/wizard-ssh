import net from 'node:net';

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
  // Defer IP validation to the platform parser: it rejects out-of-range octets,
  // leading-zero (octal-ambiguous) octets like `010.0.0.1`, and structurally
  // invalid IPv6 (multiple `::`, dangling colon) that a hand-rolled regex let
  // through and that different libc inet_aton/getaddrinfo would parse divergently.
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (ipv4.test(s)) return net.isIP(s) === 4;
  if (s.includes(':')) return net.isIP(s) === 6;
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

/** A single ProxyJump hop: `[user@]host[:port]`, where host is a name/IP or a
 *  bracketed IPv6 literal. No leading dash (so it can't smuggle an ssh option),
 *  no whitespace/metacharacters. */
const PROXY_HOP =
  /^([A-Za-z0-9][A-Za-z0-9._-]*@)?([A-Za-z0-9][A-Za-z0-9._-]*|\[[0-9A-Fa-f:]+\])(:\d{1,5})?$/;

/** A ~/.ssh/config ProxyJump value: a comma-separated chain of hops (or `none`).
 *  Written verbatim as a `ProxyJump` directive, so an imported/edited value must
 *  be a real jump spec — never an option-injecting or whitespace-laden string
 *  (the writer's control-char gate already blocks CR/LF, this blocks the rest). */
export const isValidProxyJump = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 512 || hasUnsafeChars(s)) return false;
  if (s.toLowerCase() === 'none') return true;
  return s.split(',').every((hop) => {
    const h = hop.trim();
    if (!PROXY_HOP.test(h)) return false;
    // PROXY_HOP only shape-matches the optional `:port` as \d{1,5} (so it would
    // accept :0 and :65536-99999). Range-check a real trailing port — a bracketed
    // IPv6 ends with `]`, so `]?:` only fires on an actual port, not on the
    // address colons inside the brackets.
    const m = /]?:(\d{1,5})$/.exec(h);
    return !m || isValidPort(m[1]);
  });
};
