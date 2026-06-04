const ru = {
  // argument placeholders shown in --help
  hostArg: 'ip|домен',
  // global flags
  optYes: 'отвечать «да» на все подтверждения (для скриптов)',
  optNonInteractive: 'никогда не открывать интерактивные подсказки',

  // shared option help
  optOutputJson: 'вывести JSON',
  optOutputJsonWithList: 'вывести JSON (с --list)',
  optReverseOrder: 'обратный порядок',
  optTmux: 'открыть/переподключиться к tmux-сессии на сервере',
  optMosh: 'подключиться через mosh (UDP, для нестабильных каналов)',
  optSshUser: 'SSH-пользователь',
  optSshPort: 'SSH-порт',
  optAuthMethod: 'способ авторизации',
  optKeyPath: 'путь к приватному ключу (для --auth key)',
  optDesc: 'описание',
  optTags: 'теги через запятую',

  // connect (top-level)
  connectDesc: 'подключиться (сервер / туннель / алиас ~/.ssh/config)',

  // server group
  serverGroupDesc: 'управление серверами (SSH-шелл)',
  serverConnectDesc: 'подключиться к серверу',
  serverAddDesc: 'добавить сервер (с флагами — без вопросов)',
  serverAddOptHost: 'HostName (включает неинтерактивный режим)',
  serverEditDesc: 'редактировать сервер',
  serverRemoveDesc: 'удалить сервер(ы)',
  serverListDesc: 'список серверов',
  serverDuplicateDesc: 'дублировать сервер под новым алиасом',

  // tunnel group
  tunnelGroupDesc: 'управление туннелями (-L/-R/-D)',
  tunnelConnectDesc: 'поднять туннель',
  tunnelAddDesc: 'добавить туннель (с флагами — без вопросов)',
  tunnelAddOptName: 'имя туннеля',
  tunnelAddOptType: 'тип проброса',
  tunnelAddOptLocal: 'локальный порт',
  tunnelAddOptRemoteHost: 'хост на дальней стороне',
  tunnelAddOptRemotePort: 'порт на дальней стороне',
  tunnelAddOptAlias: 'хост из ~/.ssh/config',
  tunnelAddOptHost: 'хост (вместо --alias)',
  tunnelAddOptSshUserWithHost: 'SSH-пользователь (с --host)',
  tunnelAddOptSshPortWithHost: 'SSH-порт (с --host)',
  tunnelStartDesc: 'поднять туннель в фоне (agent/key)',
  tunnelSessionsDesc: 'список фоновых туннелей',
  tunnelDownDesc: 'остановить фоновый туннель (или все: --all)',
  tunnelDownOptAll: 'остановить все',
  tunnelTempDesc: 'временный туннель на любой хост (без сохранения)',
  tunnelEditDesc: 'редактировать туннель',
  tunnelRemoveDesc: 'удалить туннель(и)',
  tunnelListDesc: 'список туннелей',
  tunnelCloneDesc: 'клонировать туннель (свободный локальный порт подберётся сам)',
  tunnelLogsDesc: 'показать лог фонового туннеля',
  tunnelLogsOptTail: 'сколько последних строк (по умолчанию 40)',
  tunnelLogsOptFollow: 'следить за логом в реальном времени',

  // config group
  configGroupDesc: 'управление ~/.ssh/config',
  configListDesc: 'список хостов',
  configConnectDesc: 'подключиться к хосту из конфига',
  configAddDesc: 'добавить хост',
  configEditDesc: 'редактировать хост',
  configRemoveDesc: 'удалить хост',

  // search
  searchDesc: 'поиск по серверам, туннелям и ~/.ssh/config',

  // actions
  checkDesc: 'проверить доступность сервера/туннеля',
  copyIdDesc: 'установить SSH-ключ на сервер (ssh-copy-id)',
  runDesc: 'выполнить команду на сервере: wssh run <name> -- <cmd>',
  transferDesc: 'передача файлов по scp или rsync',

  // status
  statusDesc: 'массовая проверка доступности (дашборд)',
  statusOptServers: 'только серверы',
  statusOptTunnels: 'только туннели',
  statusOptTag: 'только с этим тегом',

  // keys group
  keysGroupDesc: 'управление SSH-ключами (~/.ssh)',
  keysListDesc: 'список ключей с отпечатками',
  keysGenDesc: 'сгенерировать новый ключ (ssh-keygen)',
  keysRemoveDesc: 'удалить ключ (покажет, кто на него ссылается)',

  // forget-host / known_hosts
  forgetHostDesc: 'known_hosts: удалить запись (ssh-keygen -R) или показать (--list)',
  forgetHostOptList: 'показать записи known_hosts',

  // group
  groupDesc: 'группы серверов/туннелей по тегам',
  groupListDesc: 'теги и их размеры',
  groupCheckDesc: 'проверить доступность всех с тегом',

  // diagnostics / info
  doctorDesc: 'диагностика окружения (бинари, права, конфиг)',
  doctorOptListStale: 'показать только проблемные SSH-ключи',
  infoDesc: 'сводка окружения, путей и инвентаря',

  // vault / settings / io
  vaultDesc: 'управление хранилищем паролей',
  settingsDesc: 'настройки по умолчанию',
  exportDesc: 'экспортировать все списки в файл',
  importDesc: 'импортировать списки из файла',
  importOptReplace: 'заменить существующие списки',

  // misc
  pathDesc: 'путь к директории с данными',
  menuDesc: 'открыть интерактивное меню',
  backupDesc: 'бэкап всего ~/.ssh в архив (вкл. приватные ключи)',
  completionDesc: 'скрипт автодополнения для шелла (bash|zsh|fish)',
  completionBadShell: (shells: string) => `Поддерживаются только: ${shells}.`,
  manDesc: 'показать man-страницу (--roff — вывести исходник для установки)',
  manOptRoff: 'вывести roff-исходник (для установки в man)',
  manIntro:
    'Интерактивный CLI для управления SSH-серверами, туннелями и ~/.ssh/config: ' +
    'полный CRUD, подключение, прямые/обратные туннели и зашифрованное хранилище паролей.',
  manEnvLang: 'язык интерфейса (ru|en); приоритетнее настройки и системной локали',
  manEnvHome: 'переопределить каталог данных (по умолчанию ~/.wizard-ssh)',
  manEnvVault: 'парольная фраза хранилища для неинтерактивных запусков',
  manEnvDebug: 'показывать полный стек ошибок',
  manFilesData: 'каталог данных: серверы (usage.json), туннели, настройки, хранилище, бэкапы, логи',
  manFilesSsh: 'серверы хранятся здесь как Host-блоки с аннотациями #wssh',

  // parseSort error
  sortInvalid: (keys: string) => `--sort должно быть одним из: ${keys}`,

  // addHelpText
  helpExamples: `
Примеры:
  wssh                          интерактивное меню
  wssh connect prod             подключиться к серверу/туннелю «prod»
  wssh connect prod --tmux      войти в постоянную tmux-сессию
  wssh run prod -- uptime       выполнить команду на сервере
  wssh server add prod --host 10.0.0.5 --user deploy --auth key --key ~/.ssh/id_ed25519
  wssh tunnel add --alias prod --type local --local 8080 --remote-port 80
  wssh tunnel start prod-db     поднять туннель в фоне
  wssh tunnel sessions          какие туннели работают в фоне
  wssh status --json            доступность всего парка (для скриптов)
  wssh keys gen                 сгенерировать SSH-ключ
  wssh doctor                   проверить окружение
  WSSH_VAULT_PASSPHRASE=… wssh run prod -- ls   неинтерактивно (пароль из env)`,
};

export default ru;
export type Dict = typeof ru;
