/** Per-alias usage stats for config-backed servers. These are volatile and must
 *  NOT live in ~/.ssh/config (that would rewrite the config on every connect),
 *  so they sit in their own usage.json keyed by Host alias. */

import { FILES } from '../core/paths.js';
import { readJson, writeJson } from './json-file.js';
import { nowIso } from '../utils/time.js';

export interface UsageEntry {
  lastUsedAt: string | null;
  useCount: number;
}

interface UsageFile {
  version: 1;
  hosts: Record<string, UsageEntry>;
}

const EMPTY: UsageEntry = { lastUsedAt: null, useCount: 0 };

class UsageStore {
  private cache: UsageFile | null = null;

  private load(): UsageFile {
    if (this.cache) return this.cache;
    const { data } = readJson<UsageFile>(FILES.usage, { version: 1, hosts: {} });
    const hosts =
      data && typeof data === 'object' && data.hosts && typeof data.hosts === 'object'
        ? data.hosts
        : {};
    this.cache = { version: 1, hosts };
    return this.cache;
  }

  private persist(f: UsageFile): void {
    this.cache = f;
    writeJson(FILES.usage, f);
  }

  /** Stats for an alias (zeroed defaults when never used). */
  get(alias: string): UsageEntry {
    return { ...EMPTY, ...this.load().hosts[alias] };
  }

  /** Record a connection: bump lastUsedAt + useCount. */
  touch(alias: string): void {
    const f = this.load();
    const cur = f.hosts[alias] ?? EMPTY;
    f.hosts[alias] = { lastUsedAt: nowIso(), useCount: (cur.useCount || 0) + 1 };
    this.persist(f);
  }

  /** Overwrite an alias's stats (used by migration to carry old counts over). */
  set(alias: string, entry: Partial<UsageEntry>): void {
    const f = this.load();
    f.hosts[alias] = { ...EMPTY, ...f.hosts[alias], ...entry };
    this.persist(f);
  }

  remove(alias: string): void {
    const f = this.load();
    if (f.hosts[alias]) {
      delete f.hosts[alias];
      this.persist(f);
    }
  }

  /** Carry stats across a rename (alias change). */
  rename(oldAlias: string, newAlias: string): void {
    if (oldAlias === newAlias) return;
    const f = this.load();
    const e = f.hosts[oldAlias];
    if (e) {
      delete f.hosts[oldAlias];
      f.hosts[newAlias] = e;
      this.persist(f);
    }
  }
}

export const usage = new UsageStore();
