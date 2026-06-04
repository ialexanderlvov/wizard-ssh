/** Cross-cutting command helpers: vault unlock/setup, password resolution at
 *  connect-time, and fuzzy entity pickers/resolvers. */

import fs from 'node:fs';
import type { ConnectionTarget, Entity } from '../core/types.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import { destination } from '../ssh/args.js';
import { capture } from '../utils/exec.js';
import { filterEntities } from '../search/index.js';
import * as ui from '../ui/index.js';

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
    ui.printWarn(
      'Парольная фраза получена из WSSH_VAULT_PASSPHRASE_CMD (sh -c). Доверяйте окружению.',
    );
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
  ui.ensureInteractive('Настройка хранилища паролей');
  ui.printSection('🔐', 'Хранилище паролей');
  ui.printInfo('Пароли шифруются AES-256-GCM. Парольную фразу вводите один раз за сессию.');
  const p1 = await ui.secret({
    message: '🔑 Придумайте парольную фразу хранилища',
    validate: (v) => v.length >= 4 || 'Минимум 4 символа',
  });
  const p2 = await ui.secret({ message: '🔑 Повторите парольную фразу' });
  if (p1 !== p2) {
    ui.printError('Парольные фразы не совпадают.');
    return false;
  }
  let touchId = false;
  if (vault.touchIdSupported()) {
    touchId = await ui.confirm({
      message: '👆 Включить разблокировку по Touch ID (macOS)?',
      default: true,
    });
  }
  vault.setup(p1, { enableTouchId: touchId });
  settings.update({ vault: { enabled: true, touchId: touchId && vault.isTouchIdEnabled() } });
  ui.printOk('Хранилище создано.');
  return true;
}

/** Unlock the vault for this session (Touch ID first, then passphrase). The
 *  passphrase comes from the environment when set (unattended runs), otherwise
 *  from an interactive prompt. */
export async function unlockVault(): Promise<boolean> {
  if (!vault.exists()) return false;
  if (vault.isUnlocked()) return true;
  let envTried = false;
  return vault.unlock({
    allowTouchId: settings.get().vault.touchId,
    promptPassphrase: async () => {
      // Try an env-provided passphrase once; if it's wrong, don't loop on it.
      if (!envTried) {
        envTried = true;
        const env = resolveVaultPassphrase();
        if (env != null) return env;
      }
      ui.ensureInteractive('Ввод парольной фразы хранилища');
      return ui.secret({
        message: '🔑 Парольная фраза хранилища',
        validate: (v) => v.length > 0 || 'Не может быть пустым',
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
      ui.printWarn('Сохранённый пароль не найден — введите вручную.');
    }
  }
  ui.ensureInteractive('Ввод пароля');
  return ui.secret({
    message: `🔒 Пароль SSH для ${destination(t)}`,
    validate: (v) => v.length > 0 || 'Не может быть пустым',
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
    message: '💾 Сохранить пароль в зашифрованном хранилище?',
    default: Boolean(prevSecretId),
  });
  if (!save) return null;
  if (!(await ensureVaultSetup())) return prevSecretId;
  if (!(await unlockVault())) {
    ui.printWarn('Хранилище не разблокировано — пароль не сохранён.');
    return prevSecretId;
  }
  const pw = await ui.secret({
    message: '🔒 Пароль SSH (будет зашифрован)',
    validate: (v) => v.length > 0 || 'Не может быть пустым',
  });
  const id = vault.setSecret(pw); // a fresh blob; the previous one lives until commit
  ui.printOk('Пароль сохранён в хранилище.');
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
    ui.printWarn('Список пуст.');
    return null;
  }
  ui.ensureInteractive('Выбор из списка');
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
    ui.printError(`«${name}» не найдено.`);
    return items.length ? pickEntity(items, message) : null;
  }
  ui.printInfo(`Несколько совпадений по «${name}»:`);
  return pickEntity(hits, message);
}
