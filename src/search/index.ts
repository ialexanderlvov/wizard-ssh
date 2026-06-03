/** Unified fuzzy search used by every picker and the `search` command. */

import Fuse from 'fuse.js';
import type { Entity, Server, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';

const ENTITY_KEYS = ['name', 'description', 'host', 'sshHost', 'user', 'tags'];

/** Fuzzy filter a list of entities by a search term (empty term → as-is). */
export function filterEntities<T extends Entity>(items: T[], term: string | undefined): T[] {
  if (!term || !term.trim()) return items;
  const fuse = new Fuse(items, { keys: ENTITY_KEYS, threshold: 0.4, ignoreLocation: true });
  return fuse.search(term.trim()).map((r) => r.item);
}

export interface UnifiedResults {
  servers: Server[];
  tunnels: Tunnel[];
  total: number;
}

/** Search across servers (i.e. ~/.ssh/config hosts) and tunnels at once. */
export function searchEverything(term: string): UnifiedResults {
  const s = filterEntities(servers.sorted('recent'), term);
  const t = filterEntities(tunnels.sorted('recent'), term);
  return { servers: s, tunnels: t, total: s.length + t.length };
}
