import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome, listMock, PICK_BACK } from './helpers.js';

// Shared queue object: promptMock-style fields + the list-prompt `pick` queue.
// Navigation now flows entirely through ui.pickFromList (list-prompt), so `pick`
// drives every menu/submenu/entity selection.
const q = { choose: [] as unknown[], pick: [] as unknown[] };
const chooseMock = vi.fn(async () => q.choose.shift());

const srv = {
  connectServer: vi.fn(async () => 0),
  addServer: vi.fn(async () => null),
  editServer: vi.fn(async () => {}),
  removeServerFlow: vi.fn(async () => {}),
};
const tun = {
  connectTunnel: vi.fn(async () => 0),
  addTunnel: vi.fn(async () => null),
  editTunnel: vi.fn(async () => {}),
  removeTunnelFlow: vi.fn(async () => {}),
  createAndRaiseTunnel: vi.fn(async () => 0),
};
const cfg = {
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
  // The custom list prompt MUST be mocked so ui.BACK identity holds and every
  // pickFromList navigation resolves from the shared `q.pick` queue.
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
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
  q.pick = [];
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
    // browseEntities reads the REAL store, so seed one server + one tunnel.
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    servers.create({ name: 'box', host: '1.1.1.1', kind: 'server' });
    tunnels.create({ name: 'tnl', type: 'local', localPort: 8181, remotePort: 81, kind: 'tunnel' });

    q.pick = [
      // quick connect
      'quick',
      // search + vault + settings + io (all delegate to mocked flows)
      'search',
      'vault',
      'settings',
      'io',
      // servers submenu: add, then list -> browse -> pick 'box' -> connect (browser returns), back
      'servers',
      'add',
      'list',
      'box',
      'connect',
      PICK_BACK, // leave servers submenu
      // tunnels submenu: add, quick (createAndRaiseTunnel), list -> browse -> 'tnl' -> connect, back
      'tunnels',
      'add',
      'quick',
      'list',
      'tnl',
      'connect',
      PICK_BACK, // leave tunnels submenu
      // NOTE: the standalone '~/.ssh/config' submenu was removed — servers ARE
      // config hosts now, so there is no longer a 'config' main-menu entry.
      // actions submenu: check, copyId, run, transfer, back
      'actions',
      'check',
      'copyId',
      'run',
      'transfer',
      PICK_BACK,
      // leave main menu
      'exit',
    ];
    const { mainMenu } = await import('../src/commands/menu.js');
    await mainMenu();

    expect(connectMod.quickConnect).toHaveBeenCalled();
    expect(searchMod.searchFlow).toHaveBeenCalled();
    expect(settingsMod.vaultFlow).toHaveBeenCalled();
    expect(settingsMod.settingsFlow).toHaveBeenCalled();
    expect(ioMod.importExportMenu).toHaveBeenCalled();

    // servers submenu: add + browse-connect (connectServer, NOT connectServerFlow)
    expect(srv.addServer).toHaveBeenCalled();
    expect(srv.connectServer).toHaveBeenCalled();

    // tunnels submenu: add + quick-create + browse-connect
    expect(tun.addTunnel).toHaveBeenCalled();
    expect(tun.createAndRaiseTunnel).toHaveBeenCalled();
    expect(tun.connectTunnel).toHaveBeenCalled();

    // The '~/.ssh/config' submenu was removed from mainMenu, so configCmd.*
    // is no longer reachable here — it is NOT exercised by the menu walk.
    expect(cfg.connectConfigHostFlow).not.toHaveBeenCalled();
    expect(cfg.addConfigHost).not.toHaveBeenCalled();
    expect(cfg.editConfigHost).not.toHaveBeenCalled();
    expect(cfg.removeConfigHostFlow).not.toHaveBeenCalled();

    // actions submenu
    expect(act.checkFlow).toHaveBeenCalled();
    expect(act.copyIdFlow).toHaveBeenCalled();
    expect(act.runFlow).toHaveBeenCalled();
    expect(act.transferFlow).toHaveBeenCalled();
  });

  it('recovers from a flow error and keeps the menu alive', async () => {
    connectMod.quickConnect.mockRejectedValueOnce(new Error('disk full'));
    q.pick = ['quick', 'exit'];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });

  it('Ctrl+C at the menu prompt exits cleanly', async () => {
    const { PromptAbortError } = await import('../src/core/errors.js');
    // menuChoose awaits pickFromList; a thrown PromptAbortError bubbles up to
    // mainMenu's catch, which prints the farewell and returns.
    q.pick = [new PromptAbortError()];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });

  it('Ctrl+C inside a flow exits cleanly', async () => {
    const { PromptAbortError } = await import('../src/core/errors.js');
    settingsMod.settingsFlow.mockRejectedValueOnce(new PromptAbortError());
    q.pick = ['settings', 'exit'];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });
});
