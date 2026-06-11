const ru = {
  // binary checks
  binFound: 'найден',
  binNotFound: (why: string) => `не найден — ${why}`,
  sshMissing: 'не найден — основа всего, установите OpenSSH',
  whyScp: 'без него недоступна передача файлов scp',
  whyRsync: 'без него недоступна дельта-синхронизация',
  whyKeygen: 'нужен для генерации ключей и known_hosts',
  whyCopyId: 'нужен для установки ключа на сервер',
  whySshpass: 'нужен только для парольной авторизации',
  // clipboard
  clipLabel: 'буфер обмена',
  clipOk: 'доступен',
  clipMissing: (clip: string) => `не найден (${clip}) — копирование .pub отключено`,
  // data dir
  dataDirLabel: 'каталог данных',
  dataDirMissing: (dir: string) => `${dir} (нет)`,
  dataDirPerms: (dir: string, perms: string) => `${dir} (права ${perms})`,
  // vault perms
  vaultPermsLabel: 'права vault.json',
  vaultPermsWrong: (perms: string) => `${perms} (ожидается 600)`,
  // ssh dir
  sshDirMissing: 'нет каталога',
  sshDirPerms: (perms: string) => `права ${perms}`,
  // ssh config
  sshConfigUnparseable: 'не удалось разобрать',
  sshConfigOk: (hosts: number, perms: string) => `${hosts} хостов · права ${perms}`,
  sshConfigMissing: 'нет файла (будет создан)',
  // ssh-agent
  agentUnavailable: 'не запущен или нет ssh-add (проверьте SSH_AUTH_SOCK)',
  agentEmpty: 'запущен, но без ключей (wssh agent add)',
  agentKeys: (n: number) => `запущен · ключей: ${n}`,
  // vault / touch id
  vaultLabel: 'хранилище паролей',
  vaultCreated: 'создано',
  vaultNotCreated: 'не создано',
  touchIdSupported: 'поддерживается',
  touchIdUnavailable: 'недоступен (нужен Xcode CLT)',
  keyringSupported: 'поддерживается (Secret Service / secret-tool)',
  keyringUnavailable: 'недоступен (нужны secret-tool/libsecret и сессия D-Bus)',
  // corrupt backups
  corruptLabel: 'повреждённые данные',
  corruptFound: (files: string) =>
    `найдены резервные копии: ${files} — проверьте и удалите вручную`,
  // inventory
  inventoryLabel: 'инвентарь',
  inventoryDetail: (servers: number, tunnels: number, temp: number, keys: number) =>
    `серверов: ${servers} · туннелей: ${tunnels} · врем.: ${temp} · ключей: ${keys}`,
  // section / summary
  sectionTitle: 'Диагностика wssh',
  hasCritical: 'Есть критические проблемы (✖). Их стоит починить.',
  allOk: 'Всё в порядке.',

  // ssh keys audit
  keysLabel: 'ключи',
  keysOk: (total: number) => `${total} шт · проблем нет`,
  keysIssues: (flagged: number, total: number) => `проблемных: ${flagged} из ${total}`,
  keyIssueWeakRsa: 'RSA <2048',
  keyIssueUnencrypted: 'без пассфразы',
  keyIssueNoPub: 'нет .pub',
  keyIssueOrphan: 'не используется',
  staleKeysSection: (count: number) => `Проблемные ключи (${count})`,
  staleKeyLine: (file: string, issues: string) => `${file} — ${issues}`,
  noStaleKeys: 'Проблемных ключей не найдено.',
};

export default ru;
export type Dict = typeof ru;
