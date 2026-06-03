import { describe, it, expect, beforeEach, vi } from 'vitest';
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
function resetQ(): void {
  (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));
}

const runner = {
  runInteractive: vi.fn(async () => 0),
  runTunnel: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
  runProgram: vi.fn(async () => 0),
};

function setupMocks(): void {
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

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  Object.values(runner).forEach((m) => m.mockClear());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('password vault round-trip through flows', () => {
  it('addTunnel saves an encrypted password; connect decrypts it', async () => {
    q.choose = ['manual', 'password', 'local'];
    q.text = ['1.2.3.4', 'root', '22', '81', '127.0.0.1', '8080', 'pwtun', '', ''];
    q.confirm = [true, true]; // save-password? yes ; openBrowser? yes
    q.secret = ['m', 'm', 'sshpw']; // vault passphrase x2, then the SSH password
    const { addTunnel, connectTunnelFlow } = await import('../src/commands/tunnels.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = await addTunnel();
    expect(t?.secretId).toBeTruthy();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.hasSecret(t?.secretId)).toBe(true);

    await connectTunnelFlow('pwtun');
    expect(runner.runTunnel).toHaveBeenCalled();
    expect(runner.runTunnel.mock.calls[0]?.[1]).toBe('sshpw'); // decrypted password passed through
    expect(tunnels.findByName('pwtun')?.useCount).toBe(1);
  });
});

describe('tunnel edit + remove', () => {
  it('editTunnel changes the forward and saves', async () => {
    q.choose = ['manual', 'agent', 'local'];
    q.text = ['1.2.3.4', 'root', '22', '81', '127.0.0.1', '8080', 'edt', '', ''];
    q.confirm = [true];
    const { addTunnel, editTunnel } = await import('../src/commands/tunnels.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    await addTunnel();

    q.choose = ['forward', 'local', '__save__'];
    q.text = ['90', '127.0.0.1', '9090'];
    q.confirm = [false];
    await editTunnel('edt');
    expect(tunnels.findByName('edt')?.localPort).toBe(9090);
  });

  it('removeTunnelFlow multi-select', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const a = tunnels.create({
      name: 'a',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    tunnels.create({ name: 'b', type: 'local', localPort: 2, remotePort: 2, kind: 'tunnel' });
    q.multi = [[a.id]];
    q.confirm = [true];
    const { removeTunnelFlow } = await import('../src/commands/tunnels.js');
    await removeTunnelFlow();
    expect(tunnels.findByName('a')).toBeNull();
    expect(tunnels.findByName('b')).toBeTruthy();
  });
});

describe('server edit (connection) + multi-delete', () => {
  it('editServer rewrites the connection', async () => {
    // addServer: alias first, then askServerConnection (host/user/port + auth),
    // then annotations (description, tags). No hostMode question any more.
    q.text = ['edsrv', '1.1.1.1', 'root', '22', '', ''];
    q.choose = ['agent'];
    const { addServer, editServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    expect(servers.findByName('edsrv')?.host).toBe('1.1.1.1');

    // edit → 'connection' runs askServerConnection (host/user/port + auth), then save.
    q.choose = ['connection', 'agent', '__save__'];
    q.text = ['5.5.5.5', 'newuser', '22'];
    await editServer('edsrv');
    expect(servers.findByName('edsrv')?.host).toBe('5.5.5.5');
    expect(servers.findByName('edsrv')?.user).toBe('newuser');

    // …and the change is reflected in ~/.ssh/config.
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('edsrv')?.hostName).toBe('5.5.5.5');
    expect(cfg.getHost('edsrv')?.user).toBe('newuser');
  });

  it('addServer writes the server into ~/.ssh/config; editing rewrites it', async () => {
    // A server IS a Host block in ~/.ssh/config — creating one writes it there.
    q.text = ['linksrv', '1.1.1.1', 'root', '22', '', ''];
    q.choose = ['agent'];
    const { addServer, editServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();

    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('linksrv')?.hostName).toBe('1.1.1.1');
    expect(servers.findByName('linksrv')?.hostMode).toBe('sshconfig');
    expect(servers.findByName('linksrv')?.manageable).toBe(true);

    // Renaming the alias via edit renames the Host block in the config.
    q.choose = ['name', '__save__'];
    q.text = ['linksrv-alias'];
    await editServer('linksrv');
    expect(cfg.getHost('linksrv')).toBeNull();
    expect(cfg.getHost('linksrv-alias')?.hostName).toBe('1.1.1.1');
    expect(servers.findByName('linksrv-alias')?.host).toBe('1.1.1.1');
  });

  it('removeServerFlow multi-select', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const a = servers.create({ name: 'srvA', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'srvB', host: '2.2.2.2', kind: 'server' });
    q.multi = [[a.id]];
    q.confirm = [true];
    const { removeServerFlow } = await import('../src/commands/servers.js');
    await removeServerFlow();
    expect(servers.findByName('srvA')).toBeNull();
    expect(servers.findByName('srvB')).toBeTruthy();
  });
});

describe('interactive quick-connect + search→connect', () => {
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
