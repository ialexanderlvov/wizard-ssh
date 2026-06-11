const ru = {
  vaultCmdWarning:
    'Парольная фраза получена из WSSH_VAULT_PASSPHRASE_CMD (sh -c). Доверяйте окружению.',
  setupEnsure: 'Настройка хранилища паролей',
  setupSection: 'Хранилище паролей',
  setupIntro: 'Пароли шифруются AES-256-GCM. Парольную фразу вводите один раз за сессию.',
  newPassphrase: '🔑 Придумайте парольную фразу хранилища',
  minChars:
    'Минимум 12 символов (зашифрованное хранилище попадает в экспорт — короткую фразу можно подобрать офлайн)',
  repeatPassphrase: '🔑 Повторите парольную фразу',
  passphraseMismatch: 'Парольные фразы не совпадают.',
  touchIdNote:
    'Примечание: Touch ID — это удобный экран внутри CLI, а не аппаратная защита. Ключ хранится в Keychain и доступен любому процессу под вашим пользователем без Touch ID; корнем доверия остаётся парольная фраза.',
  keyringNote:
    'Примечание: keyring разблокируется вместе с сессией входа, поэтому ключ доступен любому процессу под вашим пользователем. Это удобство, а не защита; корнем доверия остаётся парольная фраза.',
  enableTouchId: (name: string) => `👆 Включить разблокировку через ${name}?`,
  vaultCreated: 'Хранилище создано.',
  unlockMethod: 'Как разблокировать хранилище?',
  unlockWithTouchId: (name: string) => `👆 ${name}`,
  unlockWithPassphrase: '🔑 Парольная фраза',
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
  resolvedFuzzy: (q: string, name: string) => `По «${q}» выбрано: ${name}`,
};

export default ru;
export type Dict = typeof ru;
