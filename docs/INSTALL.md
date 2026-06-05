# Установка `wssh`

## Требования

- **Node.js ≥ 18** (рекомендуется 20+; есть `.nvmrc`).
- **pnpm** (менеджер пакетов проекта; версия закреплена в `packageManager`). Проще всего
  через corepack — он сам поставит нужную версию:
  ```bash
  corepack enable
  # или глобально: npm i -g pnpm
  ```
- **ssh** в `PATH` (есть везде, где есть OpenSSH).
- Для пароля по SSH — **sshpass**:
  ```bash
  # macOS
  brew install hudochenkov/sshpass/sshpass
  # Debian/Ubuntu
  sudo apt install sshpass
  ```
- Для `ssh-copy-id` / `scp` — соответствующие утилиты OpenSSH (обычно уже есть).
- Для передачи через **rsync** — пакет `rsync` (опционально; если не установлен, мастер
  передачи предложит только scp):
  ```bash
  brew install rsync   # macOS (системный rsync тоже подходит)
  sudo apt install rsync
  ```
- Для разблокировки хранилища по **Touch ID** (опционально, только macOS) —
  **Xcode Command Line Tools** (нужен `swiftc`):
  ```bash
  xcode-select --install
  ```

## Вариант 1. Из исходников + `pnpm link` (рекомендуется для локального использования)

```bash
git clone <repo> wizard-ssh && cd wizard-ssh
pnpm install         # ставит зависимости и инициализирует husky
pnpm build           # компилирует TypeScript в dist/ (tsup)
pnpm link --global   # регистрирует глобально команды `wssh` и `wizard-ssh`
```

Проверка:

```bash
wssh --version
wssh --help
wssh                 # интерактивное меню
```

Удалить глобальную ссылку:

```bash
pnpm uninstall --global wizard-ssh
```

## Вариант 2. Глобальная установка пакета

После публикации (или из локальной папки):

```bash
pnpm add -g wizard-ssh
# или из каталога с собранным проектом:
pnpm add -g .
```

`bin` пакета регистрирует две команды: **`wssh`** (основная) и `wizard-ssh` (алиас).

## Вариант 3. Запуск без установки

```bash
pnpm dev -- server ls         # через tsx, без сборки
# или после build:
node dist/cli.js --help
```

## Алиас в shell (по желанию)

Если не хотите `pnpm link`, добавьте алиас в `~/.zshrc` / `~/.bashrc`:

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
pnpm install
pnpm build           # при pnpm link этого достаточно — dist обновится «на месте»
```

## Man-страница

Прочитать справку как man-страницу:

```bash
wssh man                 # открыть через `man`
```

Установить системно, чтобы работало `man wssh`:

```bash
# Linux
wssh man --roff | sudo tee /usr/local/share/man/man1/wssh.1 >/dev/null
# macOS
wssh man --roff | sudo tee /usr/local/share/man/man1/wssh.1 >/dev/null
man wssh
```

Страница генерируется из самого CLI, поэтому всегда соответствует доступным командам.
