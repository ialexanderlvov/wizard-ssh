/** Low-level atomic JSON persistence with corruption recovery. */

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../core/paths.js';

export interface ReadResult<T> {
  data: T;
  /** set when the file was corrupt and a backup was taken */
  corruptBackup?: string;
}

export function readJson<T>(file: string, fallback: T): ReadResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { data: fallback };
  }
  try {
    return { data: JSON.parse(raw) as T };
  } catch {
    // Never lose user data silently: back the bad file up, then start clean.
    try {
      const backup = `${file}.corrupt-${Date.now()}`;
      fs.copyFileSync(file, backup);
      return { data: fallback, corruptBackup: backup };
    } catch {
      return { data: fallback, corruptBackup: '(резервную копию создать не удалось)' };
    }
  }
}

/** Atomic write (tmp + rename) with restrictive permissions. */
export function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
