const ru = {
  bannerSubtitle: 'Серверы · туннели · ~/.ssh/config — CRUD, поиск и мгновенное подключение.',
  programDescription:
    'Wizard SSH — серверы, туннели и ~/.ssh/config: CRUD, поиск, мгновенное подключение.',
  versionDescription: 'показать версию',
  helpDescription: 'показать помощь',
  helpAfter: (dataDir: string) => `\nБез аргументов — интерактивное меню.\nДанные: ${dataDir}`,
  importedFromOldVersion: (count: number) =>
    `Импортировано из прежней версии: туннелей — ${count}.`,
  serversMigrated: (count: number, backup: string) =>
    `Серверы перенесены в ~/.ssh/config: ${count}. servers.json → servers.json.migrated.` +
    (backup ? ` Бэкап конфига: ${backup}` : ''),
};

export default ru;
export type Dict = typeof ru;
