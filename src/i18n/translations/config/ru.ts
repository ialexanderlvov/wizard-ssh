/** config namespace — ~/.ssh/config CRUD UI strings. */

const ru = {
  noHosts: 'В ~/.ssh/config нет хостов.',
  pickHostEnsure: 'Выбор хоста',
  proxyKeep: (current: string) => `Оставить: ${current}`,
  proxyNone: 'Без jump-хоста',
  proxyManual: 'Ввести вручную (цепочку через запятую)',
  proxyQuestion: '🛬 ProxyJump (bastion, необязательно)',
  proxyManualPrompt: 'ProxyJump (alias или user@host:port, через запятую)',
  hostNameQuestion: '🖥 HostName (IP/домен)',
  hostNameInvalid: 'Введите валидный IP или домен',
  userQuestion: '👤 User',
  userInvalid: 'Только латиница, цифры, точка, дефис, подчёркивание (до 64)',
  portQuestion: '🔌 Port (пусто = 22)',
  portInvalid: 'Порт должен быть числом 1..65535',
  identityFileQuestion: '🗝 IdentityFile (путь, необязательно)',
  identityFileInvalid: 'Путь к ключу не должен содержать управляющих символов',
  proxyJumpInvalid: 'Неверный ProxyJump: [user@]host[:port] (через запятую) или none',
  addEnsure: 'Добавление в ~/.ssh/config',
  addSection: 'Новый хост в ~/.ssh/config',
  aliasQuestion: '🔗 Host (алиас)',
  aliasInvalidChars: 'Только буквы, цифры, . _ -',
  aliasExists: 'Такой алиас уже есть',
  hostAdded: (alias: string) => `Добавлен хост ${alias}.`,
  hostUpdated: (alias: string) => `Обновлён хост ${alias}.`,
  backupInfo: (path: string) => `Бэкап: ${path}`,
  editEnsure: 'Редактирование ~/.ssh/config',
  pickHostEdit: '✏️ Выберите хост',
  hostNotFound: (alias: string) => `Хост «${alias}» не найден.`,
  editSection: (alias: string) => `Хост ${alias}`,
  editOk: (alias: string) => `Хост ${alias} обновлён.`,
  includeMatchWarn:
    'Исходное определение в Include/Match — добавлен переопределяющий блок в основной ~/.ssh/config.',
  removeEnsure: 'Удаление из ~/.ssh/config',
  pickHostRemove: '🗑 Выберите хост',
  includeMatchRemoveWarn: (alias: string) =>
    `Хост ${alias} определён в Include/Match или мультиалиасном блоке — авто-удаление не поддерживается.`,
  removeConfirm: (alias: string) => `Удалить ${alias} из ~/.ssh/config?`,
  removeFailed: 'Не удалось удалить.',
  removeOk: (alias: string) => `Хост ${alias} удалён.`,
  listSection: (n: number) => `~/.ssh/config (${n})`,
  pickHostConnect: '🔌 Выберите хост для подключения',
};

export default ru;
export type Dict = typeof ru;
