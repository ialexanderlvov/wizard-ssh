/** Per-alias usage stats for config-backed servers. These are volatile and must
 *  NOT live in ~/.ssh/config (that would rewrite the config on every connect),
 *  so they sit in their own usage.json keyed by Host alias. */

import fs from 'node:fs';
import { FILES } from '../core/paths.js';
import { readJson, writeJson } from './json-file.js';
import { nowIso, ts } from '../utils/time.js';

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
  /** signature (mtime+size) of the file when last read — re-read when a
   *  concurrent `wssh` bumped a counter, so a long-lived menu doesn't write back a
   *  stale snapshot and lose the other process's increment. */
  private sig = '';

  private fileSig(): string {
    try {
      const st = fs.statSync(FILES.usage);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  private load(): UsageFile {
    const s = this.fileSig();
    if (this.cache && s === this.sig) return this.cache;
    const { data } = readJson<UsageFile>(FILES.usage, { version: 1, hosts: {} });
    const hosts =
      data && typeof data === 'object' && data.hosts && typeof data.hosts === 'object'
        ? data.hosts
        : {};
    this.cache = { version: 1, hosts };
    this.sig = s;
    return this.cache;
  }

  private persist(f: UsageFile): void {
    this.cache = f;
    writeJson(FILES.usage, f);
    this.sig = this.fileSig();
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

  /** Merge imported stats WITHOUT rewinding: keep the higher useCount and the
   *  more-recent lastUsedAt. Used by import so re-importing your own export (or a
   *  teammate's bundle, whose counts are typically lower/zero) never zeroes or
   *  reduces the local "most-used / recent" history. */
  merge(alias: string, entry: Partial<UsageEntry>): void {
    const f = this.load();
    const cur = f.hosts[alias] ?? EMPTY;
    const incoming = { ...EMPTY, ...entry };
    f.hosts[alias] = {
      useCount: Math.max(cur.useCount || 0, incoming.useCount || 0),
      lastUsedAt:
        ts(incoming.lastUsedAt) > ts(cur.lastUsedAt) ? incoming.lastUsedAt : cur.lastUsedAt,
    };
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
