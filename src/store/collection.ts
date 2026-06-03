/** Generic CRUD collection for entities (servers, tunnels) backed by a JSON
 *  file. Sorting, fuzzy-friendly listing, usage tracking — shared by both. */

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
  corruptBackup?: string;

  constructor(
    private readonly file: string,
    private readonly normalize: (raw: unknown) => T,
  ) {}

  private load(): T[] {
    if (this.items) return this.items;
    const { data, corruptBackup } = readJson<FileShape<unknown>>(this.file, {
      version: 1,
      items: [],
    });
    if (corruptBackup) this.corruptBackup = corruptBackup;
    const rawItems = Array.isArray(data.items) ? data.items : [];
    this.items = rawItems.map((r) => this.normalize(r));
    return this.items;
  }

  private persist(): void {
    writeJson(this.file, { version: 1, items: this.load() });
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

  /** Replace the whole collection (used by import). */
  replaceAll(items: T[]): void {
    this.items = items.map((i) => this.normalize(i));
    this.persist();
  }
}
