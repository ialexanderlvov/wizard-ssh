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
  optMosh: 'connect via mosh (UDP, for flaky links)',
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
  tunnelStartOptTag: 'raise every tunnel with a tag (profile)',
  tunnelDownOptTag: 'stop every tunnel with a tag (profile)',
  tunnelTagConflict: 'Use either a tunnel name (or --all) or --tag, not both.',
  tunnelAutostartDesc: 'start the tunnel at login (launchd/systemd)',
  tunnelAutostartAddDesc: 'install autostart for a tunnel',
  tunnelAutostartRemoveDesc: 'remove autostart',
  tunnelAutostartListDesc: 'list configured autostarts',
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
  transferOptTool: 'tool: scp or rsync',
  transferOptUpload: 'direction: upload to the server',
  transferOptDownload: 'direction: download from the server',
  transferOptLocal: 'local path',
  transferOptRemote: 'remote path',
  transferOptRecursive: 'scp: recursive (folder)',
  transferOptCompress: 'rsync: compress in transit (-z)',
  transferOptDelete: 'rsync: delete extraneous on the receiver (--delete)',
  transferOptDryRun: 'rsync: dry run (--dry-run)',
  transferBothDirections: 'Pick only one: --upload or --download.',
  transferBadTool: (tools) => `--tool must be one of: ${tools}.`,
  transferOptBg: 'run in the background (agent/key)',
  transfersDesc: 'background transfers: list (or a log via --log)',
  transfersOptLog: 'show a transfer log by id/name',

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

  // ssh-agent
  agentGroupDesc: 'ssh-agent: which keys are loaded, add/remove',
  agentListDesc: 'keys loaded into the agent',
  agentAddDesc: 'add a key to the agent (ssh-add)',
  agentRemoveDesc: 'remove a key from the agent (or all: --all)',
  agentRemoveOptAll: 'remove all keys',

  // forget-host / known_hosts
  forgetHostDesc: 'known_hosts: remove entry (ssh-keygen -R) or show (--list)',
  forgetHostOptList: 'show known_hosts entries',

  // group
  groupDesc: 'server/tunnel groups by tag',
  groupListDesc: 'tags and their sizes',
  groupCheckDesc: 'check availability of all with a tag',

  // diagnostics / info
  doctorDesc: 'diagnose environment (binaries, permissions, config)',
  doctorOptListStale: 'list only flagged SSH keys',
  infoDesc: 'environment, paths and inventory summary',

  // vault / settings / io
  vaultDesc: 'manage password vault',
  settingsDesc: 'default settings',
  exportDesc: 'export all lists to a file',
  exportOptForce: 'overwrite the file if it already exists',
  importDesc: 'import lists from a file',
  importOptReplace: 'replace existing lists',

  // misc
  pathDesc: 'path to data directory',
  menuDesc: 'open interactive menu',
  backupDesc: 'back up all of ~/.ssh to an archive (incl. private keys)',
  completionDesc: 'shell completion script (bash|zsh|fish)',
  completionBadShell: (shells) => `Supported shells: ${shells}.`,
  completionInstallDesc: 'install shell completion (auto-detects the shell)',
  completionUninstallDesc: 'remove installed shell completion',
  completionDetectFail: (shells) => `Couldn't detect your shell. Pass it explicitly: ${shells}.`,
  completionInstalledTitle: (shell) => `Completion installed for ${shell}`,
  completionWroteFile: (file) => `File: ${file}`,
  completionRcUpdated: (rc) => `Updated ${rc}`,
  completionOmzDetected: 'Detected oh-my-zsh — added the file to its $fpath.',
  completionReloadHint: (cmd) => `Restart your shell or run: ${cmd}`,
  completionRemovedTitle: (shell) => `Completion removed for ${shell}`,
  completionRemovedFile: (file) => `Removed ${file}`,
  completionNothingRemoved: 'No installed completion found.',
  manDesc: 'show the man page (--roff prints the source for installation)',
  manOptRoff: 'print the roff source (to install into man)',
  manIntro:
    'An interactive CLI for managing SSH servers, tunnels and ~/.ssh/config: ' +
    'full CRUD, connect, forward/reverse tunnels and an encrypted password vault.',
  manEnvLang: 'UI language (ru|en); takes precedence over the setting and the system locale',
  manEnvHome: 'override the data directory (default ~/.wizard-ssh)',
  manEnvVault: 'vault passphrase for non-interactive runs',
  manEnvDebug: 'print full error stack traces',
  manFilesData: 'data directory: servers (usage.json), tunnels, settings, vault, backups, logs',
  manFilesSsh: 'servers live here as Host blocks with #wssh annotations',

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
