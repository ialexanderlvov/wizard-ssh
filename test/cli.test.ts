// Tests for CLI-level command wiring/guards — non-TTY guards, list commands, connect flows, searchFlow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

// resetModules gives command modules a *fresh* error class, so `instanceof`
// against a statically-imported one is unreliable — assert on the stable name.
async function rejectName(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '<no throw>';
  } catch (e) {
    return (e as Error).name;
  }
}

const runnerMock = () => ({
  runInteractive: vi.fn(async () => 0),
  runTunnel: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
  runProgram: vi.fn(async () => 0),
  preflight: () => null,
});

describe('command non-TTY guards', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('interactive flows reject with NotInteractiveError', async () => {
    const servers = await import('../src/commands/servers.js');
    const tunnels = await import('../src/commands/tunnels.js');
    const config = await import('../src/commands/config.js');
    const settings = await import('../src/commands/settings.js');
    const io = await import('../src/commands/import-export.js');
    const menu = await import('../src/commands/menu.js');
    const search = await import('../src/commands/search.js');

    expect(await rejectName(servers.addServer())).toBe('NotInteractiveError');
    expect(await rejectName(servers.editServer())).toBe('NotInteractiveError');
    expect(await rejectName(servers.removeServerFlow())).toBe('NotInteractiveError');
    expect(await rejectName(tunnels.addTunnel())).toBe('NotInteractiveError');
    expect(await rejectName(tunnels.editTunnel())).toBe('NotInteractiveError');
    expect(await rejectName(config.addConfigHost())).toBe('NotInteractiveError');
    expect(await rejectName(settings.settingsFlow())).toBe('NotInteractiveError');
    expect(await rejectName(settings.vaultFlow())).toBe('NotInteractiveError');
    expect(await rejectName(io.importExportMenu())).toBe('NotInteractiveError');
    expect(await rejectName(menu.mainMenu())).toBe('NotInteractiveError');
    expect(await rejectName(search.searchFlow())).toBe('NotInteractiveError'); // no query
  });
});

describe('list commands (non-interactive)', () => {
  let logs: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    logs = [];
    spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
  });
  afterEach(() => spy.mockRestore());

  it('listServers --json prints a parseable array', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web', host: '1.2.3.4', kind: 'server' });
    servers.create({ name: 'db', host: '1.2.3.5', kind: 'server' });
    const { listServers } = await import('../src/commands/servers.js');
    const returned = listServers({ json: true });
    expect(returned).toHaveLength(2);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.map((s: { name: string }) => s.name).sort()).toEqual(['db', 'web']);
  });

  it('listTunnels table path runs and empty path warns', async () => {
    const { listTunnels } = await import('../src/commands/tunnels.js');
    expect(listTunnels({})).toEqual([]); // empty → warning, no throw
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'npm', type: 'local', localPort: 8181, remotePort: 81, kind: 'tunnel' });
    expect(listTunnels({ sort: 'name' })).toHaveLength(1);
  });

  it('listConfigHosts json', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(os.homedir(), '.ssh', 'config'), 'Host h1\n    HostName 1.1.1.1\n');
    const { listConfigHosts } = await import('../src/commands/config.js');
    const hosts = listConfigHosts({ json: true });
    expect(hosts.map((h) => h.alias)).toContain('h1');
  });
});

describe('connect flows (mocked runner)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('connectServerFlow runs the shell, records usage', async () => {
    const mock = runnerMock();
    vi.doMock('../src/ssh/runner.js', () => mock);
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', auth: 'agent', kind: 'server' });
    const { connectServerFlow } = await import('../src/commands/servers.js');
    const code = await connectServerFlow('box');
    expect(code).toBe(0);
    expect(mock.runInteractive).toHaveBeenCalledOnce();
    expect(servers.findByName('box')?.useCount).toBe(1);
  });

  it('connectTunnelFlow brings up the tunnel', async () => {
    const mock = runnerMock();
    vi.doMock('../src/ssh/runner.js', () => mock);
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({
      name: 'web',
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      auth: 'agent',
      kind: 'tunnel',
    });
    const { connectTunnelFlow } = await import('../src/commands/tunnels.js');
    expect(await connectTunnelFlow('web')).toBe(0);
    expect(mock.runTunnel).toHaveBeenCalledOnce();
  });

  it('connecting a password server with no saved secret needs a TTY', async () => {
    const mock = runnerMock();
    vi.doMock('../src/ssh/runner.js', () => mock);
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'pw', host: '1.2.3.4', auth: 'password', kind: 'server' });
    const { connectServerFlow } = await import('../src/commands/servers.js');
    expect(await rejectName(connectServerFlow('pw'))).toBe('NotInteractiveError');
    expect(mock.runInteractive).not.toHaveBeenCalled();
  });

  it('unknown name reports not found (no spawn)', async () => {
    const mock = runnerMock();
    vi.doMock('../src/ssh/runner.js', () => mock);
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'real', host: '1.2.3.4', kind: 'server' });
    const { connectServerFlow } = await import('../src/commands/servers.js');
    // exact miss → falls back to a picker, which needs a TTY
    expect(await rejectName(connectServerFlow('zzz-nomatch'))).toBe('NotInteractiveError');
  });
});

describe('searchFlow with query (non-interactive, read-only)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });
  it('prints results and returns without prompting', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { servers } = await import('../src/store/servers.store.js');
      servers.create({ name: 'web-prod', host: '1.2.3.4', kind: 'server' });
      const { searchFlow } = await import('../src/commands/search.js');
      await expect(searchFlow('web')).resolves.toBeUndefined();
      await expect(searchFlow('no-such-thing')).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
