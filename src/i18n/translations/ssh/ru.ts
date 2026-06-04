/** SSH subsystem UI strings — source of truth. */

const ru = {
  // runner — preflight
  runnerSshNotFound: 'ssh не найден в PATH.',
  runnerNoSshConfigAlias: 'Не задан алиас ~/.ssh/config.',
  runnerNoHost: 'Не задан IP/домен.',
  runnerBadLocalPort: (port: number) => `Некорректный локальный порт: ${port}`,
  runnerBadRemotePort: (port: number) => `Некорректный удалённый порт: ${port}`,
  runnerKeyPathMissing: 'Авторизация по ключу выбрана, но путь к ключу не задан.',
  runnerKeyNotFound: (path: string) => `SSH-ключ не найден: ${path}`,
  runnerSshpassMissing:
    'sshpass не установлен — нужен для парольной авторизации.\n  brew install hudochenkov/sshpass/sshpass · apt install sshpass',
  // runner — spawn
  runnerSpawnFailed: (cmd: string, msg: string) => `Не удалось запустить ${cmd}: ${msg}`,
  // runner — host-key recovery
  runnerHostKeyChangedNonInteractive:
    'Ключ хоста изменился. Удалить старый: wssh forget-host <host>.',
  runnerHostKeyChanged: 'Ключ хоста изменился (Host key verification failed).',
  runnerForgetPrompt: (token: string) => `Забыть старый ключ для ${token} и переподключиться?`,
  runnerKeptAsIs: 'Оставлено как есть.',
  runnerKeyForgotten: 'Старый ключ удалён, переподключаюсь…',
  // runner — interactive session
  runnerConnecting: (name: string) => `Подключение → ${name}`,
  runnerSessionDone: 'Сессия завершена.',
  runnerSshExited: (code: number) => `ssh завершился с кодом ${code}.`,
  // runner — tunnel box
  runnerTunnelRestored: '🔁 Туннель восстановлен',
  runnerTunnelUp: '🚇 Туннель поднят',
  runnerReverseActive: 'Reverse-форвард активен',
  runnerCloseHint: 'Ctrl+C — закрыть туннель.',
  // runner — tunnel lifecycle
  runnerRaisingTunnel: (name: string) => `Поднимаю туннель → ${name}`,
  runnerAutoReconnectHint: 'Авто-переподключение включено (Ctrl+C — закрыть).',
  runnerTooManyRetries: 'Слишком много неудачных попыток подряд — перестаю переподключаться.',
  runnerReconnecting: (code: number, secs: number, attempt: number) =>
    `Соединение прервано (код ${code}). Переподключение через ${secs}с… (попытка ${attempt})`,
  runnerTunnelClosed: 'Туннель закрыт.',
  runnerPossibleConnectError: (port: number) =>
    `Похоже на ошибку подключения/форварда. Проверь SSH-доступ и что локальный порт ${port} свободен.`,
  // hostkey
  hostkeyNoKeygen: 'ssh-keygen не найден в PATH.',
  hostkeyEmptyHost: 'Пустой хост.',
  hostkeyFileNotFound: 'Файл ~/.ssh/known_hosts не найден — удалять нечего.',
  hostkeyRemoved: (host: string) => `Ключи для ${host} удалены из known_hosts.`,
  hostkeyKeygenFailed: 'ssh-keygen завершился с ошибкой.',
  // features
  featuresCopyIdNotFound: 'ssh-copy-id не найден в PATH.',
  featuresRsyncNotFound: 'rsync не найден в PATH.',
  featuresScpNotFound: 'scp не найден в PATH.',
  // keys
  keysKeygenNotFound: 'ssh-keygen не найден в PATH.',
  // args
  argsBadTmuxSession:
    'Недопустимое имя tmux-сессии: разрешены латиница, цифры, точка, дефис и подчёркивание (до 64 символов).',

  // mosh
  moshConnecting: (name: string) => `Подключаюсь по mosh к «${name}»…`,
  moshNotFound: 'mosh не найден в PATH. Установите mosh, чтобы пользоваться этим режимом.',
};

export default ru;
export type Dict = typeof ru;
