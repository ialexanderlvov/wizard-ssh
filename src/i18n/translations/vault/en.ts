import type { Dict } from './ru.js';

const en: Dict = {
  touchidReason: 'unlock wizard-ssh passwords',
  wrongPassphrase: (attempt) => `Wrong passphrase (attempt ${attempt}/3).`,
  rekeyDecryptFailed:
    'Failed to decrypt part of the vault (corrupted?). Passphrase change aborted.',
  writerUnsafeChar: (label) => `Unsafe character (newline/control) in ${label}.`,
  writerAliasLabel: 'host alias',
  writerParamLabel: (key) => `parameter ${key}`,
  writerValueLabel: (key) => `value of ${key}`,
  writerAliasEmpty: 'Alias cannot be empty.',
  jsonfileBackupFailed: '(could not create backup)',
};

export default en;
