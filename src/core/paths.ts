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
  vault: path.join(DATA_DIR, 'vault.json'),
  /** registry of background tunnel sessions (PID + log file per running tunnel) */
  sessions: path.join(DATA_DIR, 'sessions.json'),
  binDir: path.join(DATA_DIR, 'bin'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  /** per-session stdout/stderr logs for background tunnels */
  logsDir: path.join(DATA_DIR, 'logs'),
} as const;

/** Legacy data dir from the pre-rewrite version (auto-migrated once). */
export const LEGACY_TUNNELS_FILE = path.join(os.homedir(), '.ssh-tunnel-manager', 'tunnels.json');

export const SSH_DIR = path.join(os.homedir(), '.ssh');
export const SSH_CONFIG_FILE = path.join(SSH_DIR, 'config');

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
