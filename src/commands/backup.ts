/** Full backup of ~/.ssh (config, known_hosts AND private keys) into a
 *  timestamped, owner-only tar.gz under ~/.wizard-ssh/backups. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SSH_DIR, FILES, ensureDir } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

export interface BackupResult {
  path: string;
  bytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Archive the whole ~/.ssh directory — private keys included — into a 0600
 *  tar.gz. Returns the archive path + size, or null when there's nothing to back
 *  up or `tar` is unavailable (a message is printed in those cases). */
export function backupSshDir(destDir: string = FILES.backupsDir): BackupResult | null {
  if (!fs.existsSync(SSH_DIR)) {
    ui.printWarn(tr.actions.backupNoSshDir(SSH_DIR));
    return null;
  }
  // tar ships on macOS, Linux and Windows 10+; if it's somehow missing we bail
  // cleanly rather than half-writing an archive.
  if (!commandExists('tar')) {
    ui.printError(tr.actions.backupTarMissing);
    return null;
  }
  ensureDir(destDir);
  // Colons/dots aren't path-safe everywhere, so flatten the ISO stamp.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.resolve(destDir), `ssh-${stamp}.tar.gz`);
  // `-C $HOME .ssh` stores entries as `.ssh/...` (restorable with `tar -xzf` from
  // $HOME) and keeps the parent path out of the archive. tar preserves the inner
  // file modes; we still lock the archive itself down since it holds private keys.
  const res = capture('tar', ['-czf', dest, '-C', os.homedir(), '.ssh']);
  if (res.status !== 0 || !fs.existsSync(dest)) {
    ui.printError(tr.actions.backupFailed((res.stderr || res.stdout || '').trim()));
    return null;
  }
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    /* best-effort: the archive contains private keys, keep it owner-only */
  }
  return { path: dest, bytes: fs.statSync(dest).size };
}

/** CLI / menu flow: back up ~/.ssh and report where the archive landed. */
export function backupSshFlow(destDir?: string): number {
  ui.printSection('🗄', tr.actions.backupSection);
  const res = backupSshDir(destDir);
  if (!res) return 1;
  ui.printOk(tr.actions.backupDone(res.path, formatBytes(res.bytes)));
  ui.printInfo(tr.actions.backupKeysNote);
  return 0;
}
