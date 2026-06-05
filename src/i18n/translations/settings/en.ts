import type { Dict } from './ru.js';

const en: Dict = {
  // editSetting prompts
  defaultUserPrompt: 'Default SSH user',
  defaultSshPortPrompt: 'Default SSH port',
  defaultAuthPrompt: 'Default auth method',
  authAgent: 'ssh-agent / default',
  authKey: 'SSH key',
  authPassword: 'Password',
  defaultRemoteHostPrompt: 'Default remote service host',
  openBrowserPrompt: 'Open browser on local port-forward?',
  tunnelAutoReconnectPrompt: 'Auto-reconnect tunnels on drop (until Ctrl+C)?',
  defaultSortPrompt: 'Default list sort',
  sortRecent: 'Last used',
  sortName: 'Name',
  sortUses: 'Connection count',
  sortCreated: 'Created date',
  sortUpdated: 'Updated date',
  saved: 'Saved.',

  // settingsFlow labels
  labelDefaultUser: (v) => `SSH user: ${v}`,
  labelDefaultSshPort: (v) => `SSH port: ${v}`,
  labelDefaultAuth: (v) => `Auth: ${v}`,
  labelDefaultRemoteHost: (v) => `Remote host: ${v}`,
  labelOpenBrowser: (v) => `Open browser: ${v}`,
  labelTunnelAutoReconnect: (v) => `Auto-reconnect tunnels: ${v}`,
  labelDefaultSort: (v) => `List sort: ${v}`,
  labelLanguage: (v) => `UI language: ${v}`,
  languagePrompt: 'UI language',
  labelTransferTool: (v) => `Transfer: default tool: ${v}`,
  transferToolPrompt: 'Default transfer tool',
  labelTransferRecursive: (v) => `Transfer (scp): recursive: ${v}`,
  transferRecursivePrompt: '📁 scp: recursive (folders) by default?',
  labelTransferCompress: (v) => `Transfer (rsync): compress -z: ${v}`,
  transferCompressPrompt: '🗜 rsync: compress in transit (-z) by default?',
  labelTransferDelete: (v) => `Transfer (rsync): --delete: ${v}`,
  transferDeletePrompt: '🧹 rsync: delete extraneous on the receiver (--delete) by default?',
  langSystem: 'System (env / OS)',
  langRu: 'Русский',
  langEn: 'English',
  sortLabelRecent: 'by recent use',
  sortLabelName: 'by name',
  sortLabelUses: 'by connections',
  sortLabelCreated: 'by created date',
  sortLabelUpdated: 'by updated date',
  settingsTitle: 'Settings',
  settingsMenuPrompt: 'Settings (Enter — edit, Esc — back)',
  ensureSettings: 'Settings',

  // vaultStatus
  vaultSection: 'Password vault',
  vaultStateCreated: 'created',
  vaultStateNotCreated: 'not created',
  vaultStateUnlocked: 'unlocked',
  vaultStateLocked: 'locked',
  vaultSecretsCount: (n) => `secrets: ${n}`,
  vaultStatusLine: (state, lockState, secrets) => `Status: ${state} · ${lockState} · ${secrets}`,
  touchIdLine: (state, note) => `Touch ID: ${state}${note}`,
  touchIdEnabled: 'enabled',
  touchIdDisabled: 'disabled',
  touchIdUnavailable: '  (unavailable: requires macOS + Xcode CLT)',

  // secretHolders (server/tunnel reuse tr.common; only temp-tunnel needs its own)
  kindLabelTempTunnel: 'temp tunnel',

  // pickSecretHolder
  noSavedPasswords: 'No saved passwords.',

  // revealSavedPassword (cancelled reuses tr.common.cancelled)
  pickRevealPrompt: 'Which connection to show the password for?',
  confirmReveal: (name) => `Show password for "${name}" on screen?`,
  vaultNotUnlockedReveal: 'Vault not unlocked — password not shown.',
  secretNotFound: 'Saved password not found.',
  revealHeader: (name) => `Password for "${name}":`,
  revealHint: 'Will hide when you return to the menu.',
  revealCopied: (name, tool) => `Password for “${name}” copied to clipboard (${tool}).`,
  revealCopiedHint: 'The clipboard will be overwritten by your next copy.',
  revealStdoutWarning:
    'Clipboard unavailable — printing to screen. Clear your terminal scrollback afterwards.',

  // deleteSavedPassword
  pickDeletePrompt: 'Which connection to delete the saved password for?',
  passwordDeleted: (name) =>
    `Password for "${name}" deleted (data kept; will ask on next connect).`,

  // resetVault (cancelled reuses tr.common.cancelled)
  confirmReset: 'Reset vault? All saved passwords will be deleted (servers/tunnels kept).',
  resetDone: 'Vault reset. You can create a new one with a new passphrase.',

  // vaultFlow menu labels & messages
  ensureVault: 'Vault management',
  vaultMenuPrompt: 'Action',
  vaultCrumb: 'Password vault',
  actionSetup: 'Create vault',
  actionUnlock: 'Unlock',
  actionLock: 'Lock (clear session)',
  actionRekey: 'Change passphrase',
  actionRevealSecret: 'Show saved password',
  actionRevealSecretCount: (n) => `Show saved password (${n})`,
  actionDeleteSecret: 'Delete saved password',
  actionEnableTouch: 'Enable Touch ID',
  actionDisableTouch: 'Disable Touch ID',
  actionReset: 'Reset vault (forgot passphrase)',
  unlocked: 'Unlocked.',
  unlockFailed: 'Could not unlock.',
  sessionCleared: 'Session cleared.',
  needUnlockFirst: 'Unlock first.',
  rekeyNewPassphrase: 'New passphrase',
  rekeyMinLength: 'Minimum 4 characters',
  rekeyRepeat: 'Repeat',
  rekeyMismatch: 'Passphrases do not match.',
  rekeyDone: 'Passphrase changed.',
  needUnlockTouch: 'Unlock first.',
  touchIdOn: 'Touch ID enabled.',
  touchIdOnFailed: 'Could not enable Touch ID.',
  touchIdOff: 'Touch ID disabled.',
};

export default en;
