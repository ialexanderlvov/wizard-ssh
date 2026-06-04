/** Serialize / parse the `#wssh {json}` annotation that carries app-only
 *  metadata directly above a Host block (description, tags, password auth and
 *  the vault secret id). Only non-default fields are written, so a plain server
 *  with no extras adds no comment at all. */

import type { WsshMeta } from '../core/types.js';
import { stripControl } from '../utils/strings.js';

/** True when there is nothing worth persisting in a `#wssh` comment. */
export function isEmptyMeta(meta: WsshMeta | null | undefined): boolean {
  if (!meta) return true;
  return (
    !meta.desc &&
    !(meta.tags && meta.tags.length) &&
    meta.auth !== 'password' &&
    !meta.secretId &&
    !meta.createdAt &&
    !meta.updatedAt
  );
}

/** Parse a single line into WsshMeta, or null if it is not a `#wssh` comment. */
export function parseWsshComment(line: string): WsshMeta | null {
  const t = line.trim();
  if (!t.startsWith('#wssh')) return null;
  const rest = t.slice('#wssh'.length);
  if (rest && !/^\s/.test(rest)) return null; // "#wsshX" is not ours
  const json = rest.trim();
  if (!json.startsWith('{')) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const meta: WsshMeta = {};
  // desc/tags are free text that lands on the terminal via the renderers — strip
  // control/escape bytes here (the single read path from config) so a hand-edited
  // or imported annotation can't smuggle terminal escape sequences into output.
  if (typeof raw.desc === 'string' && raw.desc) meta.desc = stripControl(raw.desc);
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map(stripControl)
      .filter(Boolean);
    if (tags.length) meta.tags = tags;
  }
  if (raw.auth === 'password') meta.auth = 'password';
  if (typeof raw.secretId === 'string' && raw.secretId) meta.secretId = raw.secretId;
  if (typeof raw.createdAt === 'string' && raw.createdAt) meta.createdAt = raw.createdAt;
  if (typeof raw.updatedAt === 'string' && raw.updatedAt) meta.updatedAt = raw.updatedAt;
  return meta;
}

/** Serialize to a single `#wssh {json}` line, or null when there's nothing to store. */
export function serializeWssh(meta: WsshMeta | null | undefined): string | null {
  if (isEmptyMeta(meta)) return null;
  const m = meta as WsshMeta;
  const out: Record<string, unknown> = {};
  if (m.desc) out.desc = m.desc;
  if (m.tags && m.tags.length) out.tags = m.tags;
  if (m.auth === 'password') out.auth = 'password';
  if (m.secretId) out.secretId = m.secretId;
  if (m.createdAt) out.createdAt = m.createdAt;
  if (m.updatedAt) out.updatedAt = m.updatedAt;
  return `#wssh ${JSON.stringify(out)}`;
}
