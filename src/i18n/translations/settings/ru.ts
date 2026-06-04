const ru = {
  // editSetting prompts
  defaultUserPrompt: 'SSH-пользователь по умолчанию',
  defaultSshPortPrompt: 'SSH-порт по умолчанию',
  defaultAuthPrompt: 'Метод авторизации по умолчанию',
  authAgent: 'ssh-agent / по умолчанию',
  authKey: 'SSH-ключ',
  authPassword: 'Пароль',
  defaultRemoteHostPrompt: 'Удалённый хост сервиса по умолчанию',
  openBrowserPrompt: 'Открывать браузер при local-пробросе?',
  tunnelAutoReconnectPrompt: 'Авто-переподключение туннелей при обрыве (до Ctrl+C)?',
  defaultSortPrompt: 'Сортировка списков по умолчанию',
  sortRecent: 'Последнему использованию',
  sortName: 'Имени',
  sortUses: 'Числу подключений',
  sortCreated: 'Дате создания',
  sortUpdated: 'Дате изменения',
  saved: 'Сохранено.',

  // settingsFlow labels
  labelDefaultUser: (v: string) => `SSH-пользователь: ${v}`,
  labelDefaultSshPort: (v: string) => `SSH-порт: ${v}`,
  labelDefaultAuth: (v: string) => `Авторизация: ${v}`,
  labelDefaultRemoteHost: (v: string) => `Удалённый хост: ${v}`,
  labelOpenBrowser: (v: string) => `Открывать браузер: ${v}`,
  labelTunnelAutoReconnect: (v: string) => `Авто-reconnect туннелей: ${v}`,
  labelDefaultSort: (v: string) => `Сортировка списков: ${v}`,
  labelLanguage: (v: string) => `Язык интерфейса: ${v}`,
  languagePrompt: 'Язык интерфейса',
  langSystem: 'Системный (по окружению / ОС)',
  langRu: 'Русский',
  langEn: 'English',
  sortLabelRecent: 'по использованию',
  sortLabelName: 'по имени',
  sortLabelUses: 'по подключениям',
  sortLabelCreated: 'по дате создания',
  sortLabelUpdated: 'по дате изменения',
  settingsTitle: 'Настройки',
  settingsMenuPrompt: 'Настройки (Enter — изменить, Esc — назад)',
  ensureSettings: 'Настройки',

  // vaultStatus
  vaultSection: 'Хранилище паролей',
  vaultStateCreated: 'создано',
  vaultStateNotCreated: 'не создано',
  vaultStateUnlocked: 'разблокировано',
  vaultStateLocked: 'заблокировано',
  vaultSecretsCount: (n: number) => `секретов: ${n}`,
  vaultStatusLine: (state: string, lockState: string, secrets: string) =>
    `Состояние: ${state} · ${lockState} · ${secrets}`,
  touchIdLine: (state: string, note: string) => `Touch ID: ${state}${note}`,
  touchIdEnabled: 'включён',
  touchIdDisabled: 'выключен',
  touchIdUnavailable: '  (недоступен: нужен macOS + Xcode CLT)',

  // secretHolders (server/tunnel reuse tr.common; only temp-tunnel needs its own)
  kindLabelTempTunnel: 'врем. туннель',

  // pickSecretHolder
  noSavedPasswords: 'Нет сохранённых паролей.',

  // revealSavedPassword (cancelled reuses tr.common.cancelled)
  pickRevealPrompt: 'У какого подключения показать пароль?',
  confirmReveal: (name: string) => `Показать пароль для «${name}» на экране?`,
  vaultNotUnlockedReveal: 'Хранилище не разблокировано — пароль не показан.',
  secretNotFound: 'Сохранённый пароль не найден.',
  revealHeader: (name: string) => `Пароль для «${name}»:`,
  revealHint: 'Скроется при возврате в меню.',
  revealCopied: (name: string, tool: string) =>
    `Пароль «${name}» скопирован в буфер обмена (${tool}).`,
  revealCopiedHint: 'Буфер перезапишется при следующем копировании.',
  revealStdoutWarning:
    'Буфер обмена недоступен — печатаю на экран. Очистите прокрутку терминала после.',

  // deleteSavedPassword
  pickDeletePrompt: 'У какого подключения удалить сохранённый пароль?',
  passwordDeleted: (name: string) =>
    `Пароль для «${name}» удалён (данные сохранены, спросим при подключении).`,

  // resetVault (cancelled reuses tr.common.cancelled)
  confirmReset:
    'Сбросить хранилище? Все сохранённые пароли будут удалены (серверы/туннели останутся).',
  resetDone: 'Хранилище сброшено. Можно создать новое с новой парольной фразой.',

  // vaultFlow menu labels & messages
  ensureVault: 'Управление хранилищем',
  vaultMenuPrompt: 'Действие',
  vaultCrumb: 'Хранилище паролей',
  actionSetup: 'Создать хранилище',
  actionUnlock: 'Разблокировать',
  actionLock: 'Заблокировать (сбросить сессию)',
  actionRekey: 'Сменить парольную фразу',
  actionRevealSecret: 'Показать сохранённый пароль',
  actionRevealSecretCount: (n: number) => `Показать сохранённый пароль (${n})`,
  actionDeleteSecret: 'Удалить сохранённый пароль',
  actionEnableTouch: 'Включить Touch ID',
  actionDisableTouch: 'Выключить Touch ID',
  actionReset: 'Сбросить хранилище (забыл фразу)',
  unlocked: 'Разблокировано.',
  unlockFailed: 'Не удалось разблокировать.',
  sessionCleared: 'Сессия сброшена.',
  needUnlockFirst: 'Сначала нужно разблокировать.',
  rekeyNewPassphrase: 'Новая парольная фраза',
  rekeyMinLength: 'Минимум 4 символа',
  rekeyRepeat: 'Повторите',
  rekeyMismatch: 'Не совпадают.',
  rekeyDone: 'Парольная фраза изменена.',
  needUnlockTouch: 'Сначала разблокируйте.',
  touchIdOn: 'Touch ID включён.',
  touchIdOnFailed: 'Не удалось включить Touch ID.',
  touchIdOff: 'Touch ID выключен.',
};

export default ru;
export type Dict = typeof ru;
