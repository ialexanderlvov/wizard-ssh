import type { Dict } from './ru.js';

const en: Dict = {
  root: 'Main menu',
  ensure: 'Interactive menu',
  goodbye: '\nBye! 👋\n',
  counts: (servers, tunnels) => `${servers} srv · ${tunnels} tun`,
  browseTitle: 'List',
  entityAction: {
    connect: 'Connect',
    edit: 'Edit',
    remove: 'Delete',
  },
  main: {
    quick: 'Quick connect',
    servers: 'Servers / ~/.ssh/config ▸',
    tunnels: 'Tunnels ▸',
    actions: 'Actions ▸',
    keys: 'SSH keys ▸',
    forget: 'Forget host key (known_hosts)',
    search: 'Search everything',
    vault: 'Password vault',
    settings: 'Settings',
    io: 'Export / import',
    exit: 'Exit',
  },
  servers: {
    title: 'Servers / ~/.ssh/config',
    list: 'List / connect',
    add: 'Add',
  },
  tunnels: {
    title: 'Tunnels',
    list: 'List / start',
    quick: 'Create and start now (from ~/.ssh/config)',
    bg: 'Background sessions ▸',
    temp: 'Temporary tunnels (to any host) ▸',
    add: 'Add',
  },
  temp: {
    title: 'Temporary tunnels',
    crumb: 'Temporary',
    list: 'List / start',
    create: 'Create and start (to any host)',
  },
  background: {
    title: 'Background tunnels',
    list: 'List running',
    up: 'Start in background',
    down: 'Stop',
    downAll: 'Stop all',
  },
  actions: {
    title: 'SSH actions',
    status: 'Status — check everything',
    check: 'Reachability check',
    copyId: 'ssh-copy-id (key to server)',
    run: 'Run a command',
    transfer: 'File transfer',
    groups: 'Groups by tags',
  },
};

export default en;
