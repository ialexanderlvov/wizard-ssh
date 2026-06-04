/** Static app metadata + defaults. */

import { readFileSync } from 'node:fs';
import type { Settings } from './types.js';

export const APP_NAME = 'wizard-ssh';
export const APP_BIN = 'wssh';

/** Single source of truth for the version: read it from package.json at load
 *  time so `wssh -v` always matches the published package and never drifts.
 *  release-please bumps package.json (not source), so a hard-coded constant
 *  would stay stale. The bundle is one file under dist/, so the manifest sits at
 *  ../package.json in a published install; running from src/core/ it is two up.
 *  Try both and verify the name before trusting the version. */
function readAppVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === APP_NAME && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* try the next candidate */
    }
  }
  return '0.0.0';
}

export const APP_VERSION = readAppVersion();

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  defaultUser: 'root',
  defaultSshPort: 22,
  defaultAuth: 'agent',
  defaultRemoteHost: '127.0.0.1',
  openBrowser: true,
  defaultSort: 'recent',
  tunnelAutoReconnect: true,
  vault: {
    enabled: false,
    touchId: false,
  },
};
