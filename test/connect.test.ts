// Tests for src/commands/connect.ts — quick connect dispatch, name resolution and search→connect.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';

const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
  pick: [] as unknown[],
};
const resetQ = (): void => (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));

const runner = {
  runInteractive: vi.fn(async () => 0),
  runTunnel: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
  runProgram: vi.fn(async () => 0),
  // pid = this test process (alive) so the recorded session survives the
  // liveness reap in transferSessions.list().
  startTransferDetached: vi.fn(() => ({ pid: process.pid, logFile: '/tmp/wssh-t.log' })),
};
const feat = {
  healthOpen: false,
  copyId: vi.fn(async () => 0),
  transfer: vi.fn(async () => 0),
  runCommand: vi.fn(async () => 0),
};
const touch = { supported: false };

const touchidUnsupported = () => ({
  isSupported: () => false,
  authenticate: () => false,
  storeKey: () => false,
  loadKey: () => null,
  deleteKey: () => {},
});

// Base mock set: prompts + list picker + runner + an inert keystore.
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/vault/touchid.js', touchidUnsupported);
}

// Variant: + fully static features (always succeed, never reachable).
function setupMocks(): void {
  cmdMocks();
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
    copyId: async () => 0,
    runCommand: async () => 0,
    transfer: async () => 0,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
  }));
}

// Variant: + clipboard print-fallback, spy-style features and a touch-aware keystore.
function setupMocksExtra(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  // Force the reveal flow down its print fallback (and never touch the real
  // system clipboard) by making copyToClipboard report no clipboard tool.
  vi.doMock('../src/utils/platform.js', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/platform.js')>(
      '../src/utils/platform.js',
    );
    return { ...actual, copyToClipboard: () => null };
  });
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: feat.copyId,
    runCommand: feat.runCommand,
    transfer: feat.transfer,
    transferArgv: () => ({ program: 'scp', args: [] }),
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
  let stored: string | null = null;
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => touch.supported,
    authenticate: () => true,
    storeKey: (k: string) => {
      stored = k;
      return true;
    },
    loadKey: () => stored,
    deleteKey: () => {
      stored = null;
    },
  }));
}

// beforeEach body shared by the commands-extra-derived describes below.
function extraBeforeEach(): void {
  vi.resetModules();
  freshHome();
  resetQ();
  feat.healthOpen = false;
  touch.supported = false;
  [
    runner.runInteractive,
    runner.runTunnel,
    runner.runSshInherit,
    runner.runProgram,
    runner.startTransferDetached,
    feat.copyId,
    feat.transfer,
    feat.runCommand,
  ].forEach((m) => m.mockClear());
  feat.copyId.mockImplementation(async () => 0);
  feat.transfer.mockImplementation(async () => 0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocksExtra();
}

const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};

describe('quick connect dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setupMocks();
  });

  it('connects to a named server', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web', host: '1.2.3.4', kind: 'server' });
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('web')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });

  it('connects to a ~/.ssh/config alias', async () => {
    writeConfig('Host cfgbox\n    HostName 9.9.9.9\n');
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('cfgbox')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });

  it('reports not found with exit code 1', async () => {
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('does-not-exist')).toBe(1);
  });
});

describe('interactive quick-connect + search→connect', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

  it('quickConnect picks from the fuzzy list', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'pickme', host: '1.2.3.4', kind: 'server' });
    q.pick = ['pickme'];
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });

  it('searchFlow offers to connect to a result', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web-prod', host: '1.2.3.4', kind: 'server' });
    q.pick = ['web-prod']; // which one (no confirm prompt any more)
    const { searchFlow } = await import('../src/commands/search.js');
    await searchFlow('web');
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});

describe('connect branches', () => {
  beforeEach(extraBeforeEach);

  it('resolves by name to a tunnel and a config alias', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tunx', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    writeConfig('Host cfgx\n    HostName 9.9.9.9\n');
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('tunx')).toBe(0);
    expect(runner.runTunnel).toHaveBeenCalled();
    expect(await quickConnectByName('cfgx')).toBe(0);
  });

  it('fuzzy single match connects; multi match prompts', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web-alpha', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'web-beta', host: '2.2.2.2', kind: 'server' });
    const { quickConnectByName } = await import('../src/commands/connect.js');
    // multiple "web" matches → picker
    q.pick = ['web-alpha'];
    expect(await quickConnectByName('web')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });

  it('quickConnect dispatches to a tunnel pick', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'qt',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    void t;
    q.pick = ['qt'];
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
    expect(runner.runTunnel).toHaveBeenCalled();
  });

  it('quickConnect dispatches to a config host pick', async () => {
    writeConfig('Host qc\n    HostName 9.9.9.9\n');
    q.pick = ['qc'];
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});

describe('search → connect to tunnel / config host', () => {
  beforeEach(extraBeforeEach);

  it('connects to a tunnel result', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'web-tun',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    void t;
    q.pick = ['web-tun'];
    const { searchFlow } = await import('../src/commands/search.js');
    await searchFlow('web');
    expect(runner.runTunnel).toHaveBeenCalled();
  });

  it('connects to a config-host result', async () => {
    writeConfig('Host web-cfg\n    HostName 9.9.9.9\n');
    q.pick = ['web-cfg'];
    const { searchFlow } = await import('../src/commands/search.js');
    await searchFlow('web');
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});

describe('connect edge cases', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

  it('quickConnect with nothing saved returns 0', async () => {
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
  });

  it('quickConnectByName fuzzy single match', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'alpha-box', host: '1.1.1.1', kind: 'server' });
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('alpha-bo')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});
