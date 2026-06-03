/** Default settings (as an editable menu) + password-vault management. */

import type { AuthMethod, Entity, SortKey } from '../core/types.js';
import { settings } from '../store/settings.store.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { vault } from '../vault/vault.js';
import * as ui from '../ui/index.js';
import { isValidPort } from '../utils/validators.js';
import { ensureVaultSetup, unlockVault } from './helpers.js';

interface Row {
  label: string;
  value: string;
}

const pick = async (
  message: string,
  rows: Row[],
  crumbs: string[] = ['Главное меню'],
): Promise<string | typeof ui.BACK> => {
  const res = await ui.pickFromList<Row>({
    message,
    items: rows,
    render: (r) => r.label,
    search: (r) => r.label,
    pageSize: 14,
    crumbs,
    indent: crumbs.length * 2,
  });
  return res === ui.BACK ? ui.BACK : res.value;
};

// ---------- settings as an editable menu (#7) ----------

async function editSetting(key: string): Promise<void> {
  const s = settings.get();
  if (key === 'defaultUser') {
    settings.update({
      defaultUser: (
        await ui.text({ message: 'SSH-пользователь по умолчанию', default: s.defaultUser })
      ).trim(),
    });
  } else if (key === 'defaultSshPort') {
    const v = await ui.text({
      message: 'SSH-порт по умолчанию',
      default: String(s.defaultSshPort),
      validate: (x) => isValidPort(x) || '1..65535',
    });
    settings.update({ defaultSshPort: Number(v) });
  } else if (key === 'defaultAuth') {
    settings.update({
      defaultAuth: await ui.choose<AuthMethod>({
        message: 'Метод авторизации по умолчанию',
        choices: [
          { name: 'ssh-agent / по умолчанию', value: 'agent' },
          { name: 'SSH-ключ', value: 'key' },
          { name: 'Пароль', value: 'password' },
        ],
        default: s.defaultAuth,
      }),
    });
  } else if (key === 'defaultRemoteHost') {
    settings.update({
      defaultRemoteHost: (
        await ui.text({
          message: 'Удалённый хост сервиса по умолчанию',
          default: s.defaultRemoteHost,
        })
      ).trim(),
    });
  } else if (key === 'openBrowser') {
    settings.update({
      openBrowser: await ui.confirm({
        message: 'Открывать браузер при local-пробросе?',
        default: s.openBrowser,
      }),
    });
  } else if (key === 'defaultSort') {
    settings.update({
      defaultSort: await ui.choose<SortKey>({
        message: 'Сортировка списков по умолчанию',
        choices: [
          { name: 'Последнему использованию', value: 'recent' },
          { name: 'Имени', value: 'name' },
          { name: 'Числу подключений', value: 'uses' },
          { name: 'Дате создания', value: 'created' },
          { name: 'Дате изменения', value: 'updated' },
        ],
        default: s.defaultSort,
      }),
    });
  }
  ui.printOk('Сохранено.');
}

export async function settingsFlow(): Promise<void> {
  ui.ensureInteractive('Настройки');
  const sortLabels: Record<SortKey, string> = {
    recent: 'по использованию',
    name: 'по имени',
    uses: 'по подключениям',
    created: 'по дате создания',
    updated: 'по дате изменения',
  };
  for (;;) {
    ui.clearScreen();
    const s = settings.get();
    const rows: Row[] = [
      { value: 'defaultUser', label: `SSH-пользователь: ${ui.chalk.cyan(s.defaultUser)}` },
      { value: 'defaultSshPort', label: `SSH-порт: ${ui.chalk.cyan(String(s.defaultSshPort))}` },
      { value: 'defaultAuth', label: `Авторизация: ${ui.chalk.cyan(s.defaultAuth)}` },
      {
        value: 'defaultRemoteHost',
        label: `Удалённый хост: ${ui.chalk.cyan(s.defaultRemoteHost)}`,
      },
      {
        value: 'openBrowser',
        label: `Открывать браузер: ${ui.chalk.cyan(s.openBrowser ? 'да' : 'нет')}`,
      },
      {
        value: 'defaultSort',
        label: `Сортировка списков: ${ui.chalk.cyan(sortLabels[s.defaultSort])}`,
      },
    ];
    const key = await pick('Настройки (Enter — изменить, Esc — назад)', rows);
    if (key === ui.BACK) return;
    await editSetting(key);
  }
}

// ---------- vault ----------

function vaultStatus(): void {
  const supported = vault.touchIdSupported();
  ui.printSection('🔐', 'Хранилище паролей');
  ui.printInfo(
    `Состояние: ${vault.exists() ? ui.chalk.green('создано') : ui.chalk.dim('не создано')} · ` +
      `${vault.isUnlocked() ? ui.chalk.green('разблокировано') : ui.chalk.yellow('заблокировано')} · ` +
      `секретов: ${vault.secretCount()}`,
  );
  ui.printInfo(
    `Touch ID: ${vault.isTouchIdEnabled() ? ui.chalk.green('включён') : ui.chalk.dim('выключен')}` +
      (supported ? '' : ui.chalk.dim('  (недоступен: нужен macOS + Xcode CLT)')),
  );
}

/** A connection (server / tunnel / temp tunnel) that has a saved password. */
interface SecretHolder {
  kindLabel: string;
  entity: Entity;
  /** drop the secretId on the owning store (keeps the entity itself) */
  clear: () => void;
}

function secretHolders(): SecretHolder[] {
  const out: SecretHolder[] = [];
  for (const e of servers.all())
    if (e.secretId)
      out.push({
        kindLabel: 'сервер',
        entity: e,
        clear: () => servers.update(e.id, { secretId: null }),
      });
  for (const e of tunnels.all())
    if (e.secretId)
      out.push({
        kindLabel: 'туннель',
        entity: e,
        clear: () => void tunnels.update(e.id, { secretId: null }),
      });
  for (const e of tempTunnels.all())
    if (e.secretId)
      out.push({
        kindLabel: 'врем. туннель',
        entity: e,
        clear: () => void tempTunnels.update(e.id, { secretId: null }),
      });
  return out;
}

async function pickSecretHolder(message: string): Promise<SecretHolder | null> {
  const holders = secretHolders();
  if (!holders.length) {
    ui.printWarn('Нет сохранённых паролей.');
    return null;
  }
  const picked = await ui.pickFromList<SecretHolder>({
    message,
    items: holders,
    render: (h) => `${ui.chalk.dim(h.kindLabel)}  ${ui.chalk.bold(h.entity.name)}`,
    search: (h) => h.entity.name,
    pageSize: 14,
  });
  return picked === ui.BACK ? null : picked;
}

/** Reveal the plaintext of a saved password (vault must be unlocked first). */
async function revealSavedPassword(): Promise<void> {
  const picked = await pickSecretHolder('У какого подключения показать пароль?');
  if (!picked) return;
  const id = picked.entity.secretId;
  if (!id) return;
  if (
    !(await ui.confirm({
      message: `Показать пароль для «${picked.entity.name}» на экране?`,
      default: false,
    }))
  ) {
    ui.printInfo('Отменено.');
    return;
  }
  if (!(await unlockVault())) {
    ui.printWarn('Хранилище не разблокировано — пароль не показан.');
    return;
  }
  const pw = vault.getSecret(id);
  if (pw == null) {
    ui.printWarn('Сохранённый пароль не найден.');
    return;
  }
  ui.printOk(`Пароль для «${picked.entity.name}»:`);
  console.log('  ' + ui.chalk.bold.yellow(pw));
  ui.printInfo('Скроется при возврате в меню.');
}

/** #6 — remove a saved password (keeps the server/tunnel; will ask next time). */
async function deleteSavedPassword(): Promise<void> {
  const picked = await pickSecretHolder('У какого подключения удалить сохранённый пароль?');
  if (!picked) return;
  vault.removeSecret(picked.entity.secretId);
  picked.clear();
  ui.printOk(
    `Пароль для «${picked.entity.name}» удалён (данные сохранены, спросим при подключении).`,
  );
}

/** #6 — wipe the vault when the passphrase is forgotten; entities keep their data. */
async function resetVault(): Promise<void> {
  const ok = await ui.confirm({
    message: ui.chalk.red(
      'Сбросить хранилище? Все сохранённые пароли будут удалены (серверы/туннели останутся).',
    ),
    default: false,
  });
  if (!ok) {
    ui.printInfo('Отменено.');
    return;
  }
  vault.reset();
  servers.all().forEach((e) => e.secretId && servers.update(e.id, { secretId: null }));
  tunnels.all().forEach((e) => e.secretId && tunnels.update(e.id, { secretId: null }));
  tempTunnels.all().forEach((e) => e.secretId && tempTunnels.update(e.id, { secretId: null }));
  settings.update({ vault: { enabled: false, touchId: false } });
  ui.printOk('Хранилище сброшено. Можно создать новое с новой парольной фразой.');
}

export async function vaultFlow(): Promise<void> {
  ui.ensureInteractive('Управление хранилищем');
  for (;;) {
    ui.clearScreen();
    vaultStatus();
    const exists = vault.exists();
    const rows: Row[] = [
      ...(!exists ? [{ value: 'setup', label: 'Создать хранилище' }] : []),
      ...(exists && !vault.isUnlocked() ? [{ value: 'unlock', label: 'Разблокировать' }] : []),
      ...(exists && vault.isUnlocked()
        ? [{ value: 'lock', label: 'Заблокировать (сбросить сессию)' }]
        : []),
      ...(exists ? [{ value: 'rekey', label: 'Сменить парольную фразу' }] : []),
      ...(exists && vault.secretCount() > 0
        ? [{ value: 'revealSecret', label: 'Показать сохранённый пароль' }]
        : []),
      ...(exists && vault.secretCount() > 0
        ? [{ value: 'deleteSecret', label: 'Удалить сохранённый пароль' }]
        : []),
      ...(exists && vault.touchIdSupported() && !vault.isTouchIdEnabled()
        ? [{ value: 'enableTouch', label: 'Включить Touch ID' }]
        : []),
      ...(exists && vault.isTouchIdEnabled()
        ? [{ value: 'disableTouch', label: 'Выключить Touch ID' }]
        : []),
      ...(exists ? [{ value: 'reset', label: 'Сбросить хранилище (забыл фразу)' }] : []),
    ];
    const action = await pick('Действие', rows, ['Главное меню', 'Хранилище паролей']);
    if (action === ui.BACK) return;

    if (action === 'setup') {
      await ensureVaultSetup();
    } else if (action === 'unlock') {
      ui.printInfo((await unlockVault()) ? 'Разблокировано.' : 'Не удалось разблокировать.');
    } else if (action === 'lock') {
      vault.lock();
      ui.printOk('Сессия сброшена.');
    } else if (action === 'rekey') {
      if (!(await unlockVault())) {
        ui.printWarn('Сначала нужно разблокировать.');
      } else {
        const p1 = await ui.secret({
          message: 'Новая парольная фраза',
          validate: (v) => v.length >= 4 || 'Минимум 4 символа',
        });
        const p2 = await ui.secret({ message: 'Повторите' });
        if (p1 !== p2) ui.printError('Не совпадают.');
        else {
          try {
            vault.rekey(p1);
            ui.printOk('Парольная фраза изменена.');
          } catch (e) {
            ui.printError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    } else if (action === 'revealSecret') {
      await revealSavedPassword();
    } else if (action === 'deleteSecret') {
      await deleteSavedPassword();
    } else if (action === 'enableTouch') {
      if (!(await unlockVault())) ui.printWarn('Сначала разблокируйте.');
      else if (vault.enableTouchId()) {
        settings.update({ vault: { ...settings.get().vault, touchId: true } });
        ui.printOk('Touch ID включён.');
      } else ui.printError('Не удалось включить Touch ID.');
    } else if (action === 'disableTouch') {
      vault.disableTouchId();
      settings.update({ vault: { ...settings.get().vault, touchId: false } });
      ui.printOk('Touch ID выключен.');
    } else if (action === 'reset') {
      await resetVault();
    }
    await ui.pause();
  }
}
