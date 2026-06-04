import type { Dict } from './ru.js';

const en: Dict = {
  exportedTo: (target) => `Exported to ${target}`,
  exportSummary: (servers, tunnels, vault) =>
    `Servers: ${servers} · tunnels: ${tunnels}${vault ? ' · vault included (encrypted)' : ''}`,
  fileNotFound: (abs) => `File not found: ${abs}`,
  notExportFile: 'This is not a wizard-ssh export file.',
  howToImport: 'How to import?',
  choiceAdd: '➕ Add to existing (safe)',
  choiceReplace: '♻️ Replace tunnels; servers — update in ~/.ssh/config',
  skippedRecords: (skipped) =>
    `Skipped unsafe/invalid records: ${skipped} (invalid characters in host/user/alias/key).`,
  vaultRestored: 'Password vault restored (requires the same passphrase).',
  vaultBadFormat: 'Vault in the import file has an invalid format or KDF parameters — skipped.',
  vaultExists:
    'A local vault already exists — it was not overwritten. Transfer vault.json manually if needed.',
  importDone: (mode, servers, tunnels) =>
    `Import complete (${mode}): servers +${servers}, tunnels +${tunnels}.`,
  importModeReplace: 'tunnels replaced, servers updated',
  importModeAdd: 'add',
  ensureInteractive: 'Export/import',
  menuTitle: '📦 Export / import',
  choiceExport: '📤 Export everything to a file',
  choiceImport: '📥 Import from a file',
  choiceBack: '↩ Back',
  exportPathPrompt: 'File path (Enter — default)',
  importPathPrompt: 'Path to the export file',
  specifyPath: 'Specify a path',
};

export default en;
