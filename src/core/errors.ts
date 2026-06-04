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

/** Thrown when the user force-quits a prompt (Ctrl+C). */
export class PromptAbortError extends WizardError {
  constructor() {
    super(tr.errors.cancelled, 130);
    this.name = 'PromptAbortError';
  }
}

/** Thrown when the user presses Esc to back out of a value-edit prompt — a softer
 *  "cancel this edit" than Ctrl+C. Subclasses PromptAbortError so every existing
 *  abort catch already treats Esc as "cancelled / go back"; editing menus may
 *  catch it specifically to stay on their own screen instead of unwinding. */
export class PromptCancelError extends PromptAbortError {
  constructor() {
    super();
    this.name = 'PromptCancelError';
  }
}

/** The encrypted vault could not be unlocked (wrong passphrase / declined). */
export class VaultLockedError extends WizardError {
  constructor(message = tr.errors.vaultLocked) {
    super(message, 1);
    this.name = 'VaultLockedError';
  }
}
