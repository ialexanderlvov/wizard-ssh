const ru = {
  selectServer: '🖥 Выберите сервер',
  addEnsure: 'Добавление сервера',
  addSection: 'Новый сервер (Host в ~/.ssh/config)',
  namePrompt: '🔗 Имя сервера (= алиас в ~/.ssh/config)',
  nameInvalid: 'Только буквы, цифры, точка, дефис, подчёркивание (без пробелов)',
  nameExists: 'Такой хост уже есть в ~/.ssh/config',
  serverSaved: (name: string) => `Сервер «${name}» сохранён в ~/.ssh/config.`,
  editEnsure: 'Редактирование',
  editSelectServer: '✏️ Выберите сервер',
  editNotManageable: (name: string) =>
    `«${name}» задан мульти-алиасным блоком / Include / Match — авто-редактирование не поддерживается. Подключаться можно.`,
  editSection: (name: string) => `Сервер: ${name}`,
  editWhatDirty: 'Что меняем? • есть несохранённые правки',
  editWhat: 'Что меняем?',
  fieldName: (name: string) => `Имя          ${name}`,
  fieldDescription: (desc: string) => `Описание     ${desc}`,
  fieldTags: (tags: string) => `Теги         ${tags}`,
  fieldConnection: 'Подключение / авторизация',
  actionSave: 'Сохранить и выйти',
  actionCancel: 'Выйти без сохранения',
  changesSaved: 'Изменения сохранены в ~/.ssh/config.',
  noChanges: 'Изменений не было.',
  confirmExitUnsaved: 'Выйти без сохранения?',
  newAlias: 'Новый алиас',
  aliasInvalid: 'Только буквы, цифры, точка, дефис, подчёркивание',
  aliasTaken: 'Имя занято',
  descriptionPrompt: 'Описание',
  tagsPrompt: 'Теги через запятую',
  removeEnsure: 'Удаление',
  removeSelectServer: '🗑 Выберите сервер',
  removeNotManageable: (name: string) =>
    `«${name}» нельзя удалить автоматически (мульти-алиас / Include / Match).`,
  confirmRemoveOne: (name: string) => `Удалить «${name}» из ~/.ssh/config?`,
  serverRemoved: (name: string) => `«${name}» удалён.`,
  noRemovable: 'Нет серверов, доступных для удаления.',
  removeMultiPrompt: 'Отметьте серверы для удаления (пробел — отметить, Enter — подтвердить)',
  noneSelected: 'Ничего не выбрано.',
  confirmRemoveMany: (n: number) => `Удалить ${n}?`,
  removedMany: (n: number) => `Удалено: ${n}.`,
  emptyList: 'Серверов пока нет. Добавьте: wssh server add',
  listSection: (count: number, sort: string, dir: string) =>
    `Серверы (${count}) · сортировка: ${sort}${dir}`,

  // duplicate
  pickServerDuplicate: '🧬 Какой сервер дублировать',
  duplicateNotManageable: 'Этот хост (multi-alias / Match / Include) нельзя дублировать.',
  duplicateNamePrompt: '🏷 Алиас для копии',
  duplicated: (src: string, dst: string) => `Сервер «${src}» дублирован как «${dst}».`,
};

export default ru;
export type Dict = typeof ru;
