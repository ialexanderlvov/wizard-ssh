/** Default settings + password-vault management. */

import type { AuthMethod, SortKey } from '../core/types.js';
import { FILES } from '../core/paths.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import * as ui from '../ui/index.js';
import { isValidPort } from '../utils/validators.js';
import { ensureVaultSetup, unlockVault } from './helpers.js';

export async function settingsFlow(): Promise<void> {
  ui.ensureInteractive('Настройки');
  const s = settings.get();
  ui.printSection('⚙️', 'Настройки по умолчанию');

  const defaultUser = await ui.text({
    message: 'SSH-пользователь по умолчанию',
    default: s.defaultUser,
  });
  const defaultSshPort = Number(
    await ui.text({
      message: 'SSH-порт по умолчанию',
      default: String(s.defaultSshPort),
      validate: (v) => isValidPort(v) || '1..65535',
    }),
  );
  const defaultAuth = await ui.choose<AuthMethod>({
    message: 'Метод авторизации по умолчанию',
    choices: [
      { name: 'ssh-agent / по умолчанию', value: 'agent' },
      { name: 'SSH-ключ', value: 'key' },
      { name: 'Пароль', value: 'password' },
    ],
    default: s.defaultAuth,
  });
  const defaultRemoteHost = await ui.text({
    message: 'Удалённый хост сервиса по умолчанию',
    default: s.defaultRemoteHost,
  });
  const openBrowser = await ui.confirm({
    message: 'Открывать браузер при local-пробросе',
    default: s.openBrowser,
  });
  const defaultSort = await ui.choose<SortKey>({
    message: 'Сортировка списков по умолчанию',
    choices: [
      { name: 'Последнему использованию', value: 'recent' },
      { name: 'Имени', value: 'name' },
      { name: 'Числу подключений', value: 'uses' },
      { name: 'Дате создания', value: 'created' },
      { name: 'Дате изменения', value: 'updated' },
    ],
    default: s.defaultSort,
  });

  settings.update({
    defaultUser,
    defaultSshPort,
    defaultAuth,
    defaultRemoteHost,
    openBrowser,
    defaultSort,
  });
  ui.printOk('Настройки сохранены.');
  console.log(ui.chalk.dim('Файл данных: ' + FILES.settings));
}

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

export async function vaultFlow(): Promise<void> {
  ui.ensureInteractive('Управление хранилищем');
  for (;;) {
    vaultStatus();
    const exists = vault.exists();
    const choices = [
      ...(!exists ? [{ name: '🆕 Создать хранилище', value: 'setup' }] : []),
      ...(exists && !vault.isUnlocked() ? [{ name: '🔓 Разблокировать', value: 'unlock' }] : []),
      ...(exists && vault.isUnlocked()
        ? [{ name: '🔒 Заблокировать (сбросить сессию)', value: 'lock' }]
        : []),
      ...(exists ? [{ name: '🔑 Сменить парольную фразу', value: 'rekey' }] : []),
      ...(exists && vault.touchIdSupported() && !vault.isTouchIdEnabled()
        ? [{ name: '👆 Включить Touch ID', value: 'enableTouch' }]
        : []),
      ...(exists && vault.isTouchIdEnabled()
        ? [{ name: '🚫 Выключить Touch ID', value: 'disableTouch' }]
        : []),
      { name: '↩  Назад', value: 'back' },
    ];
    const action = await ui.choose<string>({ message: 'Действие', choices });

    if (action === 'back') return;
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
    }
    await ui.pause();
  }
}
