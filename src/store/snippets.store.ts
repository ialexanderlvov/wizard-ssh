/** Saved command snippets for `wssh run`: a named shell line, optionally bound
 *  to one server (global otherwise). Same cache/sig pattern as the other JSON
 *  stores so concurrent wssh processes don't clobber each other. */

import fs from 'node:fs';
import { FILES } from '../core/paths.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { readJson, writeJson } from './json-file.js';

export interface Snippet {
  id: string;
  /** unique, case-insensitive */
  name: string;
  /** shell line, executed remotely via `sh -lc` */
  command: string;
  /** restrict to one server (its name/alias); null = usable everywhere */
  server: string | null;
  createdAt: string;
}

interface SnippetsFile {
  version: 1;
  snippets: Snippet[];
}

function isSnippet(s: unknown): s is Snippet {
  if (!s || typeof s !== 'object') return false;
  const v = s as Snippet;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    v.name.trim().length > 0 &&
    typeof v.command === 'string' &&
    (v.server === null || typeof v.server === 'string')
  );
}

class SnippetsStore {
  private cache: SnippetsFile | null = null;
  private sig = '';

  private fileSig(): string {
    try {
      const st = fs.statSync(FILES.snippets);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  private load(): SnippetsFile {
    const s = this.fileSig();
    if (this.cache && s === this.sig) return this.cache;
    const { data } = readJson<SnippetsFile>(FILES.snippets, { version: 1, snippets: [] });
    const snippets = Array.isArray(data?.snippets) ? data.snippets.filter(isSnippet) : [];
    this.cache = { version: 1, snippets };
    this.sig = s;
    return this.cache;
  }

  private persist(f: SnippetsFile): void {
    this.cache = f;
    writeJson(FILES.snippets, f);
    this.sig = this.fileSig();
  }

  all(): Snippet[] {
    return this.load().snippets.slice();
  }

  findByName(name: string): Snippet | null {
    const lower = name.trim().toLowerCase();
    return this.load().snippets.find((s) => s.name.toLowerCase() === lower) ?? null;
  }

  nameExists(name: string): boolean {
    return this.findByName(name) !== null;
  }

  /** Snippets applicable to a server: its own + the global ones. */
  forServer(serverName: string): Snippet[] {
    const lower = serverName.toLowerCase();
    return this.load().snippets.filter(
      (s) => s.server === null || s.server.toLowerCase() === lower,
    );
  }

  add(input: Pick<Snippet, 'name' | 'command' | 'server'>): Snippet {
    const f = this.load();
    const snippet: Snippet = { id: newId(), createdAt: nowIso(), ...input };
    this.persist({ version: 1, snippets: [...f.snippets, snippet] });
    return snippet;
  }

  remove(id: string): void {
    const f = this.load();
    const next = f.snippets.filter((s) => s.id !== id);
    if (next.length !== f.snippets.length) this.persist({ version: 1, snippets: next });
  }
}

export const snippets = new SnippetsStore();
