const ru = {
  root: 'Главное меню',
  ensure: 'Интерактивное меню',
  goodbye: '\nПока! 👋\n',
  counts: (servers: number, tunnels: number) => `${servers} серв · ${tunnels} тун`,
  browseTitle: 'Список',
  entityAction: {
    connect: 'Подключиться',
    edit: 'Редактировать',
    remove: 'Удалить',
  },
  main: {
    quick: 'Быстрое подключение',
    servers: 'Серверы / ~/.ssh/config ▸',
    tunnels: 'Туннели ▸',
    actions: 'Действия ▸',
    keys: 'SSH-ключи ▸',
    forget: 'Забыть host-key (known_hosts)',
    search: 'Поиск по всему',
    vault: 'Хранилище паролей',
    settings: 'Настройки',
    io: 'Экспорт / импорт',
    exit: 'Выход',
  },
  servers: {
    title: 'Серверы / ~/.ssh/config',
    list: 'Список / подключиться',
    add: 'Добавить',
  },
  tunnels: {
    title: 'Туннели',
    list: 'Список / поднять',
    quick: 'Создать и сразу поднять (из ~/.ssh/config)',
    bg: 'Фоновые сессии ▸',
    temp: 'Временные туннели (на любой хост) ▸',
    add: 'Добавить',
  },
  temp: {
    title: 'Временные туннели',
    crumb: 'Временные',
    list: 'Список / поднять',
    create: 'Создать и поднять (на любой хост)',
  },
  background: {
    title: 'Фоновые туннели',
    list: 'Список запущенных',
    up: 'Поднять в фоне',
    down: 'Остановить',
    downAll: 'Остановить все',
  },
  actions: {
    title: 'Действия по SSH',
    status: 'Статус — проверить всё',
    check: 'Проверка доступности',
    copyId: 'ssh-copy-id (ключ на сервер)',
    run: 'Выполнить команду',
    transfer: 'Передача файлов',
    groups: 'Группы по тегам',
  },
};

export default ru;
export type Dict = typeof ru;
