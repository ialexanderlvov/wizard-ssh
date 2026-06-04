import type { Dict } from './ru.js';

const en: Dict = {
  rowPlatform: 'Platform',
  rowData: 'Data',
  rowTools: 'Tools',
  rowInventory: 'Inventory',
  rowVault: 'Vault',
  rowAutoReconnect: 'Auto-reconnect',
  inventory: (servers, tunnels, tempTunnels, keys, sessions) =>
    `${servers} srv · ${tunnels} tun · ${tempTunnels} tmp · ${keys} keys · ${sessions} bg`,
  vaultSecrets: (secrets, touchId) => `${secrets} secret(s) · Touch ID ${touchId}`,
  vaultNone: 'not created',
};

export default en;
