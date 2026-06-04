import type { Dict } from './ru.js';

const en: Dict = {
  detail: {
    server: '🖥 Server',
    tunnel: '🚇 Tunnel',
    host: 'Host        ',
    sshPort: 'SSH port    ',
    auth: 'Auth        ',
    source: 'Source      ',
    jump: 'Jump        ',
    jumpYou: 'you',
    forward: 'Forward     ',
    open: 'Open        ',
    tags: 'Tags        ',
    configArrow: '~/.ssh/config → ',
    authPassword: 'password',
    authKey: 'key',
    authConfig: 'config',
    authAgent: 'agent',
    passwordSaved: '  (password saved)',
    passwordAsk: '  (will ask on connect)',
    auto: '  (auto)',
    footer: (created, updated, used, count) =>
      `created ${created} · modified ${updated} · used ${used} · ${count}×`,
  },
  table: {
    entityHead: ['#', 'Name', 'Target', 'Type', 'Used', 'Times', 'Tags'],
    statusHead: ['', 'Name', 'Type', 'Address', 'State', 'Latency'],
    keysHead: ['#', 'File', 'Type', 'Bits', 'Fingerprint', 'Comment', '.pub'],
    sessionsHead: ['', 'Tunnel', 'Forward', 'Target', 'PID', 'Started'],
    configHead: ['#', 'Alias', 'HostName', 'User', 'Port', 'IdentityFile'],
    up: 'up',
    down: 'down',
    ms: (n) => `${n} ms`,
    temp: ' (temp)',
    shell: 'shell',
  },
  sort: {
    recent: 'recent',
    name: 'name',
    uses: 'connections',
    host: 'host',
  },
  listHelp: 'filter: type · ↑↓ — move · Enter — select · Esc — back',
  pause: '↩ Enter — back',
};

export default en;
