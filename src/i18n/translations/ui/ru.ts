const ru = {
  detail: {
    server: '🖥 Сервер',
    tunnel: '🚇 Туннель',
    host: 'Хост       ',
    sshPort: 'SSH-порт   ',
    auth: 'Авторизация ',
    source: 'Источник   ',
    forward: 'Проброс    ',
    open: 'Открыть    ',
    tags: 'Теги       ',
    configArrow: '~/.ssh/config → ',
    authPassword: 'пароль',
    authKey: 'ключ',
    authConfig: 'config',
    authAgent: 'agent',
    passwordSaved: '  (пароль сохранён)',
    passwordAsk: '  (спросим при подключении)',
    auto: '  (авто)',
    footer: (created: string, updated: string, used: string, count: number) =>
      `создан ${created} · изменён ${updated} · использован ${used} · ${count}×`,
  },
  table: {
    entityHead: ['#', 'Имя', 'Цель', 'Тип', 'Использован', 'Раз', 'Теги'],
    statusHead: ['', 'Имя', 'Тип', 'Адрес', 'Состояние', 'Задержка'],
    keysHead: ['#', 'Файл', 'Тип', 'Биты', 'Отпечаток', 'Комментарий', '.pub'],
    sessionsHead: ['', 'Туннель', 'Проброс', 'Цель', 'PID', 'Запущен'],
    configHead: ['#', 'Alias', 'HostName', 'User', 'Port', 'IdentityFile'],
    up: 'доступен',
    down: 'недоступен',
    ms: (n: number) => `${n} мс`,
    temp: ' (врем.)',
    shell: 'shell',
  },
  sort: {
    recent: 'недавние',
    name: 'имя',
    uses: 'подключения',
    host: 'хост',
  },
  listHelp: 'фильтр: печатай · ↑↓ — выбор · Enter — выбрать · Esc — назад',
  pause: '↩ Enter — назад',
};

export default ru;
export type Dict = typeof ru;
