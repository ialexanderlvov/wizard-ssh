/** commands/servers flows: add/edit/remove/duplicate/list. */
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

describe('servers: create writes config params + listServers default sort', () => {
  it('servers.create with a key writes Port + IdentityFile into ~/.ssh/config', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    const key = path.join(ssh, 'k');
    fs.writeFileSync(key, 'private');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({
      name: 'srv-alias',
      host: '1.1.1.1',
      user: 'root',
      sshPort: 2222,
      auth: 'key',
      keyPath: key,
      kind: 'server',
    });
    const cfg = await import('../src/ssh-config/index.js');
    const h = cfg.getHost('srv-alias');
    expect(h?.hostName).toBe('1.1.1.1');
    expect(h?.port).toBe('2222');
    expect(h?.identityFile).toBe(key);
    // a key-based server reads BACK as auth:'key' (inferred from IdentityFile)
    const srv = servers.findByName('srv-alias');
    expect(srv?.auth).toBe('key');
    expect(srv?.keyPath).toBe(key);
    expect(srv?.hostMode).toBe('sshconfig');
  });

  it('editServer cancel with no edits (clean)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'srv', host: '1.1.1.1', kind: 'server' });
    q.choose = ['__cancel__'];
    const { editServer } = await import('../src/commands/servers.js');
    await editServer('srv');
    expect(servers.findByName('srv')).toBeTruthy();
  });

  it('editServer: Esc on the editor menu cancels cleanly, leaving the server intact', async () => {
    // PromptCancelError must come from the same (post-resetModules) graph the flow
    // imports, or `instanceof` in editServer would miss it.
    const { PromptCancelError } = await import('../src/core/errors.js');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'srv', host: '1.1.1.1', user: 'root', kind: 'server' });
    q.choose = [new PromptCancelError()]; // Esc on the field picker → __cancel__ path
    const { editServer } = await import('../src/commands/servers.js');
    await editServer('srv');
    const srv = servers.findByName('srv');
    expect(srv?.name).toBe('srv');
    expect(srv?.user).toBe('root');
  });

  it('editServer: Esc on a field returns to the editor; nothing is saved', async () => {
    const { PromptCancelError } = await import('../src/core/errors.js');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'srv', host: '1.1.1.1', kind: 'server' });
    // open the name field → Esc on the text prompt → back to editor → cancel
    q.choose = ['name', '__cancel__'];
    q.text = [new PromptCancelError()];
    const { editServer } = await import('../src/commands/servers.js');
    await editServer('srv');
    expect(servers.findByName('srv')?.name).toBe('srv'); // field edit was discarded
  });

  it('editTunnel: Esc on a field returns to the editor; nothing is saved', async () => {
    const { PromptCancelError } = await import('../src/core/errors.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tnl', type: 'local', localPort: 8080, remotePort: 80, kind: 'tunnel' });
    q.choose = ['name', '__cancel__'];
    q.text = [new PromptCancelError()];
    const { editTunnel } = await import('../src/commands/tunnels.js');
    await editTunnel('tnl');
    expect(tunnels.findByName('tnl')?.name).toBe('tnl');
  });

  it('listServers uses the default (recent) sort when none given', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'a', host: '1.1.1.1', kind: 'server' });
    const { listServers } = await import('../src/commands/servers.js');
    expect(listServers({})).toHaveLength(1);
  });
});

describe('server edit: save/cancel branches', () => {
  async function seed() {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'srv', host: '1.1.1.1', kind: 'server' });
    return servers;
  }

  it('editServer with an unknown name just returns', async () => {
    await seed();
    // Unknown name → resolveEntity prints not-found, then (store non-empty) falls
    // back to pickEntity (pickFromList). Backing out returns no entity → no edit.
    q.pick = [PICK_BACK];
    const { editServer } = await import('../src/commands/servers.js');
    await expect(editServer('nope-xyz-nomatch')).resolves.toBeUndefined();
  });

  it('save with no edits reports "no changes"', async () => {
    const servers = await seed();
    q.choose = ['__save__'];
    const { editServer } = await import('../src/commands/servers.js');
    await editServer('srv');
    expect(servers.findByName('srv')?.description).toBe('');
  });

  it('cancel with edits, declined, then saved', async () => {
    const servers = await seed();
    q.choose = ['description', '__cancel__', '__save__'];
    q.text = ['changed'];
    q.confirm = [false]; // "discard?" → no → keep editing → then save
    const { editServer } = await import('../src/commands/servers.js');
    await editServer('srv');
    expect(servers.findByName('srv')?.description).toBe('changed');
  });

  it('update rewrites an existing alias block in place (created=false)', async () => {
    // The old offerLink/link step is gone. The "update an existing alias in
    // place" semantics now live in servers.update: patching a host rewrites its
    // Host block (HostName/User/…) while keeping the same alias and createdAt.
    writeConfig(
      '#wssh {"createdAt":"2020-01-01T00:00:00.000Z","desc":"old"}\nHost existing-alias\n    HostName 0.0.0.0\n',
    );
    const { servers } = await import('../src/store/servers.store.js');
    const before = servers.findByName('existing-alias');
    expect(before?.host).toBe('0.0.0.0');

    const updated = servers.update('existing-alias', { host: '1.1.1.1', user: 'root' });
    expect(updated?.id).toBe('existing-alias'); // same alias (in place)
    expect(updated?.host).toBe('1.1.1.1');
    expect(updated?.user).toBe('root');
    expect(updated?.createdAt).toBe(before?.createdAt); // createdAt preserved

    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('existing-alias')?.hostName).toBe('1.1.1.1');
  });
});

describe('server flows', () => {
  it('addServer (agent) writes a Host block to ~/.ssh/config', async () => {
    // addServer now asks the ALIAS first, then askServerConnection
    // (host/user/port + auth), then askAnnotations (description, tags).
    // No hostMode question, no link step, no "write to ~/.ssh/config?" confirm.
    q.text = ['mybox', '1.2.3.4', 'root', '22', '', 'prod']; // alias, host, user, port, desc, tags
    q.choose = ['agent']; // auth
    mockPrompts();
    const { addServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    const created = await addServer();
    expect(created?.name).toBe('mybox');
    expect(created?.hostMode).toBe('sshconfig'); // servers are always config-backed now
    expect(servers.findByName('mybox')?.host).toBe('1.2.3.4');
    expect(servers.findByName('mybox')?.user).toBe('root');
    expect(servers.findByName('mybox')?.tags).toEqual(['prod']);
    // the Host block landed in ~/.ssh/config
    const cfg = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    expect(cfg).toContain('Host mybox');
    expect(cfg).toContain('1.2.3.4');
  });

  it('addServer with a non-default port writes the alias to ~/.ssh/config', async () => {
    // (was "addServer with link" — link no longer exists; a server IS a config Host)
    q.text = ['linked-alias', '5.5.5.5', 'ada', '2222', '', ''];
    q.choose = ['agent'];
    mockPrompts();
    const { addServer } = await import('../src/commands/servers.js');
    await addServer();
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('linked-alias')?.hostName).toBe('5.5.5.5');
    expect(cfg.getHost('linked-alias')?.port).toBe('2222');
  });

  it('editServer changes description and saves', async () => {
    q.text = ['edit-me', '1.1.1.1', 'root', '22', '', ''];
    q.choose = ['agent'];
    mockPrompts();
    const { addServer, editServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();

    // edit: pick "description", type new value, then "save and exit"
    q.choose = ['description', '__save__'];
    q.text = ['updated desc'];
    await editServer('edit-me');
    expect(servers.findByName('edit-me')?.description).toBe('updated desc');
  });

  it('removeServerFlow with name + confirm deletes the config Host', async () => {
    q.text = ['doomed', '1.1.1.1', 'root', '22', '', ''];
    q.choose = ['agent'];
    mockPrompts();
    const { addServer, removeServerFlow } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    expect(servers.findByName('doomed')).not.toBeNull();
    q.confirm = [true]; // confirm delete
    await removeServerFlow('doomed');
    expect(servers.findByName('doomed')).toBeNull();
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

describe('server duplicate', () => {
  it('duplicates a server under a new alias', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { duplicateServerFlow } = await import('../src/commands/servers.js');
    servers.create({
      name: 'prod',
      host: '10.0.0.1',
      user: 'deploy',
      sshPort: 2222,
      auth: 'agent',
      keyPath: null,
      secretId: null,
      proxyJump: 'bastion',
      kind: 'server',
      description: 'prod box',
      tags: ['eu'],
    });

    await duplicateServerFlow('prod', 'staging');
    const dup = servers.findByName('staging');

    expect(dup).toBeTruthy();
    expect(dup?.host).toBe('10.0.0.1');
    expect(dup?.user).toBe('deploy');
    expect(dup?.sshPort).toBe(2222);
    expect(dup?.tags).toEqual(['eu']);
    expect(dup?.proxyJump).toBe('bastion'); // bastion route is carried over (#7)
  });
});

describe('server edit/remove edge cases', () => {
  async function seedAndImport() {
    // New addServer flow: alias first (text), then askServerConnection
    // (host/user/port text + auth choose), then annotations (desc/tags text).
    // No hostMode question, no link step, no password confirm for agent auth.
    q.choose = ['agent']; // auth only
    q.text = ['srv', '1.1.1.1', 'root', '22', '', '']; // alias, host, user, port, desc, tags
    const { addServer, editServer, removeServerFlow, listServers } =
      await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    return { editServer, removeServerFlow, listServers, servers };
  }

  it('editServer changes name + tags then saves', async () => {
    const { editServer, servers } = await seedAndImport();
    q.choose = ['name', 'tags', '__save__'];
    q.text = ['srv2', 'a, b'];
    await editServer('srv');
    expect(servers.findByName('srv2')?.tags).toEqual(['a', 'b']);
  });

  it('editServer cancel with unsaved edits asks for confirmation', async () => {
    const { editServer, servers } = await seedAndImport();
    q.choose = ['description', '__cancel__'];
    q.text = ['changed'];
    q.confirm = [true]; // yes, discard
    await editServer('srv');
    expect(servers.findByName('srv')?.description).toBe('');
  });

  it('removeServerFlow with empty selection does nothing', async () => {
    const { removeServerFlow, servers } = await seedAndImport();
    q.multi = [[]];
    await removeServerFlow();
    expect(servers.all()).toHaveLength(1);
  });

  it('removeServerFlow by name, declined', async () => {
    const { removeServerFlow, servers } = await seedAndImport();
    q.confirm = [false];
    await removeServerFlow('srv');
    expect(servers.findByName('srv')).toBeTruthy();
  });

  it('listServers json + empty', async () => {
    const { listServers } = await import('../src/commands/servers.js');
    expect(listServers({})).toEqual([]); // empty warn
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 's', host: '1.1.1.1', kind: 'server' });
    expect(listServers({ json: true, sort: 'name' })).toHaveLength(1);
  });
});
