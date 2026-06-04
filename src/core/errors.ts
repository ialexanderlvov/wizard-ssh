/** Typed errors so the CLI top-level can render them nicely and pick exit codes. */

import { tr } from '../i18n/index.js';

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
  constructor(what = tr.errors.notInteractiveSubject) {
    super(tr.errors.notInteractive(what), 1);
    this.name = 'NotInteractiveError';
  }
}

/** Thrown when the user cancels a prompt (Ctrl+C / ESC). */
export class PromptAbortError extends WizardError {
  constructor() {
    super(tr.errors.cancelled, 130);
    this.name = 'PromptAbortError';
  }
}

/** The encrypted vault could not be unlocked (wrong passphrase / declined). */
export class VaultLockedError extends WizardError {
  constructor(message = tr.errors.vaultLocked) {
    super(message, 1);
    this.name = 'VaultLockedError';
  }
}
