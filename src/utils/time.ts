import { tr } from '../i18n/index.js';

export const nowIso = (): string => new Date().toISOString();

// Accept only an ISO-8601-shaped date (what nowIso()/toISOString() produce):
// `YYYY-MM-DD` optionally followed by a time. Date.parse alone also swallows
// locale formats like `12/31/2020`, which then sort/display inconsistently.
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d|$)/;

/** Keep only parseable, ISO-shaped strings; otherwise fall back. */
export function safeIso<T extends string | null>(v: unknown, fallback: T): string | T {
  if (typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v))) return v;
  return fallback;
}

/** Milliseconds since epoch, or 0 for missing/invalid — keeps sorts total. */
export const ts = (v: string | null | undefined): number => (v ? Date.parse(v) || 0 : 0);

/** "just now", "5m ago", "3d ago", "2026-01-04". */
export function relativeTime(iso: string | null | undefined): string {
  const time = tr.common.time;
  if (!iso) return time.never;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return time.never;
  const diff = Date.now() - then;
  if (diff < 0) return time.justNow;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return time.justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return time.minutesAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return time.hoursAgo(hr);
  const day = Math.floor(hr / 24);
  if (day < 7) return time.daysAgo(day);
  if (day < 30) return time.weeksAgo(Math.floor(day / 7));
  if (day < 365) return time.monthsAgo(Math.floor(day / 30));
  return new Date(then).toISOString().slice(0, 10);
}

/** Friendly absolute timestamp for detail views: 2026-06-03 17:42 */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return tr.common.dash;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return tr.common.dash;
  const d = new Date(t);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
