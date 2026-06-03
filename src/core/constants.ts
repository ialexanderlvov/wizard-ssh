/** Static app metadata + defaults. */

import type { Settings } from './types.js';

export const APP_NAME = 'wizard-ssh';
export const APP_BIN = 'wssh';
export const APP_VERSION = '1.0.0';

export const DEFAULT_SETTINGS: Settings = {
  defaultUser: 'root',
  defaultSshPort: 22,
  defaultAuth: 'agent',
  defaultRemoteHost: '127.0.0.1',
  openBrowser: true,
  defaultSort: 'recent',
  vault: {
    enabled: false,
    touchId: false,
  },
};
