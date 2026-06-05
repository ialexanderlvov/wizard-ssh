/** Low-level atomic JSON persistence with corruption recovery. */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
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
    const parsed = JSON.parse(raw);
    // A valid-JSON scalar/array/null is NOT a usable store object: every store
    // file we write is a top-level object ({version,items}, {sessions}, a vault,
    // settings…). The literal token `null` (or `42`/`"x"`/an array) would parse
    // fine and then crash callers that dereference `data.items`/`data.tunnels`
    // (which run at startup, before any command — a total DoS). Treat a
    // non-object as corrupt so it funnels into the same backup+fallback path as a
    // JSON syntax error, instead of propagating a TypeError.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new SyntaxError('not a JSON object');
    return { data: parsed as T };
  } catch {
    // Never lose user data silently: back the bad file up, then start clean.
    try {
      // Unpredictable suffix + COPYFILE_EXCL (fail if the dest already exists):
      // for an `import` of a corrupt file from a shared dir this avoids a symlink
      // race / clobber at a predictable `<file>.corrupt-<ms>` path.
      const backup = `${file}.corrupt-${Date.now()}-${randomBytes(4).toString('hex')}`;
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
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
