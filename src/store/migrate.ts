/** One-time import of data from the pre-rewrite tool (~/.ssh-tunnel-manager). */

import fs from 'node:fs';
import type { Tunnel } from '../core/types.js';
import { FILES, LEGACY_TUNNELS_FILE } from '../core/paths.js';
import { readJson } from './json-file.js';
import { tunnels } from './tunnels.store.js';
import { settings } from './settings.store.js';

interface LegacyFile {
  settings?: Record<string, unknown>;
  tunnels?: unknown[];
}

/** Returns the number of tunnels imported (0 if nothing to do). */
export function runMigration(): number {
  // Already migrated / fresh install with new file present → skip.
  if (fs.existsSync(FILES.tunnels)) return 0;
  if (!fs.existsSync(LEGACY_TUNNELS_FILE)) return 0;

  const { data } = readJson<LegacyFile>(LEGACY_TUNNELS_FILE, {});
  const legacy = Array.isArray(data.tunnels) ? data.tunnels : [];
  if (!legacy.length && !data.settings) return 0;

  // Normalisation happens inside the store; legacy shape maps 1:1 to Tunnel.
  tunnels.replaceAll(legacy as Tunnel[]);

  if (data.settings && typeof data.settings === 'object') {
    const s = data.settings as Record<string, unknown>;
    settings.update({
      ...(typeof s.defaultUser === 'string' ? { defaultUser: s.defaultUser } : {}),
      ...(Number.isFinite(Number(s.defaultSshPort))
        ? { defaultSshPort: Number(s.defaultSshPort) }
        : {}),
      ...(typeof s.defaultRemoteHost === 'string'
        ? { defaultRemoteHost: s.defaultRemoteHost }
        : {}),
    });
  }

  return legacy.length;
}
