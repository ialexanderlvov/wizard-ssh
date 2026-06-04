/** Low-level atomic JSON persistence with corruption recovery. */

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../core/paths.js';
import { atomicWrite } from '../utils/atomic.js';
import { tr } from '../i18n/index.js';

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
      return { data: fallback, corruptBackup: tr.vault.jsonfileBackupFailed };
    }
  }
}

/** Atomic write (tmp + fsync + rename) with restrictive permissions. The tmp is
 *  opened exclusively with an unpredictable name (see {@link atomicWrite}) so two
 *  concurrent writers can't clobber each other and a pre-planted symlink at the
 *  tmp path can't redirect the write — relevant when `file` lives in a shared dir
 *  (e.g. an export target under /tmp), not just under ~/.wizard-ssh. */
export function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  atomicWrite(file, JSON.stringify(data, null, 2));
}
