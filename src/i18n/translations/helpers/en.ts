import type { Dict } from './ru.js';

const en: Dict = {
  vaultCmdWarning:
    'Passphrase obtained from WSSH_VAULT_PASSPHRASE_CMD (sh -c). Trust your environment.',
  setupEnsure: 'Password vault setup',
  setupSection: 'Password vault',
  setupIntro: 'Passwords are encrypted with AES-256-GCM. Enter the passphrase once per session.',
  newPassphrase: '🔑 Choose a vault passphrase',
  minChars: 'At least 4 characters',
  repeatPassphrase: '🔑 Repeat the passphrase',
  passphraseMismatch: 'Passphrases do not match.',
  touchIdNote:
    'Note: Touch ID is a convenience prompt inside the CLI, not hardware-enforced protection. The key is kept in the Keychain and readable by any process running as you without Touch ID; the passphrase stays the root of trust.',
  enableTouchId: '👆 Enable Touch ID unlock (macOS)?',
  vaultCreated: 'Vault created.',
  unlockMethod: 'How to unlock the vault?',
  unlockWithTouchId: '👆 Touch ID',
  unlockWithPassphrase: '🔑 Passphrase',
  unlockEnsure: 'Vault passphrase entry',
  passphrasePrompt: '🔑 Vault passphrase',
  savedPwNotFound: 'Saved password not found — enter it manually.',
  enterPwEnsure: 'Password entry',
  sshPasswordFor: (dest) => `🔒 SSH password for ${dest}`,
  savePwQuestion: '💾 Save the password in the encrypted vault?',
  vaultNotUnlocked: 'Vault is locked — password not saved.',
  sshPasswordEncrypted: '🔒 SSH password (will be encrypted)',
  pwSaved: 'Password saved to the vault.',
  pickEnsure: 'Selecting from a list',
  notFound: (q) => `“${q}” not found.`,
  multipleMatches: (q) => `Several matches for “${q}”:`,
};

export default en;
