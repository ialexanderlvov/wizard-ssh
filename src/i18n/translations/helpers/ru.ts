const ru = {
  vaultCmdWarning:
    'Парольная фраза получена из WSSH_VAULT_PASSPHRASE_CMD (sh -c). Доверяйте окружению.',
  setupEnsure: 'Настройка хранилища паролей',
  setupSection: 'Хранилище паролей',
  setupIntro: 'Пароли шифруются AES-256-GCM. Парольную фразу вводите один раз за сессию.',
  newPassphrase: '🔑 Придумайте парольную фразу хранилища',
  minChars: 'Минимум 4 символа',
  repeatPassphrase: '🔑 Повторите парольную фразу',
  passphraseMismatch: 'Парольные фразы не совпадают.',
  enableTouchId: '👆 Включить разблокировку по Touch ID (macOS)?',
  vaultCreated: 'Хранилище создано.',
  unlockEnsure: 'Ввод парольной фразы хранилища',
  passphrasePrompt: '🔑 Парольная фраза хранилища',
  savedPwNotFound: 'Сохранённый пароль не найден — введите вручную.',
  enterPwEnsure: 'Ввод пароля',
  sshPasswordFor: (dest: string) => `🔒 Пароль SSH для ${dest}`,
  savePwQuestion: '💾 Сохранить пароль в зашифрованном хранилище?',
  vaultNotUnlocked: 'Хранилище не разблокировано — пароль не сохранён.',
  sshPasswordEncrypted: '🔒 Пароль SSH (будет зашифрован)',
  pwSaved: 'Пароль сохранён в хранилище.',
  pickEnsure: 'Выбор из списка',
  notFound: (q: string) => `«${q}» не найдено.`,
  multipleMatches: (q: string) => `Несколько совпадений по «${q}»:`,
};

export default ru;
export type Dict = typeof ru;
