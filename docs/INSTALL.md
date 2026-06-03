# Установка `wssh`

## Требования

- **Node.js ≥ 18** (рекомендуется 20+; есть `.nvmrc`).
- **ssh** в `PATH` (есть везде, где есть OpenSSH).
- Для пароля по SSH — **sshpass**:
  ```bash
  # macOS
  brew install hudochenkov/sshpass/sshpass
  # Debian/Ubuntu
  sudo apt install sshpass
  ```
- Для `ssh-copy-id` / `scp` — соответствующие утилиты OpenSSH (обычно уже есть).
- Для разблокировки хранилища по **Touch ID** (опционально, только macOS) —
  **Xcode Command Line Tools** (нужен `swiftc`):
  ```bash
  xcode-select --install
  ```

## Вариант 1. Из исходников + `npm link` (рекомендуется для локального использования)

```bash
git clone <repo> wizard-ssh && cd wizard-ssh
npm install          # ставит зависимости и инициализирует husky
npm run build        # компилирует TypeScript в dist/ (tsup)
npm link             # регистрирует глобально команды `wssh` и `wizard-ssh`
```

Проверка:

```bash
wssh --version
wssh --help
wssh                 # интерактивное меню
```

Удалить глобальную ссылку:

```bash
npm unlink -g wizard-ssh
```

## Вариант 2. Глобальная установка пакета

После публикации (или из локальной папки):

```bash
npm install -g wizard-ssh
# или из каталога с собранным проектом:
npm install -g .
```

`bin` пакета регистрирует две команды: **`wssh`** (основная) и `wizard-ssh` (алиас).

## Вариант 3. Запуск без установки

```bash
npm run dev -- server ls      # через tsx, без сборки
# или после build:
node dist/cli.js --help
```

## Алиас в shell (по желанию)

Если не хотите `npm link`, добавьте алиас в `~/.zshrc` / `~/.bashrc`:

```bash
alias wssh='node /полный/путь/к/wizard-ssh/dist/cli.js'
```

## Где лежат данные

- По умолчанию: `~/.wizard-ssh/` (`servers.json`, `tunnels.json`, `settings.json`,
  `vault.json`, `backups/`, `bin/`).
- Переопределить: `export WIZARD_SSH_HOME=/путь` (удобно для изоляции/тестов).
- Узнать текущий путь: `wssh path`.

## Миграция со старой версии

Если есть `~/.ssh-tunnel-manager/tunnels.json` от прежнего «SSH Tunnel Manager»,
туннели и базовые настройки импортируются автоматически при первом запуске
(один раз, пока в `~/.wizard-ssh` ещё нет `tunnels.json`).

## Обновление

```bash
git pull
npm install
npm run build        # при npm link этого достаточно — dist обновится «на месте»
```
