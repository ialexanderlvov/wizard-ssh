export function isValidPort(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536;
}

export function isValidHostOrIp(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const domain =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (ipv4.test(s)) return s.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
  if (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s)) return true; // permissive IPv6
  return domain.test(s);
}

/** ~/.ssh/config Host alias: letters, digits, dot, dash, underscore. No globs/spaces. */
export const isValidSshAlias = (v: unknown): boolean =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.trim());

/** Human-friendly unique entity name. */
export const isValidName = (v: unknown): boolean =>
  typeof v === 'string' && /^[\w][\w .@:-]{0,63}$/.test(v.trim());
