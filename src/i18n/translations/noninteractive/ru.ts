const ru = {
  invalidUser: (u: string) => `Некорректное имя пользователя: ${u}`,
  invalidKeyPath: 'Недопустимый символ в пути к ключу.',
  keyNotFound: (p: string) => `SSH-ключ не найден: ${p}`,
  authPasswordDisabled: '--auth password недоступен в неинтерактивном режиме (нужен ввод пароля).',
  authInvalid: (a: string) => `--auth должно быть agent|key (получено: ${a}).`,
  serverAddUsage: 'Укажите корректное имя/алиас: wssh server add <name> --host <ip>',
  serverNameExists: (alias: string) => `Хост «${alias}» уже есть в ~/.ssh/config.`,
  hostRequired: 'Нужен корректный --host <ip|домен>.',
  portInvalid: (p: string | undefined) => `Некорректный --port: ${p}`,
  authKeyRequiresPath: '--auth key требует --key <путь>.',
  serverCreated: (name: string) => `Сервер «${name}» создан в ~/.ssh/config.`,
  typeInvalid: '--type должно быть local|remote|dynamic.',
  localPortRequired: 'Нужен корректный --local <порт>.',
  remotePortRequired: (type: string) => `Для --type ${type} нужен корректный --remote-port.`,
  remoteHostInvalid: (h: string) => `Некорректный --remote-host: ${h}`,
  aliasInvalid: (a: string) => `Некорректный --alias: ${a}`,
  aliasOrHostRequired: 'Укажите --alias <конфиг> или --host <ip|домен>.',
  nameInvalid: 'Некорректное --name: 1–64 символа, буквы/цифры и пробел . @ : - _',
  tunnelCreated: (name: string) => `Туннель «${name}» создан.`,
};

export default ru;
export type Dict = typeof ru;
