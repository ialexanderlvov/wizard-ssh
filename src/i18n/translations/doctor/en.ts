import type { Dict } from './ru.js';

const en: Dict = {
  // binary checks
  binFound: 'found',
  binNotFound: (why) => `not found — ${why}`,
  sshMissing: 'not found — required for everything, install OpenSSH',
  whyScp: 'scp file transfer unavailable without it',
  whyRsync: 'delta sync unavailable without it',
  whyKeygen: 'needed for key generation and known_hosts',
  whyCopyId: 'needed to install a key on a server',
  whySshpass: 'only needed for password-based auth',
  // clipboard
  clipLabel: 'clipboard',
  clipOk: 'available',
  clipMissing: (clip) => `not found (${clip}) — .pub copy disabled`,
  // data dir
  dataDirLabel: 'data directory',
  dataDirMissing: (dir) => `${dir} (missing)`,
  dataDirPerms: (dir, perms) => `${dir} (perms ${perms})`,
  // vault perms
  vaultPermsLabel: 'vault.json permissions',
  vaultPermsWrong: (perms) => `${perms} (expected 600)`,
  // ssh dir
  sshDirMissing: 'directory missing',
  sshDirPerms: (perms) => `perms ${perms}`,
  // ssh config
  sshConfigUnparseable: 'failed to parse',
  sshConfigOk: (hosts, perms) => `${hosts} hosts · perms ${perms}`,
  sshConfigMissing: 'no file (will be created)',
  // vault / touch id
  vaultLabel: 'password vault',
  vaultCreated: 'created',
  vaultNotCreated: 'not created',
  touchIdSupported: 'supported',
  touchIdUnavailable: 'unavailable (Xcode CLT required)',
  // corrupt backups
  corruptLabel: 'corrupted data',
  corruptFound: (files) => `corrupt backups found: ${files} — review and delete manually`,
  // inventory
  inventoryLabel: 'inventory',
  inventoryDetail: (servers, tunnels, temp, keys) =>
    `servers: ${servers} · tunnels: ${tunnels} · temp: ${temp} · keys: ${keys}`,
  // section / summary
  sectionTitle: 'wssh diagnostics',
  hasCritical: 'Critical issues found (✖). Please fix them.',
  allOk: 'Everything looks good.',
};

export default en;
