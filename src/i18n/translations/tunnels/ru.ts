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

  // listSessions
  noBackground: 'Нет фоновых туннелей. Поднять: wssh tunnel start <имя>',
  backgroundSection: (count: number) => `Фоновые туннели (${count})`,

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
