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

let tmpCounter = 0;

/** Atomic write (tmp + fsync + rename) with restrictive permissions. The tmp
 *  name is unique per process+call so two concurrent writers (e.g. a background
 *  tunnel and a foreground edit) can't clobber each other's tmp file and corrupt
 *  the target; fsync flushes the bytes to disk before the rename so a crash
 *  right after can't leave a half-written file. */
export function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
