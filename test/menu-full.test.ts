import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

const q = { choose: [] as unknown[] };
const chooseMock = vi.fn(async () => q.choose.shift());

const srv = {
  connectServerFlow: vi.fn(async () => 0),
  addServer: vi.fn(async () => null),
  editServer: vi.fn(async () => {}),
  removeServerFlow: vi.fn(async () => {}),
  listServers: vi.fn(() => []),
};
const tun = {
  connectTunnelFlow: vi.fn(async () => 0),
  addTunnel: vi.fn(async () => null),
  editTunnel: vi.fn(async () => {}),
  removeTunnelFlow: vi.fn(async () => {}),
  listTunnels: vi.fn(() => []),
};
const cfg = {
  listConfigHosts: vi.fn(() => []),
  connectConfigHostFlow: vi.fn(async () => 0),
  addConfigHost: vi.fn(async () => {}),
  editConfigHost: vi.fn(async () => {}),
  removeConfigHostFlow: vi.fn(async () => {}),
};
const act = {
  checkFlow: vi.fn(async () => 0),
  copyIdFlow: vi.fn(async () => 0),
  runFlow: vi.fn(async () => 0),
  transferFlow: vi.fn(async () => 0),
};
const connectMod = { quickConnect: vi.fn(async () => 0), quickConnectByName: vi.fn(async () => 0) };
const searchMod = { searchFlow: vi.fn(async () => {}) };
const settingsMod = { settingsFlow: vi.fn(async () => {}), vaultFlow: vi.fn(async () => {}) };
const ioMod = { importExportMenu: vi.fn(async () => {}), exportData: vi.fn(), importData: vi.fn() };

function setup(): void {
  vi.doMock('../src/ui/prompts.js', () => ({
    isInteractive: () => true,
    ensureInteractive: () => {},
    choose: chooseMock,
    pause: async () => {},
    text: async () => '',
    confirm: async () => false,
    secret: async () => '',
    multiChoose: async () => [],
    searchChoose: async () => '',
  }));
  vi.doMock('../src/commands/servers.js', () => srv);
  vi.doMock('../src/commands/tunnels.js', () => tun);
  vi.doMock('../src/commands/config.js', () => cfg);
  vi.doMock('../src/commands/actions.js', () => act);
  vi.doMock('../src/commands/connect.js', () => connectMod);
  vi.doMock('../src/commands/search.js', () => searchMod);
  vi.doMock('../src/commands/settings.js', () => settingsMod);
  vi.doMock('../src/commands/import-export.js', () => ioMod);
}

beforeEach(() => {
  vi.resetModules();
  freshHome();
  q.choose = [];
  [
    chooseMock,
    ...Object.values(srv),
    ...Object.values(tun),
    ...Object.values(cfg),
    ...Object.values(act),
    connectMod.quickConnect,
    searchMod.searchFlow,
    settingsMod.settingsFlow,
    settingsMod.vaultFlow,
    ioMod.importExportMenu,
  ].forEach((m) => (m as ReturnType<typeof vi.fn>).mockClear());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setup();
});

describe('mainMenu navigation', () => {
  it('walks every top-level action and submenu, then exits', async () => {
    q.choose = [
      'quick',
      'search',
      'vault',
      'settings',
      'io',
      'servers',
      'connect',
      'add',
      'edit',
      'remove',
      'list',
      'back',
      'tunnels',
      'connect',
      'add',
      'edit',
      'remove',
      'list',
      'back',
      'config',
      'list',
      'connect',
      'add',
      'edit',
      'remove',
      'back',
      'actions',
      'check',
      'copyId',
      'run',
      'transfer',
      'back',
      'exit',
    ];
    const { mainMenu } = await import('../src/commands/menu.js');
    await mainMenu();

    expect(connectMod.quickConnect).toHaveBeenCalled();
    expect(searchMod.searchFlow).toHaveBeenCalled();
    expect(settingsMod.vaultFlow).toHaveBeenCalled();
    expect(settingsMod.settingsFlow).toHaveBeenCalled();
    expect(ioMod.importExportMenu).toHaveBeenCalled();
    expect(srv.connectServerFlow).toHaveBeenCalled();
    expect(srv.addServer).toHaveBeenCalled();
    expect(srv.editServer).toHaveBeenCalled();
    expect(srv.removeServerFlow).toHaveBeenCalled();
    expect(srv.listServers).toHaveBeenCalled();
    expect(tun.connectTunnelFlow).toHaveBeenCalled();
    expect(tun.addTunnel).toHaveBeenCalled();
    expect(cfg.listConfigHosts).toHaveBeenCalled();
    expect(cfg.addConfigHost).toHaveBeenCalled();
    expect(act.checkFlow).toHaveBeenCalled();
    expect(act.copyIdFlow).toHaveBeenCalled();
    expect(act.runFlow).toHaveBeenCalled();
    expect(act.transferFlow).toHaveBeenCalled();
  });

  it('recovers from a flow error and keeps the menu alive', async () => {
    connectMod.quickConnect.mockRejectedValueOnce(new Error('disk full'));
    q.choose = ['quick', 'exit'];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });

  it('Ctrl+C at the menu prompt exits cleanly', async () => {
    const { PromptAbortError } = await import('../src/core/errors.js');
    chooseMock.mockRejectedValueOnce(new PromptAbortError());
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });

  it('Ctrl+C inside a flow exits cleanly', async () => {
    const { PromptAbortError } = await import('../src/core/errors.js');
    settingsMod.settingsFlow.mockRejectedValueOnce(new PromptAbortError());
    q.choose = ['settings'];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });
});
