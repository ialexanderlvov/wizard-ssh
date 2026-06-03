/** Cross-cutting command helpers: vault unlock/setup, password resolution at
 *  connect-time, and fuzzy entity pickers/resolvers. */

import type { ConnectionTarget, Entity } from '../core/types.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import { destination } from '../ssh/args.js';
import { filterEntities } from '../search/index.js';
import * as ui from '../ui/index.js';
import { entityLine } from '../ui/format.js';

// ---------- vault ----------

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

/** Unlock the vault for this session (Touch ID first, then passphrase). */
export async function unlockVault(): Promise<boolean> {
  if (!vault.exists()) return false;
  if (vault.isUnlocked()) return true;
  return vault.unlock({
    allowTouchId: settings.get().vault.touchId,
    promptPassphrase: async () => {
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
 *  Returns the secretId to store on the entity (or null). */
export async function handlePasswordSecret(
  target: ConnectionTarget,
  prevSecretId: string | null,
): Promise<string | null> {
  if (target.auth !== 'password') {
    if (prevSecretId) vault.removeSecret(prevSecretId);
    return null;
  }
  const save = await ui.confirm({
    message: '💾 Сохранить пароль в зашифрованном хранилище?',
    default: Boolean(prevSecretId),
  });
  if (!save) {
    if (prevSecretId) vault.removeSecret(prevSecretId);
    return null;
  }
  if (!(await ensureVaultSetup())) return prevSecretId;
  if (!(await unlockVault())) {
    ui.printWarn('Хранилище не разблокировано — пароль не сохранён.');
    return prevSecretId;
  }
  const pw = await ui.secret({
    message: '🔒 Пароль SSH (будет зашифрован)',
    validate: (v) => v.length > 0 || 'Не может быть пустым',
  });
  const id = vault.setSecret(pw, prevSecretId ?? undefined);
  ui.printOk('Пароль сохранён в хранилище.');
  return id;
}

// ---------- entity selection ----------

/** Fuzzy autocomplete picker over a list of entities. */
export async function pickEntity<T extends Entity>(items: T[], message: string): Promise<T | null> {
  if (!items.length) {
    ui.printWarn('Список пуст.');
    return null;
  }
  ui.ensureInteractive('Выбор из списка');
  const id = await ui.searchChoose<string>({
    message,
    source: (term) =>
      filterEntities(items, term).map((e) => ({ name: entityLine(e), value: e.id })),
  });
  return items.find((e) => e.id === id) ?? null;
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
