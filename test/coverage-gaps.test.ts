import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

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
};

function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}
const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  Object.values(runner).forEach((m) => m.mockClear());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  cmdMocks();
});

describe('config: pickers, not-found, warnings', () => {
  it('editConfigHost with no alias uses the host picker', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n');
    q.pick = ['h1'];
    q.text = ['2.2.2.2', 'u', '22', '', ''];
    const { editConfigHost } = await import('../src/commands/config.js');
    await editConfigHost();
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')?.hostName).toBe('2.2.2.2');
  });

  it('edit / remove / connect report a missing alias', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n');
    const c = await import('../src/commands/config.js');
    await c.editConfigHost('ghost');
    await c.removeConfigHostFlow('ghost');
    expect(await c.connectConfigHostFlow('ghost')).toBe(0);
  });

  it('remove refuses a multi-alias block', async () => {
    writeConfig('Host a b\n    HostName 1.1.1.1\n');
    const { removeConfigHostFlow } = await import('../src/commands/config.js');
    await removeConfigHostFlow('a');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('a')).toBeTruthy(); // not removed
  });

  it('remove declined keeps the block', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n');
    q.confirm = [false];
    const { removeConfigHostFlow } = await import('../src/commands/config.js');
    await removeConfigHostFlow('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')).toBeTruthy();
  });

  it('listConfigHosts empty then table', async () => {
    const { listConfigHosts } = await import('../src/commands/config.js');
    expect(listConfigHosts({})).toEqual([]);
    writeConfig('Host t1\n    HostName 1.1.1.1\n');
    vi.resetModules();
    cmdMocks();
    const { listConfigHosts: l2 } = await import('../src/commands/config.js');
    expect(l2({}).map((h) => h.alias)).toContain('t1');
  });
});

describe('connect edge cases', () => {
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

describe('helpers direct', () => {
  it('resolveEntity: not found on empty store → null', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { resolveEntity } = await import('../src/commands/helpers.js');
    expect(await resolveEntity(servers, 'ghost', 'msg')).toBeNull();
  });

  it('resolveEntity: several fuzzy matches → picker', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const a = servers.create({ name: 'web-1', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'web-2', host: '2.2.2.2', kind: 'server' });
    q.pick = ['web-1'];
    const { resolveEntity } = await import('../src/commands/helpers.js');
    expect((await resolveEntity(servers, 'web', 'msg'))?.id).toBe(a.id);
  });

  it('pickEntity on empty list returns null', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { pickEntity } = await import('../src/commands/servers.js');
    expect(await pickEntity(servers.all(), 'pick')).toBeNull();
  });

  it('ensureVaultSetup fails on passphrase mismatch', async () => {
    q.secret = ['aaaa', 'bbbb'];
    const { ensureVaultSetup } = await import('../src/commands/helpers.js');
    expect(await ensureVaultSetup()).toBe(false);
  });
});

describe('wizard pickers', () => {
  it('pickSshAlias falls back to manual input when no config', async () => {
    q.choose = ['sshconfig'];
    q.text = ['myalias'];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t.sshHost).toBe('myalias');
  });

  it('pickKey supports manual path entry', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    const key = path.join(ssh, 'mykey');
    fs.writeFileSync(key, '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    fs.rmSync(key); // ensure not auto-discovered, force the manual branch
    fs.writeFileSync(key, 'private'); // exists for the validate()
    q.choose = ['manual', 'key', '__manual__'];
    q.text = ['1.2.3.4', 'root', '22', key];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t.keyPath).toBe(key);
  });
});

describe('tunnel + server edge branches', () => {
  it('connectTunnelFlow with nothing saved returns 0', async () => {
    const { connectTunnelFlow } = await import('../src/commands/tunnels.js');
    expect(await connectTunnelFlow()).toBe(0);
  });

  it('editTunnel on a dynamic tunnel (no browser option)', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'dyn', type: 'dynamic', localPort: 1080, kind: 'tunnel' });
    q.choose = ['__save__'];
    const { editTunnel } = await import('../src/commands/tunnels.js');
    await editTunnel('dyn');
  });

  it('removeTunnelFlow cleans up a stored secret', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({
      name: 'sec',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      secretId: 'x',
      kind: 'tunnel',
    });
    q.confirm = [true];
    const { removeTunnelFlow } = await import('../src/commands/tunnels.js');
    await removeTunnelFlow('sec');
    expect(tunnels.findByName('sec')).toBeNull();
  });

  it('addServer with an ssh-config alias skips the link prompt', async () => {
    writeConfig('Host cfg-alias\n    HostName 9.9.9.9\n');
    q.choose = ['sshconfig'];
    q.search = ['cfg-alias'];
    q.text = ['srv-cfg', '', ''];
    const { addServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    expect(servers.findByName('srv-cfg')?.hostMode).toBe('sshconfig');
  });

  it('listServers renders a table', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 's1', host: '1.1.1.1', kind: 'server' });
    const { listServers } = await import('../src/commands/servers.js');
    expect(listServers({ sort: 'name' })).toHaveLength(1);
  });
});

describe('vault flow rekey mismatch', () => {
  it('reports mismatched new passphrases', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master');
    vault.lock();
    q.pick = ['rekey', PICK_BACK];
    q.secret = ['master', 'new1', 'new2'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    // still unlockable with the original passphrase (rekey was rejected)
    vault.lock();
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'master',
        onError: () => {},
      }),
    ).toBe(true);
  });
});
