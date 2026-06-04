import type { Dict } from './ru.js';

const en: Dict = {
  // portValidate
  portRange: 'Port must be 1..65535',

  // pickSshAlias
  noSshConfigHosts: 'No hosts in ~/.ssh/config — enter an alias manually.',
  aliasPrompt: '🔗 Host alias',
  aliasValidate: 'Letters, digits, . _ - only',
  aliasSearchPrompt: '🔗 Host from ~/.ssh/config (type to search)',

  // pickKey
  keyManualChoice: 'Enter path manually',
  keyPrompt: (count) => `🗝 Private SSH key${count ? ` (found: ${count})` : ''}`,
  keyPathPrompt: '📁 Path to private key',
  keyNotFound: (path) => `File not found: ${path}`,

  // askConnectionTarget
  connectSection: 'Connection target',
  hostModePrompt: '🧭 Host addressing method',
  hostModeSshConfig: 'Alias from ~/.ssh/config',
  hostModeSshConfigDesc: 'user/port/key taken from config',
  hostModeManual: 'IP / domain',
  hostModeManualDesc: 'specify manually',
  hostPrompt: '🖥 IP or domain',
  hostValidate: 'Enter a valid IP or domain',
  userPrompt: '👤 SSH user',
  userInvalid: 'Only letters, digits, dot, hyphen, underscore (up to 64)',
  sshPortPrompt: '🔌 SSH port',
  authPrompt: '🔐 Authentication method',
  authAgent: 'ssh-agent / default',
  authAgentDesc: 'nothing to enter',
  authKey: 'SSH key',
  authKeyDesc: 'specify a file',
  authPassword: 'Password',
  authPasswordDesc: 'can be saved in encrypted vault',

  // askServerConnection
  serverConnectSection: 'Connection',
  serverHostPrompt: '🖥 HostName (IP or domain)',
  serverAuthKeyIdentity: 'SSH key (IdentityFile)',
  serverAuthKeyIdentityDesc: 'specify key file',
  serverAuthPasswordDesc: 'can be saved in vault',

  // askAnnotations
  annotationsSection: 'Description and labels',
  descriptionPrompt: '📝 Description (optional)',
  tagsPrompt: '🏷 Tags separated by commas (optional)',

  // askForward
  forwardSection: 'What to forward',
  forwardTypePrompt: '🎯 Forward type',
  forwardLocalDesc: 'open a remote service locally (common)',
  forwardRemoteDesc: 'expose a local service on the server',
  forwardDynamicDesc: 'SOCKS5 proxy on a local port',
  socksPortPrompt: '🧦 Local SOCKS proxy port',
  remotePortPrompt: '🛰 Port on the server (opened remotely)',
  remoteTargetHostPrompt: '🏠 Local target — host',
  invalidHost: 'Invalid host',
  remoteTargetPortPrompt: '🔢 Local target — port',
  servicePortPrompt: '🎯 Service port on the server (127.0.0.1 on the server)',
  serviceHostPrompt: '🌐 Service host on the server (usually 127.0.0.1)',
  localPortPrompt: '🏠 Local port (opened on your machine)',
  openBrowserPrompt: '🌍 Open browser on connect?',

  // askMeta
  metaSection: 'Name and labels',
  namePrompt: '🏷 Name (unique, for quick access)',
  nameInvalid: '1–64 characters: letters, digits, space and . @ : - _',
  nameTaken: (name) => `Name "${name}" is already taken`,
  metaTagsPrompt: '#️⃣ Tags separated by commas (optional)',
};

export default en;
