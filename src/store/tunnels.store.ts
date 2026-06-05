import type { Tunnel } from '../core/types.js';
import { FILES } from '../core/paths.js';
import { EntityCollection } from './collection.js';
import {
  asRaw,
  bool,
  normalizeBase,
  normalizeConnection,
  num,
  numOrNull,
  oneOf,
  token,
  FORWARDS,
} from './normalize.js';

function normalizeTunnel(raw: unknown): Tunnel {
  const r = asRaw(raw);
  // Drop a control-char-laden OR whitespace-bearing remoteHost (hand-edited /
  // imported) before it ever reaches the -L/-R forward spec; fall back to
  // loopback. `token` strips C0/C1 and blanks anything containing whitespace,
  // which is exactly what could shift the colon-delimited forward fields.
  const remoteHost = token(r.remoteHost);
  return {
    ...normalizeBase(r),
    ...normalizeConnection(r),
    kind: 'tunnel',
    type: oneOf(r.type, FORWARDS, 'local'),
    localPort: num(r.localPort, 0),
    remoteHost: remoteHost || '127.0.0.1',
    remotePort: numOrNull(r.remotePort),
    openBrowser: bool(r.openBrowser, true),
  };
}

export const tunnels = new EntityCollection<Tunnel>(FILES.tunnels, normalizeTunnel);

/** Ad-hoc "temporary" tunnels, persisted to their own file so they stay out of
 *  the main tunnels list. Same shape and behaviour as `tunnels`. */
export const tempTunnels = new EntityCollection<Tunnel>(FILES.tempTunnels, normalizeTunnel);
