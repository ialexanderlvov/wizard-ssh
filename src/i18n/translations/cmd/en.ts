import type { Dict } from './ru.js';

const en: Dict = {
  hostArg: 'ip|domain',
  // global flags
  optYes: 'assume yes on all confirmations (for scripts)',
  optNonInteractive: 'never open interactive prompts',

  // shared option help
  optOutputJson: 'output JSON',
  optOutputJsonWithList: 'output JSON (with --list)',
  optReverseOrder: 'reverse order',
  optTmux: 'open/reattach to a tmux session on the server',
  optSshUser: 'SSH user',
  optSshPort: 'SSH port',
  optAuthMethod: 'auth method',
  optKeyPath: 'path to private key (for --auth key)',
  optDesc: 'description',
  optTags: 'comma-separated tags',

  // connect (top-level)
  connectDesc: 'connect (server / tunnel / ~/.ssh/config alias)',

  // server group
  serverGroupDesc: 'manage servers (SSH shell)',
  serverConnectDesc: 'connect to a server',
  serverAddDesc: 'add server (with flags — no prompts)',
  serverAddOptHost: 'HostName (enables non-interactive mode)',
  serverEditDesc: 'edit server',
  serverRemoveDesc: 'remove server(s)',
  serverListDesc: 'list servers',
  serverDuplicateDesc: 'duplicate a server under a new alias',

  // tunnel group
  tunnelGroupDesc: 'manage tunnels (-L/-R/-D)',
  tunnelConnectDesc: 'bring up a tunnel',
  tunnelAddDesc: 'add tunnel (with flags — no prompts)',
  tunnelAddOptName: 'tunnel name',
  tunnelAddOptType: 'forwarding type',
  tunnelAddOptLocal: 'local port',
  tunnelAddOptRemoteHost: 'host on the far side',
  tunnelAddOptRemotePort: 'port on the far side',
  tunnelAddOptAlias: 'host from ~/.ssh/config',
  tunnelAddOptHost: 'host (instead of --alias)',
  tunnelAddOptSshUserWithHost: 'SSH user (with --host)',
  tunnelAddOptSshPortWithHost: 'SSH port (with --host)',
  tunnelStartDesc: 'bring up tunnel in background (agent/key)',
  tunnelSessionsDesc: 'list background tunnels',
  tunnelDownDesc: 'stop background tunnel (or all: --all)',
  tunnelDownOptAll: 'stop all',
  tunnelTempDesc: 'temporary tunnel to any host (not saved)',
  tunnelEditDesc: 'edit tunnel',
  tunnelRemoveDesc: 'remove tunnel(s)',
  tunnelListDesc: 'list tunnels',
  tunnelCloneDesc: 'clone a tunnel (a free local port is auto-picked)',
  tunnelLogsDesc: 'show a background tunnel log',
  tunnelLogsOptTail: 'how many trailing lines (default 40)',
  tunnelLogsOptFollow: 'follow the log in real time',

  // config group
  configGroupDesc: 'manage ~/.ssh/config',
  configListDesc: 'list hosts',
  configConnectDesc: 'connect to a config host',
  configAddDesc: 'add host',
  configEditDesc: 'edit host',
  configRemoveDesc: 'remove host',

  // search
  searchDesc: 'search across servers, tunnels and ~/.ssh/config',

  // actions
  checkDesc: 'check server/tunnel availability',
  copyIdDesc: 'install SSH key on server (ssh-copy-id)',
  runDesc: 'run a command on a server: wssh run <name> -- <cmd>',
  transferDesc: 'transfer files via scp or rsync',

  // status
  statusDesc: 'bulk availability check (dashboard)',
  statusOptServers: 'servers only',
  statusOptTunnels: 'tunnels only',
  statusOptTag: 'only with this tag',

  // keys group
  keysGroupDesc: 'manage SSH keys (~/.ssh)',
  keysListDesc: 'list keys with fingerprints',
  keysGenDesc: 'generate a new key (ssh-keygen)',
  keysRemoveDesc: 'remove key (shows who references it)',

  // forget-host / known_hosts
  forgetHostDesc: 'known_hosts: remove entry (ssh-keygen -R) or show (--list)',
  forgetHostOptList: 'show known_hosts entries',

  // group
  groupDesc: 'server/tunnel groups by tag',
  groupListDesc: 'tags and their sizes',
  groupCheckDesc: 'check availability of all with a tag',

  // diagnostics / info
  doctorDesc: 'diagnose environment (binaries, permissions, config)',
  infoDesc: 'environment, paths and inventory summary',

  // vault / settings / io
  vaultDesc: 'manage password vault',
  settingsDesc: 'default settings',
  exportDesc: 'export all lists to a file',
  importDesc: 'import lists from a file',
  importOptReplace: 'replace existing lists',

  // misc
  pathDesc: 'path to data directory',
  menuDesc: 'open interactive menu',

  // parseSort error
  sortInvalid: (keys) => `--sort must be one of: ${keys}`,

  // addHelpText
  helpExamples: `
Examples:
  wssh                          interactive menu
  wssh connect prod             connect to server/tunnel "prod"
  wssh connect prod --tmux      enter a persistent tmux session
  wssh run prod -- uptime       run a command on the server
  wssh server add prod --host 10.0.0.5 --user deploy --auth key --key ~/.ssh/id_ed25519
  wssh tunnel add --alias prod --type local --local 8080 --remote-port 80
  wssh tunnel start prod-db     bring up tunnel in background
  wssh tunnel sessions          which tunnels are running in background
  wssh status --json            fleet availability (for scripts)
  wssh keys gen                 generate an SSH key
  wssh doctor                   check environment
  WSSH_VAULT_PASSPHRASE=… wssh run prod -- ls   non-interactive (password from env)`,
};

export default en;
