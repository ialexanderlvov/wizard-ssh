import type { Dict } from './ru.js';

const en: Dict = {
  bannerSubtitle: 'Servers · tunnels · ~/.ssh/config — CRUD, search and instant connect.',
  programDescription:
    'Wizard SSH — servers, tunnels and ~/.ssh/config: CRUD, search, instant connect.',
  versionDescription: 'show version',
  helpDescription: 'show help',
  helpAfter: (dataDir) => `\nNo arguments — interactive menu.\nData: ${dataDir}`,
  importedFromOldVersion: (count) => `Imported from the previous version: tunnels — ${count}.`,
  serversMigrated: (count, backup) =>
    `Servers moved to ~/.ssh/config: ${count}. servers.json → servers.json.migrated.` +
    (backup ? ` Config backup: ${backup}` : ''),
};

export default en;
