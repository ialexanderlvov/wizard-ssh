export const nowIso = (): string => new Date().toISOString();

/** Keep only parseable ISO strings; otherwise fall back. */
export function safeIso<T extends string | null>(v: unknown, fallback: T): string | T {
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v;
  return fallback;
}

/** Milliseconds since epoch, or 0 for missing/invalid — keeps sorts total. */
export const ts = (v: string | null | undefined): number => (v ? Date.parse(v) || 0 : 0);

/** "just now", "5m ago", "3d ago", "2026-01-04". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'никогда';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'никогда';
  const diff = Date.now() - then;
  if (diff < 0) return 'только что';
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн назад`;
  if (day < 30) return `${Math.floor(day / 7)} нед назад`;
  if (day < 365) return `${Math.floor(day / 30)} мес назад`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Friendly absolute timestamp for detail views: 2026-06-03 17:42 */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
