/** Generic CRUD collection for entities (servers, tunnels) backed by a JSON
 *  file. Sorting, fuzzy-friendly listing, usage tracking — shared by both. */

import fs from 'node:fs';
import type { BaseEntity, SortKey } from '../core/types.js';
import { newId } from '../utils/id.js';
import { nowIso, ts } from '../utils/time.js';
import { readJson, writeJson } from './json-file.js';

interface FileShape<T> {
  version: number;
  items: T[];
}

const SORTERS: Record<SortKey, (a: BaseEntity, b: BaseEntity) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  created: (a, b) => ts(b.createdAt) - ts(a.createdAt) || a.name.localeCompare(b.name),
  updated: (a, b) => ts(b.updatedAt) - ts(a.updatedAt) || a.name.localeCompare(b.name),
  uses: (a, b) => (b.useCount || 0) - (a.useCount || 0) || a.name.localeCompare(b.name),
  recent: (a, b) => ts(b.lastUsedAt) - ts(a.lastUsedAt) || a.name.localeCompare(b.name),
};

export class EntityCollection<T extends BaseEntity> {
  private items: T[] | null = null;
  /** signature (mtime + size) of the file when we last (re)read it — used to
   *  invalidate the cache when the file changed underneath us (another `wssh`
   *  process, or a hand edit while a long-lived interactive menu is open). Size is
   *  folded in alongside mtime so two writes that share an mtime tick on a
   *  coarse-granularity FS (NFS/FAT/SMB) are still seen as a change. '' = no file
   *  / never read. */
  private sig = '';
  corruptBackup?: string;

  constructor(
    private readonly file: string,
    private readonly normalize: (raw: unknown) => T,
  ) {}

  private fileSig(): string {
    try {
      const st = fs.statSync(this.file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  /** Always reflect what's on disk. Re-reads when the file's signature changed
   *  since our cached copy, so a long-lived menu (and read-modify-write mutations)
   *  never operate on — or silently overwrite — another process's newer state. */
  private load(): T[] {
    const s = this.fileSig();
    if (this.items && s === this.sig) return this.items;
    const { data, corruptBackup } = readJson<FileShape<unknown>>(this.file, {
      version: 1,
      items: [],
    });
    if (corruptBackup) this.corruptBackup = corruptBackup;
    const rawItems = Array.isArray(data.items) ? data.items : [];
    this.items = rawItems.map((r) => this.normalize(r));
    this.sig = s;
    return this.items;
  }

  private persist(): void {
    writeJson(this.file, { version: 1, items: this.load() });
    // Adopt the just-written file's signature so the next load() trusts our own
    // cache (and only re-reads when SOMEONE ELSE writes after us).
    this.sig = this.fileSig();
  }

  all(): T[] {
    return this.load().slice();
  }

  sorted(key: SortKey = 'recent', reverse = false): T[] {
    const list = this.all().sort(SORTERS[key] ?? SORTERS.recent);
    return reverse ? list.reverse() : list;
  }

  findById(id: string): T | null {
    return this.load().find((t) => t.id === id) ?? null;
  }

  findByName(name: string): T | null {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return this.load().find((t) => t.name.toLowerCase() === n) ?? null;
  }

  nameExists(name: string, exceptId?: string): boolean {
    const n = name.trim().toLowerCase();
    return this.load().some((t) => t.name.toLowerCase() === n && t.id !== exceptId);
  }

  create(data: Partial<T> & { name: string }): T {
    const item = this.normalize({
      ...data,
      id: newId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.load().push(item);
    this.persist();
    return item;
  }

  update(id: string, patch: Partial<T>): T | null {
    const list = this.load();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const current = list[idx] as T;
    const merged = this.normalize({ ...current, ...patch, id, updatedAt: nowIso() });
    list[idx] = merged;
    this.persist();
    return merged;
  }

  remove(id: string): boolean {
    const list = this.load();
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) return false;
    this.items = next;
    this.persist();
    return true;
  }

  /** Bump usage stats after a connect attempt. Returns false if gone. */
  touch(id: string): boolean {
    const item = this.load().find((t) => t.id === id);
    if (!item) return false;
    item.lastUsedAt = nowIso();
    item.useCount = (item.useCount || 0) + 1;
    this.persist();
    return true;
  }

  /** Replace the whole collection (used by import/migration). */
  replaceAll(items: T[]): void {
    // Prime the cache first so mtimeMs matches the on-disk file. Without this, a
    // cold cache (mtimeMs=0) over an EXISTING file (mtime>0) makes persist()'s
    // inner load() see a mismatch and RE-READ the old file, silently discarding
    // the items we are trying to write (e.g. `import --replace` reported success
    // while dropping every imported tunnel).
    this.load();
    this.items = items.map((i) => this.normalize(i));
    this.persist();
  }
}
