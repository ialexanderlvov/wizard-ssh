const ru = {
  notInteractiveSubject: 'Эта операция',
  notInteractive: (what: string) =>
    `${what} требует интерактивный терминал. Используйте флаги команды или запустите в TTY.`,
  cancelled: 'Отменено.',
  vaultLocked: 'Хранилище паролей не разблокировано.',
  unexpected: (detail: string) => `Неожиданная ошибка: ${detail}`,
};

export default ru;
export type Dict = typeof ru;
