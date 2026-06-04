import type { Dict } from './ru.js';

const en: Dict = {
  // runner — preflight
  runnerSshNotFound: 'ssh not found in PATH.',
  runnerNoSshConfigAlias: 'No ~/.ssh/config alias set.',
  runnerNoHost: 'No IP/domain set.',
  runnerBadLocalPort: (port) => `Invalid local port: ${port}`,
  runnerBadRemotePort: (port) => `Invalid remote port: ${port}`,
  runnerKeyPathMissing: 'Key auth selected but key path is not set.',
  runnerKeyNotFound: (path) => `SSH key not found: ${path}`,
  runnerSshpassMissing:
    'sshpass is not installed — required for password auth.\n  brew install hudochenkov/sshpass/sshpass · apt install sshpass',
  // runner — spawn
  runnerSpawnFailed: (cmd, msg) => `Failed to start ${cmd}: ${msg}`,
  // runner — host-key recovery
  runnerHostKeyChangedNonInteractive:
    'Host key changed. Remove the old one: wssh forget-host <host>.',
  runnerHostKeyChanged: 'Host key changed (Host key verification failed).',
  runnerForgetPrompt: (token) => `Forget the old key for ${token} and reconnect?`,
  runnerKeptAsIs: 'Kept as-is.',
  runnerKeyForgotten: 'Old key removed, reconnecting…',
  // runner — interactive session
  runnerConnecting: (name) => `Connecting → ${name}`,
  runnerSessionDone: 'Session ended.',
  runnerSshExited: (code) => `ssh exited with code ${code}.`,
  // runner — tunnel box
  runnerTunnelRestored: '🔁 Tunnel restored',
  runnerTunnelUp: '🚇 Tunnel up',
  runnerReverseActive: 'Reverse-forward active',
  runnerCloseHint: 'Ctrl+C — close tunnel.',
  // runner — tunnel lifecycle
  runnerRaisingTunnel: (name) => `Raising tunnel → ${name}`,
  runnerAutoReconnectHint: 'Auto-reconnect enabled (Ctrl+C — close).',
  runnerTooManyRetries: 'Too many consecutive failures — stopping reconnect.',
  runnerReconnecting: (code, secs, attempt) =>
    `Connection dropped (code ${code}). Reconnecting in ${secs}s… (attempt ${attempt})`,
  runnerTunnelClosed: 'Tunnel closed.',
  runnerPossibleConnectError: (port) =>
    `Looks like a connection/forward error. Check SSH access and that local port ${port} is free.`,
  // hostkey
  hostkeyNoKeygen: 'ssh-keygen not found in PATH.',
  hostkeyEmptyHost: 'Empty host.',
  hostkeyFileNotFound: 'File ~/.ssh/known_hosts not found — nothing to remove.',
  hostkeyRemoved: (host) => `Keys for ${host} removed from known_hosts.`,
  hostkeyKeygenFailed: 'ssh-keygen exited with an error.',
  // features
  featuresCopyIdNotFound: 'ssh-copy-id not found in PATH.',
  featuresRsyncNotFound: 'rsync not found in PATH.',
  featuresScpNotFound: 'scp not found in PATH.',
  // keys
  keysKeygenNotFound: 'ssh-keygen not found in PATH.',
  // args
  argsBadTmuxSession:
    'Invalid tmux session name: only letters, digits, dot, hyphen and underscore are allowed (up to 64 characters).',
  argsBadMoshDest: 'Refusing to launch mosh: the destination must not start with “-”.',

  // mosh
  moshConnecting: (name) => `Connecting via mosh to “${name}”…`,
  moshNotFound: 'mosh not found in PATH. Install mosh to use this mode.',
};

export default en;
