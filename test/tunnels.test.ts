/** commands/tunnels flows: add/edit/remove/clone/logs/connect/tag profiles. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

// Scripted answers consumed (FIFO) by the mocked prompt wrappers.
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

function mockPrompts(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
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
  setupMocks();
});

describe('tunnel edit: cancel branches', () => {
  it('editTunnel unknown name returns', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tn', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    // Unknown name → not-found, then pickEntity (store non-empty); back out → no edit.
    q.pick = [PICK_BACK];
    const { editTunnel } = await import('../src/commands/tunnels.js');
    await expect(editTunnel('nope-xyz')).resolves.toBeUndefined();
  });

  it('cancel with edits, declined, then saved', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tn', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    q.choose = ['description', '__cancel__', '__save__'];
    q.text = ['newdesc'];
    q.confirm = [false];
    const { editTunnel } = await import('../src/commands/tunnels.js');
    await editTunnel('tn');
    expect(tunnels.findByName('tn')?.description).toBe('newdesc');
  });
});

describe('tunnel + config + settings + menu flows', () => {
  it('addTunnel (local) persists', async () => {
    q.choose = ['manual', 'agent', 'local'];
    q.text = ['1.2.3.4', 'root', '22', '81', '127.0.0.1', '8181', 'npm', '', ''];
    q.confirm = [true]; // openBrowser
    mockPrompts();
    const { addTunnel } = await import('../src/commands/tunnels.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = await addTunnel();
    expect(t?.name).toBe('npm');
    expect(tunnels.findByName('npm')?.localPort).toBe(8181);
  });

  it('addConfigHost writes a block', async () => {
    q.text = ['newcfg', '1.2.3.4', 'ada', '2222', '', ''];
    mockPrompts();
    const { addConfigHost } = await import('../src/commands/config.js');
    const cfg = await import('../src/ssh-config/index.js');
    await addConfigHost();
    expect(cfg.getHost('newcfg')?.hostName).toBe('1.2.3.4');
    expect(cfg.getHost('newcfg')?.port).toBe('2222');
  });

  it('settingsFlow updates defaults', async () => {
    // settingsFlow is now a loop menu: pick a row → edit that one setting → loop;
    // BACK exits. Text/choose/confirm queues line up with the pick order below.
    q.pick = [
      'defaultUser',
      'defaultSshPort',
      'defaultRemoteHost',
      'defaultAuth',
      'defaultSort',
      'openBrowser',
      PICK_BACK,
    ];
    q.text = ['admin', '2200', '127.0.0.5'];
    q.choose = ['key', 'name']; // defaultAuth, defaultSort
    q.confirm = [false]; // openBrowser
    mockPrompts();
    const { settingsFlow } = await import('../src/commands/settings.js');
    const { settings } = await import('../src/store/settings.store.js');
    await settingsFlow();
    expect(settings.get().defaultUser).toBe('admin');
    expect(settings.get().defaultSshPort).toBe(2200);
    expect(settings.get().defaultRemoteHost).toBe('127.0.0.5');
    expect(settings.get().defaultAuth).toBe('key');
    expect(settings.get().defaultSort).toBe('name');
    expect(settings.get().openBrowser).toBe(false);
  });

  it('mainMenu exits cleanly', async () => {
    q.pick = ['exit'];
    mockPrompts();
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
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

describe('tunnel clone', () => {
  // This block ran without prompt mocks in its source file: cloneTunnelFlow must
  // see the real (non-interactive in tests) prompts module so the auto-name
  // suggestion branch is taken instead of prompting for a name.
  beforeEach(() => {
    vi.doUnmock('../src/ui/prompts.js');
    vi.doUnmock('../src/ui/list-prompt.js');
  });

  const baseTunnel = {
    kind: 'tunnel' as const,
    type: 'local' as const,
    localPort: 0,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    host: '10.0.0.5',
    user: 'root',
    sshPort: 22,
    auth: 'agent' as const,
    keyPath: null,
    secretId: 'secret-1',
    hostMode: 'manual' as const,
    sshHost: '',
    openBrowser: true,
    description: 'web',
    tags: ['prod'],
  };

  it('clones under an explicit name, copying fields and dropping the vault secret', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'web', localPort: 18080 });

    await cloneTunnelFlow('web', 'web-staging');
    const clone = tunnels.findByName('web-staging');

    expect(clone).toBeTruthy();
    expect(clone?.type).toBe('local');
    expect(clone?.remotePort).toBe(80);
    expect(clone?.host).toBe('10.0.0.5');
    expect(clone?.tags).toEqual(['prod']);
    expect(clone?.secretId).toBeNull(); // never shares a vault blob
  });

  it('auto-names the copy when no name is given', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'db', localPort: 15432 });

    await cloneTunnelFlow('db');
    expect(tunnels.findByName('db-copy')).toBeTruthy();
  });
});

describe('tunnel logs', () => {
  it('tailLines returns the last N lines (trailing newline ignored)', async () => {
    const { tailLines } = await import('../src/utils/logtail.js');
    expect(tailLines('a\nb\nc\n', 2)).toEqual(['b', 'c']);
    expect(tailLines('a\nb\nc', 2)).toEqual(['b', 'c']);
    expect(tailLines('', 5)).toEqual([]);
    expect(tailLines('x\ny\nz', 0)).toEqual(['x', 'y', 'z']);
    // NaN / negative → treated as "all" (callers coerce the --tail flag), and
    // control/escape bytes from a malicious server's output are stripped.
    expect(tailLines('a\nb', NaN)).toEqual(['a', 'b']);
    expect(tailLines('x]0;pwnedy\nz', 5)).toEqual(['x]0;pwnedy', 'z']);
  });

  it('tails a live session log and reports not-found / no-sessions', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    const { tunnelLogsFlow } = await import('../src/commands/tunnels.js');

    // no sessions → 0 (warn)
    expect(await tunnelLogsFlow()).toBe(0);

    const logFile = path.join(os.tmpdir(), `wssh-test-log-${process.pid}.log`);
    fs.writeFileSync(logFile, 'line1\nline2\nline3\n');
    sessions.add({
      tunnelId: 't1',
      name: 'mytun',
      pid: process.pid, // alive → not reaped
      store: 'main',
      forward: '8080→127.0.0.1:80',
      target: 'root@h',
      logFile,
    });

    const out: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    });
    const code = await tunnelLogsFlow('mytun', { tail: 2 });
    spy.mockRestore();

    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('line2');
    expect(text).toContain('line3');
    expect(text).not.toContain('line1'); // tail 2 dropped the first line

    expect(await tunnelLogsFlow('does-not-exist')).toBe(1);
    fs.unlinkSync(logFile);
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

describe('tunnel connect by exact name', () => {
  it('connectTunnelFlow resolves an exact tunnel name', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'exact', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    const { connectTunnelFlow } = await import('../src/commands/tunnels.js');
    expect(await connectTunnelFlow('exact')).toBe(0);
  });
});

describe('tunnel edit/remove edge cases', () => {
  async function seed() {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'tn',
      type: 'local',
      localPort: 8181,
      remotePort: 81,
      kind: 'tunnel',
    });
    return { tunnels, t };
  }

  it('editTunnel name/description/tags/browser then saves', async () => {
    const { tunnels } = await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['name', 'description', 'tags', 'browser', '__save__'];
    q.text = ['tn2', 'desc', 'x, y'];
    await editTunnel('tn');
    const t = tunnels.findByName('tn2');
    expect(t?.description).toBe('desc');
    expect(t?.tags).toEqual(['x', 'y']);
    expect(t?.openBrowser).toBe(false); // toggled from true
  });

  it('editTunnel save with no changes', async () => {
    await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['__save__'];
    await editTunnel('tn');
  });

  it('editTunnel connection branch', async () => {
    const { tunnels } = await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['connection', 'manual', 'agent', '__save__'];
    q.text = ['9.9.9.9', 'newu', '22'];
    await editTunnel('tn');
    expect(tunnels.findByName('tn')?.host).toBe('9.9.9.9');
  });

  it('removeTunnelFlow empty selection + declined-by-name', async () => {
    const { tunnels } = await seed();
    const { removeTunnelFlow } = await import('../src/commands/tunnels.js');
    q.multi = [[]];
    await removeTunnelFlow();
    expect(tunnels.all()).toHaveLength(1);
    q.confirm = [false];
    await removeTunnelFlow('tn');
    expect(tunnels.findByName('tn')).toBeTruthy();
  });
});

describe('tunnel tag profiles', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('start --tag with no matching tunnels warns and exits 0', async () => {
    const { tunnelUpByTagFlow, tunnelDownByTagFlow } = await import('../src/commands/tunnels.js');
    expect(await tunnelUpByTagFlow('work')).toBe(0);
    expect(tunnelDownByTagFlow('work')).toBe(0);
  });

  it('a blank tag is a usage error (exit 1)', async () => {
    const { tunnelUpByTagFlow, tunnelDownByTagFlow } = await import('../src/commands/tunnels.js');
    expect(await tunnelUpByTagFlow('  ')).toBe(1);
    expect(tunnelDownByTagFlow('')).toBe(1);
  });
});
