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
  writerInvalidAlias: (alias) =>
    `Invalid host alias "${alias}": only letters, digits, dot, dash and underscore are allowed.`,
  writerAliasInInclude: (alias) =>
    `Alias "${alias}" already exists in an Included or unmanaged ~/.ssh/config block — skipped to avoid a duplicate block.`,
  jsonfileBackupFailed: '(could not create backup)',
};

export default en;
