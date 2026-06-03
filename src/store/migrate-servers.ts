/** One-time migration of the old servers.json into ~/.ssh/config. Each saved
 *  server becomes a Host block (annotated with `#wssh {...}`); usage stats move
 *  to usage.json. The real config is backed up first, and servers.json is then
 *  renamed to servers.json.migrated (kept, never deleted) so this runs once. */

import fs from 'node:fs';
import type { AuthMethod } from '../core/types.js';
import { FILES } from '../core/paths.js';
import { readJson } from './json-file.js';
import * as sshConfig from '../ssh-config/index.js';
import { servers } from './servers.store.js';
import { usage } from './usage.store.js';
import { slugify } from '../utils/strings.js';
import { isValidSshAlias } from '../utils/validators.js';

interface LegacyServer {
  name?: string;
  description?: string;
  tags?: unknown;
  hostMode?: string;
  sshHost?: string;
  host?: string;
  user?: string;
  sshPort?: number;
  auth?: string;
  keyPath?: string | null;
  secretId?: string | null;
  createdAt?: string;
  lastUsedAt?: string | null;
  useCount?: number;
  /** legacy field: alias this manual server was mirrored into ~/.ssh/config as */
  linkedSshHost?: string | null;
}

export interface ServerMigrationResult {
  count: number;
  backup: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Returns the number of servers migrated, or null when there was nothing to do. */
export function migrateServersToConfig(): ServerMigrationResult | null {
  if (!fs.existsSync(FILES.servers)) return null;

  const { data } = readJson<{ items?: unknown[] }>(FILES.servers, {});
  const items = Array.isArray(data.items) ? (data.items as LegacyServer[]) : [];

  // Even an empty/legacy file gets retired so we never re-scan it.
  const backup = items.length ? sshConfig.backupConfig() : null;
  const used = new Set(sshConfig.listHosts().map((h) => h.alias.toLowerCase()));

  const uniqueAlias = (base: string): string => {
    let alias = base;
    let n = 2;
    while (used.has(alias.toLowerCase())) alias = `${base}-${n++}`;
    used.add(alias.toLowerCase());
    return alias;
  };

  /** True only for a single-alias host in the MAIN config (safe to annotate). */
  const annotatable = (alias: string): boolean =>
    !!alias && sshConfig.getHost(alias)?.manageable === true;

  let count = 0;
  for (const s of items) {
    try {
      const name = str(s.name);
      const fromConfig = s.hostMode === 'sshconfig' && !!str(s.sshHost);
      const linked = str(s.linkedSshHost);
      // Annotate an EXISTING managed host in place when the legacy server already
      // referenced one (sshconfig mode) or was mirrored into config (linkedSshHost).
      const inPlace =
        fromConfig && annotatable(str(s.sshHost))
          ? str(s.sshHost)
          : !fromConfig && annotatable(linked)
            ? linked
            : '';
      const auth: AuthMethod =
        s.auth === 'password' ? 'password' : s.auth === 'key' ? 'key' : 'agent';
      const meta = {
        description: str(s.description),
        tags: strArr(s.tags),
        secretId: typeof s.secretId === 'string' ? s.secretId : null,
        createdAt: str(s.createdAt),
      };

      let alias: string;
      if (inPlace) {
        // Keep the existing block's connection params; just add our annotation.
        alias = inPlace;
        servers.update(alias, { ...meta, auth });
      } else {
        const base = fromConfig
          ? str(s.sshHost)
          : isValidSshAlias(name)
            ? name
            : slugify(name) || 'server';
        alias = uniqueAlias(base);
        servers.create({
          name: alias,
          host: str(s.host),
          user: str(s.user),
          sshPort: Number(s.sshPort) || 22,
          auth,
          keyPath: typeof s.keyPath === 'string' ? s.keyPath : null,
          ...meta,
          kind: 'server',
        });
      }
      usage.set(alias, {
        lastUsedAt: typeof s.lastUsedAt === 'string' ? s.lastUsedAt : null,
        useCount: Number(s.useCount) || 0,
      });
      count++;
    } catch {
      // One malformed legacy record must not abort the whole migration.
    }
  }

  // Retire servers.json so the migration is idempotent.
  try {
    fs.rmSync(FILES.serversMigrated, { force: true });
    fs.renameSync(FILES.servers, FILES.serversMigrated);
  } catch {
    /* best-effort: if the rename fails the data is still in config */
  }

  return { count, backup };
}
