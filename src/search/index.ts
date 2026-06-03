/** Unified fuzzy search used by every picker and the `search` command. */

import Fuse from 'fuse.js';
import type { Entity, Server, SshConfigHost, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import * as sshConfig from '../ssh-config/index.js';

const ENTITY_KEYS = ['name', 'description', 'host', 'sshHost', 'user', 'tags'];
const HOST_KEYS = ['alias', 'hostName', 'user'];

/** Fuzzy filter a list of entities by a search term (empty term → as-is). */
export function filterEntities<T extends Entity>(items: T[], term: string | undefined): T[] {
  if (!term || !term.trim()) return items;
  const fuse = new Fuse(items, { keys: ENTITY_KEYS, threshold: 0.4, ignoreLocation: true });
  return fuse.search(term.trim()).map((r) => r.item);
}

export function filterConfigHosts(
  hosts: SshConfigHost[],
  term: string | undefined,
): SshConfigHost[] {
  if (!term || !term.trim()) return hosts;
  const fuse = new Fuse(hosts, { keys: HOST_KEYS, threshold: 0.4, ignoreLocation: true });
  return fuse.search(term.trim()).map((r) => r.item);
}

export interface UnifiedResults {
  servers: Server[];
  tunnels: Tunnel[];
  configHosts: SshConfigHost[];
  total: number;
}

/** Search across servers, tunnels and ~/.ssh/config at once. */
export function searchEverything(term: string): UnifiedResults {
  const s = filterEntities(servers.sorted('recent'), term);
  const t = filterEntities(tunnels.sorted('recent'), term);
  const c = filterConfigHosts(sshConfig.listHosts(), term);
  return { servers: s, tunnels: t, configHosts: c, total: s.length + t.length + c.length };
}
