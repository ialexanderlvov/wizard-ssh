const ru = {
  exportedTo: (target: string) => `Экспортировано в ${target}`,
  exportSummary: (servers: number, tunnels: number, vault: boolean) =>
    `Серверов: ${servers} · туннелей: ${tunnels}${vault ? ' · хранилище включено (зашифровано)' : ''}`,
  fileNotFound: (abs: string) => `Файл не найден: ${abs}`,
  notExportFile: 'Это не файл экспорта wizard-ssh.',
  howToImport: 'Как импортировать?',
  choiceAdd: '➕ Добавить к существующим (безопасно)',
  choiceReplace: '♻️ Заменить туннели; серверы — обновить в ~/.ssh/config',
  skippedRecords: (skipped: number) =>
    `Пропущено небезопасных/некорректных записей: ${skipped} (недопустимые символы в host/user/alias/ключе).`,
  vaultRestored: 'Хранилище паролей восстановлено (нужна та же парольная фраза).',
  vaultBadFormat: 'Хранилище в файле импорта имеет неверный формат или параметры KDF — пропущено.',
  vaultExists:
    'Локальное хранилище уже есть — оно не перезаписано. Перенесите vault.json вручную при необходимости.',
  importDone: (mode: string, servers: number, tunnels: number) =>
    `Импорт завершён (${mode}): серверов +${servers}, туннелей +${tunnels}.`,
  importModeReplace: 'туннели заменены, серверы обновлены',
  importModeAdd: 'добавление',
  ensureInteractive: 'Экспорт/импорт',
  menuTitle: '📦 Экспорт / импорт',
  choiceExport: '📤 Экспортировать всё в файл',
  choiceImport: '📥 Импортировать из файла',
  choiceBack: '↩ Назад',
  exportPathPrompt: 'Путь файла (Enter — по умолчанию)',
  importPathPrompt: 'Путь к файлу экспорта',
  specifyPath: 'Укажите путь',
};

export default ru;
export type Dict = typeof ru;
