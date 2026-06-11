const ru = {
  // tunnelUpFlow
  pickTunnelUp: '🚇 Какой туннель поднять в фоне?',
  bgNoPassword:
    'Фоновый режим не поддерживает парольную авторизацию (нужен интерактивный sshpass). ' +
    'Используйте ключ/agent или поднимите туннель на переднем плане.',
  alreadyRunning: (name: string, pid: number) => `«${name}» уже запущен в фоне (pid ${pid}).`,
  windowsUnstable: 'Фоновые туннели на Windows работают нестабильно.',
  bgStartFailed: 'Не удалось запустить фоновый процесс.',
  tunnelRaised: (name: string, pid: number) => `Туннель «${name}» поднят в фоне (pid ${pid}).`,
  tunnelLog: (log: string, name: string) => `Лог: ${log} · остановить: wssh tunnel down ${name}`,

  // tag profiles (tunnel start/down --tag)
  tagNeedsTag: 'Укажите тег: wssh tunnel start --tag <tag>',
  tagNoTunnels: (tag: string) => `Нет туннелей с тегом «${tag}».`,
  tagUpSection: (tag: string, n: number) => `Профиль #${tag} — поднимаю туннели: ${n}`,
  tagUpDone: (n: number) => `Профиль поднят: туннелей в фоне — ${n}.`,
  tagUpFail: (fail: number, total: number) => `Не поднялось: ${fail} из ${total}.`,
  tagDownNone: (tag: string) => `Нет запущенных туннелей с тегом «${tag}».`,

  // autostart (launchd / systemd)
  autostartUnsupported: 'Автозапуск поддерживается только на macOS (launchd) и Linux (systemd).',
  autostartPickAdd: '🚀 Какой туннель запускать при загрузке?',
  autostartAgentCaveat:
    'Авторизация через agent: при загрузке агент ещё пуст, туннель поднимется только после добавления ключа. Надёжнее — авторизация по файлу ключа.',
  autostartFailed: (detail: string) => `Не удалось установить автозапуск: ${detail}`,
  autostartInstalled: (name: string) =>
    `Автозапуск для «${name}» установлен — туннель будет подниматься при входе в систему.`,
  autostartUnitFile: (file: string) => `Юнит: ${file}`,
  autostartLogsLaunchd: (id: string) => `Лог: ~/.wizard-ssh/logs/autostart-${id}.log`,
  autostartLogsSystemd: (id: string) => `Лог: journalctl --user -u wssh-tunnel-${id}`,
  autostartEditNote:
    'Команда ssh зафиксирована в юните: после правки туннеля переустановите автозапуск.',
  autostartNone: 'Автозапуск не настроен ни для одного туннеля.',
  autostartEnsure: 'Автозапуск туннелей',
  autostartNotFound: (name: string) => `Для «${name}» автозапуск не настроен.`,
  autostartPickRemove: '🗑 Какой автозапуск убрать?',
  autostartRemoved: 'Автозапуск убран.',
  autostartNothingRemoved: 'Юнит не найден — нечего убирать.',
  autostartOrphan: (id: string) => `(туннель удалён) ${id}`,
  autostartSection: (n: number) => `Автозапуск туннелей (${n})`,

  // listSessions
  noBackground: 'Нет фоновых туннелей. Поднять: wssh tunnel start <имя>',
  backgroundSection: (count: number) => `Фоновые туннели (${count})`,
  sessionNotListening: (name: string) =>
    `«${name}»: процесс жив, но локальный порт не слушается — проброс не работает. Лог: wssh tunnel logs ${name}`,

  // tunnelDownFlow
  noBackgroundDown: 'Нет фоновых туннелей.',
  pickTunnelDown: '🛑 Какой фоновый туннель остановить?',
  stopEnsure: 'Остановка туннеля',
  bgNotFound: (name: string) => `Фоновый туннель «${name}» не найден.`,
  confirmStopAll: (count: number) => `Остановить все (${count})?`,
  stopped: (count: number) => `Остановлено: ${count}.`,

  // connectTunnelFlow
  pickTunnelConnect: '🚇 Выберите туннель',

  // createAndRaiseTunnel
  quickTunnelEnsure: 'Быстрый туннель',
  noSshConfigHosts: 'В ~/.ssh/config нет хостов.',
  pickSshConfigHost: 'Хост из ~/.ssh/config для туннеля',
  tunnelCreated: (name: string) => `Туннель «${name}» создан.`,

  // raiseTemporaryTunnel
  tempTunnelEnsure: 'Временный туннель',
  tempTunnelSection: 'Временный туннель (на любой хост)',
  tempTunnelSaved: (name: string) => `Временный туннель «${name}» сохранён (отдельный список).`,

  // addTunnel
  addTunnelEnsure: 'Добавление туннеля',
  addTunnelSection: 'Новый туннель',
  tunnelSaved: (name: string) => `Туннель «${name}» сохранён.`,

  // editTunnel
  editEnsure: 'Редактирование',
  pickTunnelEdit: '✏️ Выберите туннель',
  editSection: (name: string) => `Туннель: ${name}`,
  editFieldName: (name: string) => `Имя          ${name}`,
  editFieldDescription: (desc: string) => `Описание     ${desc}`,
  editFieldTags: (tags: string) => `Теги         ${tags}`,
  editFieldConnection: 'Подключение / авторизация',
  editFieldForward: (fwd: string) => `Проброс      ${fwd}`,
  editFieldBrowser: (on: boolean) => `Авто-браузер ${on ? 'вкл' : 'выкл'}`,
  editSave: 'Сохранить и выйти',
  editCancel: 'Выйти без сохранения',
  editDirty: 'Что меняем? • есть несохранённые правки',
  editClean: 'Что меняем?',
  editSaved: 'Изменения сохранены.',
  editNoChanges: 'Изменений не было.',
  editCancelConfirm: 'Выйти без сохранения?',
  editNewName: 'Новое имя',
  editInvalidName: 'Некорректное имя',
  editNameTaken: 'Имя занято',
  editDescription: 'Описание',
  editTags: 'Теги через запятую',

  // removeTunnelFlow
  removeEnsure: 'Удаление',
  pickTunnelRemove: '🗑 Выберите туннель',
  confirmRemoveOne: (name: string) => `Удалить «${name}»?`,
  removed: (name: string) => `«${name}» удалён.`,
  tunnelListEmpty: 'Список туннелей пуст.',
  pickTunnelsMulti: 'Отметьте туннели для удаления (пробел — отметить, Enter — подтвердить)',
  nothingSelected: 'Ничего не выбрано.',
  confirmRemoveMulti: (count: number) => `Удалить ${count}?`,
  removedMulti: (count: number) => `Удалено: ${count}.`,

  // listTunnels
  listEmpty: 'Туннелей пока нет. Добавьте: wssh tunnel add',
  listSection: (count: number, sort: string, dir: string) =>
    `Туннели (${count}) · сортировка: ${sort}${dir}`,

  // local port-conflict guard
  portBusy: (port: number) =>
    `Локальный порт ${port} уже занят. Освободите его или укажите другой (--local).`,
  portBusyPrompt: (port: number) => `Локальный порт ${port} занят. Что делать?`,
  portUseFree: (port: number) => `Взять свободный порт ${port}`,
  portOverride: 'Всё равно поднять (ssh может упасть)',
  portCancel: 'Отмена',
  portSave: (port: number) => `Сохранить порт ${port} в туннеле?`,

  // clone
  pickTunnelClone: '🧬 Какой туннель клонировать',
  cloneNamePrompt: '🏷 Имя для копии',
  cloned: (src: string, dst: string) => `Туннель «${src}» склонирован как «${dst}».`,
  clonePortBumped: (port: number) => `Локальный порт изменён на свободный ${port}.`,

  // logs
  logsEnsure: 'Логи фоновой сессии',
  pickTunnelLogs: '📜 Чей лог показать',
  logsSection: (name: string, file: string) => `Лог туннеля «${name}» · ${file}`,
  logMissing: (file: string) => `Файл лога не найден: ${file}`,
  logFollowHint: 'Ctrl+C — выйти из режима слежения.',
};

export default ru;
export type Dict = typeof ru;
