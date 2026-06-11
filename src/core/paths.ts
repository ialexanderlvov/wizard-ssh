/** Filesystem locations for all wizard-ssh data. Everything lives under
 *  ~/.wizard-ssh (overridable via WIZARD_SSH_HOME, mainly for tests). */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DATA_DIR =
  process.env.WIZARD_SSH_HOME && process.env.WIZARD_SSH_HOME.trim()
    ? path.resolve(process.env.WIZARD_SSH_HOME)
    : path.join(os.homedir(), '.wizard-ssh');

export const FILES = {
  servers: path.join(DATA_DIR, 'servers.json'),
  /** legacy servers.json renamed here once it is migrated into ~/.ssh/config */
  serversMigrated: path.join(DATA_DIR, 'servers.json.migrated'),
  /** per-alias usage stats (lastUsedAt / useCount) for config-backed servers */
  usage: path.join(DATA_DIR, 'usage.json'),
  tunnels: path.join(DATA_DIR, 'tunnels.json'),
  /** ad-hoc "temporary" tunnels — kept in their own list, separate from tunnels */
  tempTunnels: path.join(DATA_DIR, 'temp-tunnels.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  /** saved command snippets for `wssh run` (global or per-server) */
  snippets: path.join(DATA_DIR, 'snippets.json'),
  vault: path.join(DATA_DIR, 'vault.json'),
  /** registry of background tunnel sessions (PID + log file per running tunnel) */
  sessions: path.join(DATA_DIR, 'sessions.json'),
  /** registry of background file-transfer sessions (PID + log per running scp/rsync) */
  transferSessions: path.join(DATA_DIR, 'transfer-sessions.json'),
  binDir: path.join(DATA_DIR, 'bin'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  /** per-session stdout/stderr logs for background tunnels */
  logsDir: path.join(DATA_DIR, 'logs'),
} as const;

/** Legacy data dir from the pre-rewrite version (auto-migrated once). */
export const LEGACY_TUNNELS_FILE = path.join(os.homedir(), '.ssh-tunnel-manager', 'tunnels.json');

export const SSH_DIR = path.join(os.homedir(), '.ssh');
export const SSH_CONFIG_FILE = path.join(SSH_DIR, 'config');

/** Tighten a directory to at most 0o700 (tighten-only — never loosens a stricter
 *  mode the user chose). mkdir's `mode` only applies on CREATION, so a dir that
 *  pre-exists from an older build, another tool, or a permissive umask would
 *  otherwise stay group/world-listable indefinitely. */
function tightenDir(dir: string): void {
  try {
    const mode = fs.statSync(dir).mode & 0o777;
    if (mode & ~0o700) fs.chmodSync(dir, mode & 0o700);
  } catch {
    /* best-effort */
  }
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  tightenDir(DATA_DIR);
}

/** True when `dir` is DATA_DIR itself or lives under it — the only directories
 *  this app owns and may safely tighten. */
function isUnderDataDir(dir: string): boolean {
  const r = path.resolve(dir);
  return r === DATA_DIR || r.startsWith(DATA_DIR + path.sep);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Only chmod-tighten directories WE own. ensureDir is also reached with a
  // user-chosen destination (export/backup into ~/shared, a synced folder, …) and
  // silently flipping that to 0700 would break group/tooling access (and drop the
  // sticky bit if run as root over a world-dir). A brand-new dir we create still
  // lands at 0700 via mkdir's mode; we just don't re-tighten a pre-existing one.
  if (isUnderDataDir(dir)) tightenDir(dir);
}
