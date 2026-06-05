/** Servers backed by ~/.ssh/config (the single source of truth). A "server" IS
 *  a single-alias Host block; its name is the alias. App-only data
 *  (description, tags, password-auth + vault secret id, createdAt) rides in a
 *  `#wssh {...}` comment above the block; volatile stats live in usage.json.
 *
 *  This exposes the SAME surface the old JSON-backed collection did
 *  (all, sorted, find*, create, update, remove, touch, replaceAll) so callers
 *  are unchanged — but every read assembles from config + usage, and every
 *  write goes through the ssh-config writer (with its automatic backup). */

import type {
  AuthMethod,
  ConnectionTarget,
  Server,
  SortKey,
  SshConfigHost,
  WsshMeta,
} from '../core/types.js';
import type { SshConfigParam } from '../ssh-config/index.js';
import * as sshConfig from '../ssh-config/index.js';
import { nowIso, ts } from '../utils/time.js';
import { usage } from './usage.store.js';

const SORTERS: Record<SortKey, (a: Server, b: Server) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  created: (a, b) => ts(b.createdAt) - ts(a.createdAt) || a.name.localeCompare(b.name),
  updated: (a, b) => ts(b.updatedAt) - ts(a.updatedAt) || a.name.localeCompare(b.name),
  uses: (a, b) => (b.useCount || 0) - (a.useCount || 0) || a.name.localeCompare(b.name),
  recent: (a, b) => ts(b.lastUsedAt) - ts(a.lastUsedAt) || a.name.localeCompare(b.name),
};

/** Standard connection directives the facade owns; anything else is preserved. */
const STD_PARAMS = new Set(['hostname', 'user', 'port', 'identityfile', 'proxyjump']);

/** Assemble a Server from a parsed config host + its usage stats. */
function toServer(h: SshConfigHost): Server {
  const meta = h.wssh ?? {};
  const u = usage.get(h.alias);
  // password is explicit in #wssh; a key is implied by an IdentityFile directive;
  // everything else is the agent / config default.
  const auth: AuthMethod = meta.auth === 'password' ? 'password' : h.identityFile ? 'key' : 'agent';
  return {
    kind: 'server',
    id: h.alias,
    name: h.alias,
    description: meta.desc ?? '',
    tags: meta.tags ?? [],
    createdAt: meta.createdAt ?? '',
    updatedAt: meta.updatedAt ?? meta.createdAt ?? '',
    lastUsedAt: u.lastUsedAt,
    useCount: u.useCount,
    hostMode: 'sshconfig',
    sshHost: h.alias,
    host: h.hostName,
    user: h.user,
    sshPort: h.port ? Number(h.port) || 22 : 22,
    auth,
    keyPath: h.identityFile || null,
    secretId: meta.secretId ?? null,
    manageable: h.manageable,
    proxyJump: h.proxyJump || undefined,
  };
}

/** Build the ssh-config params from a connection target, preserving any extra
 *  directives (ProxyJump, Compression, …) already present on the block. */
function paramsFor(
  conn: ConnectionTarget,
  existing: SshConfigParam[] = [],
  proxyJump?: string,
): SshConfigParam[] {
  const out: SshConfigParam[] = [];
  if (conn.host) out.push({ key: 'HostName', value: conn.host });
  if (conn.user) out.push({ key: 'User', value: conn.user });
  if (conn.sshPort && Number(conn.sshPort) !== 22)
    out.push({ key: 'Port', value: String(conn.sshPort) });
  // Always preserve a known IdentityFile (covers auth:'key' and config hosts read
  // back as agent/password + keyPath); a password connect ignores it anyway, so
  // keeping it never drops the user's key directive.
  if (conn.keyPath) out.push({ key: 'IdentityFile', value: conn.keyPath });
  // ProxyJump is a managed field (so create/duplicate carry the bastion route,
  // not just edits that happen to preserve the existing block's params).
  if (proxyJump) out.push({ key: 'ProxyJump', value: proxyJump });
  for (const p of existing) if (!STD_PARAMS.has(p.key.toLowerCase())) out.push(p);
  return out;
}

function metaFor(data: Partial<Server>, createdAt: string, updatedAt: string): WsshMeta {
  return {
    ...(data.description ? { desc: data.description } : {}),
    ...(data.tags && data.tags.length ? { tags: data.tags } : {}),
    ...(data.auth === 'password' ? { auth: 'password' as const } : {}),
    ...(data.secretId ? { secretId: data.secretId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function connOf(data: Partial<Server>): ConnectionTarget {
  return {
    hostMode: 'sshconfig',
    sshHost: '',
    host: typeof data.host === 'string' ? data.host : '',
    user: typeof data.user === 'string' ? data.user : '',
    sshPort: Number(data.sshPort) || 22,
    auth: data.auth ?? 'agent',
    keyPath: data.keyPath ?? null,
    secretId: data.secretId ?? null,
  };
}

class ConfigServers {
  all(): Server[] {
    return sshConfig.listHosts().map(toServer);
  }

  sorted(key: SortKey = 'recent', reverse = false): Server[] {
    const list = this.all().sort(SORTERS[key] ?? SORTERS.recent);
    return reverse ? list.reverse() : list;
  }

  findById(id: string): Server | null {
    const h = sshConfig.getHost(id);
    return h ? toServer(h) : null;
  }

  findByName(name: string): Server | null {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    const h = sshConfig.listHosts().find((x) => x.alias.toLowerCase() === n);
    return h ? toServer(h) : null;
  }

  nameExists(name: string, exceptId?: string): boolean {
    const n = name.trim().toLowerCase();
    return sshConfig.listHosts().some((x) => x.alias.toLowerCase() === n && x.alias !== exceptId);
  }

  /** Create a new Host block (or overwrite one of the same alias). */
  create(data: Partial<Server> & { name: string }): Server {
    const alias = data.name.trim();
    const existing = sshConfig.getHost(alias);
    const createdAt = data.createdAt || existing?.wssh?.createdAt || nowIso();
    sshConfig.upsertHost({
      alias,
      params: paramsFor(connOf(data), existing?.params ?? [], data.proxyJump),
      wssh: metaFor(data, createdAt, nowIso()),
    });
    return this.findById(alias) as Server;
  }

  /** Patch a server. Connection fields rewrite the block; metadata rewrites the
   *  `#wssh` comment; a name change renames the alias (and moves its stats). */
  update(id: string, patch: Partial<Server>): Server | null {
    const current = this.findById(id);
    if (!current) return null;
    // Multi-alias / Match / Include hosts can't be spliced safely — never rewrite
    // them (the writer would otherwise append a duplicate single-alias block).
    if (!current.manageable) return current;
    const host = sshConfig.getHost(id);
    const merged: Server = { ...current, ...patch };
    const newAlias = (patch.name ?? id).trim();

    // Write the (possibly renamed) block FIRST, then drop the old one — so a
    // failed write can never leave the server missing from the config.
    sshConfig.upsertHost({
      alias: newAlias,
      params: paramsFor(connOf(merged), host?.params ?? [], merged.proxyJump),
      wssh: metaFor(merged, merged.createdAt || current.createdAt || nowIso(), nowIso()),
    });
    if (newAlias !== id) {
      sshConfig.removeHost(id);
      usage.rename(id, newAlias);
    }
    return this.findById(newAlias);
  }

  remove(id: string): boolean {
    const { removed } = sshConfig.removeHost(id);
    if (removed) usage.remove(id);
    return removed;
  }

  /** Record a connection (bump lastUsedAt / useCount). Always "succeeds". */
  touch(id: string): boolean {
    usage.touch(id);
    return true;
  }

  /** Import: upsert each server into the config (keyed by alias) + its stats.
   *  Servers are MERGED, never wiped — ~/.ssh/config is the shared source of
   *  truth (it also holds hosts used by plain ssh), so an import must not delete
   *  config blocks that are merely absent from the bundle. The import UI wording
   *  reflects this asymmetry vs the (truly replaced) tunnels list. */
  replaceAll(items: Server[]): void {
    for (const s of items) {
      const alias = (s.name || s.sshHost || '').trim();
      if (!alias) continue;
      try {
        sshConfig.upsertHost({
          alias,
          params: paramsFor(connOf(s), sshConfig.getHost(alias)?.params ?? []),
          wssh: metaFor(s, s.createdAt || nowIso(), s.updatedAt || s.createdAt || nowIso()),
        });
        // Merge (don't overwrite): an import must never rewind local usage history.
        usage.merge(alias, { lastUsedAt: s.lastUsedAt ?? null, useCount: s.useCount || 0 });
      } catch {
        // Skip a server we can't safely manage (e.g. its alias lives in an
        // Include) rather than aborting the whole import mid-way.
      }
    }
  }
}

export const servers = new ConfigServers();
