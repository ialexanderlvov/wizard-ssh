const ru = {
  rowPlatform: 'Платформа',
  rowData: 'Данные',
  rowTools: 'Инструменты',
  rowInventory: 'Инвентарь',
  rowVault: 'Хранилище',
  rowAutoReconnect: 'Авто-reconnect',
  inventory: (
    servers: number,
    tunnels: number,
    tempTunnels: number,
    keys: number,
    sessions: number,
  ) => `${servers} серв · ${tunnels} тун · ${tempTunnels} врем · ${keys} ключей · ${sessions} фон`,
  vaultSecrets: (secrets: number, touchId: string) => `${secrets} секрет(ов) · Touch ID ${touchId}`,
  vaultNone: 'не создано',
};

export default ru;
export type Dict = typeof ru;
