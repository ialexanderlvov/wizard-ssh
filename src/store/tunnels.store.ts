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
  FORWARDS,
} from './normalize.js';

function normalizeTunnel(raw: unknown): Tunnel {
  const r = asRaw(raw);
  return {
    ...normalizeBase(r),
    ...normalizeConnection(r),
    kind: 'tunnel',
    type: oneOf(r.type, FORWARDS, 'local'),
    localPort: num(r.localPort, 0),
    remoteHost: r.remoteHost ? String(r.remoteHost) : '127.0.0.1',
    remotePort: numOrNull(r.remotePort),
    openBrowser: bool(r.openBrowser, true),
  };
}

export const tunnels = new EntityCollection<Tunnel>(FILES.tunnels, normalizeTunnel);
