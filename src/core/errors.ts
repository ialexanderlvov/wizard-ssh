/** Typed errors so the CLI top-level can render them nicely and pick exit codes. */

export class WizardError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'WizardError';
    this.exitCode = exitCode;
  }
}

/** Thrown when an interactive prompt is needed but there is no TTY. */
export class NotInteractiveError extends WizardError {
  constructor(what = 'Эта операция') {
    super(
      `${what} требует интерактивный терминал. Используйте флаги команды или запустите в TTY.`,
      1,
    );
    this.name = 'NotInteractiveError';
  }
}

/** Thrown when the user cancels a prompt (Ctrl+C / ESC). */
export class PromptAbortError extends WizardError {
  constructor() {
    super('Отменено.', 130);
    this.name = 'PromptAbortError';
  }
}

/** The encrypted vault could not be unlocked (wrong passphrase / declined). */
export class VaultLockedError extends WizardError {
  constructor(message = 'Хранилище паролей не разблокировано.') {
    super(message, 1);
    this.name = 'VaultLockedError';
  }
}
