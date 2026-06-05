const ru = {
  touchidReason: 'разблокировать пароли wizard-ssh',
  wrongPassphrase: (attempt: number) => `Неверная парольная фраза (попытка ${attempt}/3).`,
  rekeyDecryptFailed:
    'Не удалось расшифровать часть хранилища (повреждение?). Смена фразы отменена.',
  writerUnsafeChar: (label: string) =>
    `Недопустимый символ (перевод строки/управляющий) в ${label}.`,
  writerAliasLabel: 'алиасе хоста',
  writerParamLabel: (key: string) => `параметре ${key}`,
  writerValueLabel: (key: string) => `значении ${key}`,
  writerAliasEmpty: 'Алиас не может быть пустым.',
  writerInvalidAlias: (alias: string) =>
    `Недопустимый алиас хоста «${alias}»: разрешены только буквы, цифры, точка, дефис и подчёркивание.`,
  writerAliasInInclude: (alias: string) =>
    `Алиас «${alias}» уже определён во включённом (Include) или неуправляемом блоке ~/.ssh/config — пропущен, чтобы не создавать дубликат.`,
  jsonfileBackupFailed: '(резервную копию создать не удалось)',
};

export default ru;
export type Dict = typeof ru;
