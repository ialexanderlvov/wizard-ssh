/** Cross-cutting command helpers: vault unlock/setup, password resolution at
 *  connect-time, and fuzzy entity pickers/resolvers. */

import fs from 'node:fs';
import type { ConnectionTarget, Entity } from '../core/types.js';
import { PromptCancelError } from '../core/errors.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import { destination } from '../ssh/args.js';
import { capture } from '../utils/exec.js';
import { filterEntities } from '../search/index.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

// ---------- vault ----------

/** Resolve the vault passphrase from the environment, for unattended/scripted
 *  runs (no TTY). Precedence: WSSH_VAULT_PASSPHRASE → *_FILE → *_CMD. Returns
 *  null when none is set, so callers fall back to an interactive prompt. */
export function resolveVaultPassphrase(): string | null {
  const direct = process.env.WSSH_VAULT_PASSPHRASE;
  if (direct != null && direct !== '') return direct;

  const file = process.env.WSSH_VAULT_PASSPHRASE_FILE;
  if (file) {
    try {
      const v = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
      if (v) return v;
    } catch {
      /* fall through */
    }
  }

  const cmd = process.env.WSSH_VAULT_PASSPHRASE_CMD;
  // Executed via `sh -c`, so a hijacked environment would run arbitrary shell
  // code. Honor it ONLY in a truly non-interactive run (its documented purpose),
  // never silently mid-session in an interactive terminal, and warn when it does
  // fire so a poisoned env is detectable.
  if (cmd && !ui.isInteractive()) {
    ui.printWarn(tr.helpers.vaultCmdWarning);
    const res = capture('sh', ['-c', cmd]);
    if (res.status === 0) {
      const v = res.stdout.replace(/\r?\n$/, '');
      if (v) return v;
    }
  }
  return null;
}

export function vaultSupportsTouchId(): boolean {
  return vault.touchIdSupported();
}

/** Create the vault on first use (passphrase + optional Touch ID). */
export async function ensureVaultSetup(): Promise<boolean> {
  if (vault.exists()) return true;
  ui.ensureInteractive(tr.helpers.setupEnsure);
  ui.printSection('🔐', tr.helpers.setupSection);
  ui.printInfo(tr.helpers.setupIntro);
  const p1 = await ui.secret({
    message: tr.helpers.newPassphrase,
    validate: (v) => v.length >= 4 || tr.helpers.minChars,
  });
  const p2 = await ui.secret({ message: tr.helpers.repeatPassphrase });
  if (p1 !== p2) {
    ui.printError(tr.helpers.passphraseMismatch);
    return false;
  }
  let touchId = false;
  if (vault.touchIdSupported()) {
    // Be honest about the trade-off: enabling Touch ID adds a same-user-readable
    // copy of the master key to the Keychain, so the user decides on a true model.
    ui.printInfo(tr.helpers.touchIdNote);
    touchId = await ui.confirm({
      message: tr.helpers.enableTouchId,
      default: true,
    });
  }
  vault.setup(p1, { enableTouchId: touchId });
  settings.update({ vault: { enabled: true, touchId: touchId && vault.isTouchIdEnabled() } });
  ui.printOk(tr.helpers.vaultCreated);
  return true;
}

/** Unlock the vault for this session with EITHER Touch ID or the passphrase.
 *  When Touch ID is enabled + available in an interactive session, the user picks
 *  the method up front (default Touch ID) so neither is the only way in — and
 *  choosing Touch ID still falls back to the passphrase if biometrics fail. A
 *  scripted run (env passphrase) skips the prompt and biometrics and uses the
 *  passphrase directly; when Touch ID is off, it's the passphrase as before. */
export async function unlockVault(): Promise<boolean> {
  if (!vault.exists()) return false;
  if (vault.isUnlocked()) return true;

  const env = resolveVaultPassphrase();
  // Touch ID is usable only when it was enabled (the key is in the Keychain) and
  // is supported here. A scripted passphrase takes precedence (no biometric prompt
  // in unattended runs).
  let allowTouchId = env == null && vault.isTouchIdEnabled() && vault.touchIdSupported();
  if (allowTouchId && ui.isInteractive()) {
    try {
      const method = await ui.choose<'touchid' | 'passphrase'>({
        message: tr.helpers.unlockMethod,
        choices: [
          { name: tr.helpers.unlockWithTouchId, value: 'touchid' },
          { name: tr.helpers.unlockWithPassphrase, value: 'passphrase' },
        ],
        default: 'touchid',
      });
      allowTouchId = method === 'touchid';
    } catch (e) {
      if (e instanceof PromptCancelError) return false; // Esc on the chooser → cancel
      throw e;
    }
  }

  let envTried = false;
  return vault.unlock({
    allowTouchId,
    promptPassphrase: async () => {
      // Try the env-provided passphrase once; if it's wrong, don't loop on it.
      if (!envTried) {
        envTried = true;
        if (env != null) return env;
      }
      ui.ensureInteractive(tr.helpers.unlockEnsure);
      return ui.secret({
        message: tr.helpers.passphrasePrompt,
        validate: (v) => v.length > 0 || tr.common.notEmpty,
      });
    },
    onError: ui.printWarn,
  });
}

/** Resolve a password for a connect: saved-in-vault → decrypt; else prompt. */
export async function resolvePassword(t: ConnectionTarget): Promise<string | undefined> {
  if (t.auth !== 'password') return undefined;
  if (t.secretId && vault.exists()) {
    if (await unlockVault()) {
      const pw = vault.getSecret(t.secretId);
      if (pw != null) return pw;
      ui.printWarn(tr.helpers.savedPwNotFound);
    }
  }
  ui.ensureInteractive(tr.helpers.enterPwEnsure);
  return ui.secret({
    message: tr.helpers.sshPasswordFor(destination(t)),
    validate: (v) => v.length > 0 || tr.common.notEmpty,
  });
}

/** After building a target, decide whether to persist its password in the vault.
 *  Returns the secretId to store on the entity (or null).
 *
 *  IMPORTANT: this never mutates the *previous* secret. A fresh blob is minted
 *  for a newly entered password and the old one is left intact, so the caller
 *  can reconcile only when the edit/add actually persists — via
 *  {@link commitSecretChange} on save or {@link rollbackSecretChange} on cancel.
 *  That way aborting an edit can never leave a dangling secretId nor an orphan. */
export async function handlePasswordSecret(
  target: ConnectionTarget,
  prevSecretId: string | null,
): Promise<string | null> {
  if (target.auth !== 'password') return null;
  const save = await ui.confirm({
    message: tr.helpers.savePwQuestion,
    default: Boolean(prevSecretId),
  });
  if (!save) return null;
  if (!(await ensureVaultSetup())) return prevSecretId;
  if (!(await unlockVault())) {
    ui.printWarn(tr.helpers.vaultNotUnlocked);
    return prevSecretId;
  }
  const pw = await ui.secret({
    message: tr.helpers.sshPasswordEncrypted,
    validate: (v) => v.length > 0 || tr.common.notEmpty,
  });
  const id = vault.setSecret(pw); // a fresh blob; the previous one lives until commit
  ui.printOk(tr.helpers.pwSaved);
  return id;
}

/** Apply a pending secret change once an edit/add COMMITS: drop the superseded
 *  original blob now that the entity references a new (or no) secret. */
export function commitSecretChange(
  originalSecretId: string | null,
  newSecretId: string | null,
): void {
  if (originalSecretId && originalSecretId !== newSecretId) vault.removeSecret(originalSecretId);
}

/** Roll back a pending secret when an edit/add is CANCELLED or aborted: drop the
 *  freshly minted blob that won't be referenced, leaving the original intact. */
export function rollbackSecretChange(
  originalSecretId: string | null,
  pendingSecretId: string | null,
): void {
  if (pendingSecretId && pendingSecretId !== originalSecretId) vault.removeSecret(pendingSecretId);
}

// ---------- entity selection ----------

/** Interactive picker over a list of entities: filter, Tab-sort, Esc → back. */
export async function pickEntity<T extends Entity>(items: T[], message: string): Promise<T | null> {
  if (!items.length) {
    ui.printWarn(tr.common.listEmpty);
    return null;
  }
  ui.ensureInteractive(tr.helpers.pickEnsure);
  const render = ui.entityRowRenderer(items);
  const res = await ui.pickFromList<T>({
    message,
    items,
    render,
    search: ui.entitySearch,
    sorts: ui.ENTITY_SORTS as ReadonlyArray<ui.ListSort<T>>,
    pageSize: 12,
  });
  return res === ui.BACK ? null : res;
}

export interface ResolvableCollection<T extends Entity> {
  all(): T[];
  findByName(name: string): T | null;
}

/** Resolve an entity from a CLI name: exact → fuzzy → prompt. */
export async function resolveEntity<T extends Entity>(
  coll: ResolvableCollection<T>,
  name: string | undefined,
  message: string,
): Promise<T | null> {
  const items = coll.all();
  if (!name) return pickEntity(items, message);

  const exact = coll.findByName(name);
  if (exact) return exact;

  const hits = filterEntities(items, name);
  if (hits.length === 1) return hits[0] ?? null;
  if (!hits.length) {
    ui.printError(tr.helpers.notFound(name));
    return items.length ? pickEntity(items, message) : null;
  }
  ui.printInfo(tr.helpers.multipleMatches(name));
  return pickEntity(hits, message);
}
