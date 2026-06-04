import type { Dict } from './ru.js';

const en: Dict = {
  invalidUser: (u) => `Invalid username: ${u}`,
  invalidKeyPath: 'Invalid character in key path.',
  keyNotFound: (p) => `SSH key not found: ${p}`,
  authPasswordDisabled:
    '--auth password is not available in non-interactive mode (password input required).',
  authInvalid: (a) => `--auth must be agent|key (got: ${a}).`,
  serverAddUsage: 'Provide a valid name/alias: wssh server add <name> --host <ip>',
  serverNameExists: (alias) => `Host "${alias}" already exists in ~/.ssh/config.`,
  hostRequired: 'A valid --host <ip|domain> is required.',
  portInvalid: (p) => `Invalid --port: ${p}`,
  authKeyRequiresPath: '--auth key requires --key <path>.',
  serverCreated: (name) => `Server "${name}" created in ~/.ssh/config.`,
  typeInvalid: '--type must be local|remote|dynamic.',
  localPortRequired: 'A valid --local <port> is required.',
  remotePortRequired: (type) => `--type ${type} requires a valid --remote-port.`,
  remoteHostInvalid: (h) => `Invalid --remote-host: ${h}`,
  aliasInvalid: (a) => `Invalid --alias: ${a}`,
  aliasOrHostRequired: 'Provide --alias <config> or --host <ip|domain>.',
  nameInvalid: 'Invalid --name: 1–64 characters, letters/digits and space . @ : - _',
  tunnelCreated: (name) => `Tunnel "${name}" created.`,
};

export default en;
