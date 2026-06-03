import type { Server } from '../core/types.js';
import { FILES } from '../core/paths.js';
import { EntityCollection } from './collection.js';
import { asRaw, normalizeBase, normalizeConnection, str } from './normalize.js';

function normalizeServer(raw: unknown): Server {
  const r = asRaw(raw);
  return {
    ...normalizeBase(r),
    ...normalizeConnection(r),
    kind: 'server',
    linkedSshHost: r.linkedSshHost ? str(r.linkedSshHost) : null,
  };
}

export const servers = new EntityCollection<Server>(FILES.servers, normalizeServer);
