const ru = {
  // portValidate
  portRange: 'Порт должен быть 1..65535',

  // pickSshAlias
  noSshConfigHosts: 'В ~/.ssh/config нет хостов — введите алиас вручную.',
  aliasPrompt: '🔗 Алиас хоста',
  aliasValidate: 'Только буквы, цифры, . _ -',
  aliasSearchPrompt: '🔗 Хост из ~/.ssh/config (печатай для поиска)',

  // pickKey
  keyManualChoice: 'Ввести путь вручную',
  keyPrompt: (count: number) => `🗝 Приватный SSH-ключ${count ? ` (найдено: ${count})` : ''}`,
  keyPathPrompt: '📁 Путь до приватного ключа',
  keyNotFound: (path: string) => `Файл не найден: ${path}`,

  // askConnectionTarget
  connectSection: 'Куда подключаемся',
  hostModePrompt: '🧭 Способ адресации хоста',
  hostModeSshConfig: 'Алиас из ~/.ssh/config',
  hostModeSshConfigDesc: 'user/port/key берутся из конфига',
  hostModeManual: 'IP / домен',
  hostModeManualDesc: 'указать вручную',
  hostPrompt: '🖥 IP или домен',
  hostValidate: 'Введите валидный IP или домен',
  userPrompt: '👤 SSH-пользователь',
  userInvalid: 'Только латиница, цифры, точка, дефис, подчёркивание (до 64)',
  sshPortPrompt: '🔌 SSH-порт',
  authPrompt: '🔐 Как авторизуемся?',
  authAgent: 'ssh-agent / по умолчанию',
  authAgentDesc: 'ничего вводить не нужно',
  authKey: 'SSH-ключ',
  authKeyDesc: 'указать файл',
  authPassword: 'Пароль',
  authPasswordDesc: 'можно сохранить в зашифрованном хранилище',

  // askServerConnection
  serverConnectSection: 'Подключение',
  serverHostPrompt: '🖥 HostName (IP или домен)',
  serverAuthKeyIdentity: 'SSH-ключ (IdentityFile)',
  serverAuthKeyIdentityDesc: 'указать файл ключа',
  serverAuthPasswordDesc: 'можно сохранить в хранилище',

  // askAnnotations
  annotationsSection: 'Описание и метки',
  descriptionPrompt: '📝 Описание (необязательно)',
  tagsPrompt: '🏷 Теги через запятую (необязательно)',

  // askForward
  forwardSection: 'Что пробрасываем',
  forwardTypePrompt: '🎯 Тип проброса',
  forwardLocalDesc: 'открыть удалённый сервис у себя (частое)',
  forwardRemoteDesc: 'открыть локальный сервис на сервере',
  forwardDynamicDesc: 'SOCKS5-прокси на локальном порту',
  socksPortPrompt: '🧦 Локальный порт SOCKS-прокси',
  remotePortPrompt: '🛰 Порт на сервере (откроется удалённо)',
  remoteTargetHostPrompt: '🏠 Локальная цель — хост',
  invalidHost: 'Некорректный хост',
  remoteTargetPortPrompt: '🔢 Локальная цель — порт',
  servicePortPrompt: '🎯 Порт сервиса на сервере (127.0.0.1 на сервере)',
  serviceHostPrompt: '🌐 Хост сервиса на сервере (обычно 127.0.0.1)',
  localPortPrompt: '🏠 Локальный порт (откроется у тебя)',
  openBrowserPrompt: '🌍 Открывать браузер при подключении?',

  // askMeta
  metaSection: 'Название и метки',
  namePrompt: '🏷 Имя (уникальное, для быстрого доступа)',
  nameInvalid: '1–64 символа: буквы, цифры, пробел и . @ : - _',
  nameTaken: (name: string) => `Имя «${name}» уже занято`,
  metaTagsPrompt: '#️⃣ Теги через запятую (необязательно)',
};

export default ru;
export type Dict = typeof ru;
