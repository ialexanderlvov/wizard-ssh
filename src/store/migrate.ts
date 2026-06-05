/** One-time import of data from the pre-rewrite tool (~/.ssh-tunnel-manager). */

import fs from 'node:fs';
import type { Tunnel } from '../core/types.js';
import { FILES, LEGACY_TUNNELS_FILE } from '../core/paths.js';
import { readJson } from './json-file.js';
import { tunnels } from './tunnels.store.js';
import { settings } from './settings.store.js';
import { isValidPort, isValidUser, isValidForwardHost } from '../utils/validators.js';

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
    // Validate the same fields the import path does — an old tool's settings are
    // untrusted input, so a malformed user/host/port must not be persisted (and
    // then surface as a confusing WizardError on a later non-interactive `add`).
    settings.update({
      ...(typeof s.defaultUser === 'string' && (s.defaultUser === '' || isValidUser(s.defaultUser))
        ? { defaultUser: s.defaultUser }
        : {}),
      ...(isValidPort(s.defaultSshPort) ? { defaultSshPort: Number(s.defaultSshPort) } : {}),
      ...(typeof s.defaultRemoteHost === 'string' &&
      (s.defaultRemoteHost === '' || isValidForwardHost(s.defaultRemoteHost))
        ? { defaultRemoteHost: s.defaultRemoteHost }
        : {}),
    });
  }

  return legacy.length;
}
