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
const feat = { copyCode: 0, transferCode: 0, healthOpen: false };

function setupMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: async () => feat.copyCode,
    runCommand: async () => 0,
    transfer: async () => feat.transferCode,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
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
  feat.copyCode = 0;
  feat.transferCode = 0;
  feat.healthOpen = false;
  Object.values(runner).forEach((m) => m.mockClear());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('actions: empty resolution + non-zero exit codes', () => {
  it('flows return 0 when no server is resolved (empty store, no name)', async () => {
    const a = await import('../src/commands/actions.js');
    expect(await a.checkFlow()).toBe(0);
    expect(await a.copyIdFlow()).toBe(0);
    expect(await a.runFlow(undefined, [])).toBe(0);
    expect(await a.transferFlow()).toBe(0);
  });

  it('checkFlow on an unreachable tunnel returns 2', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tnl', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('tnl')).toBe(2);
  });

  it('copyIdFlow / transferFlow surface a non-zero exit code', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    feat.copyCode = 2;
    const { copyIdFlow, transferFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(2);
    feat.transferCode = 3;
    q.choose = ['upload'];
    q.text = ['a', 'b'];
    q.confirm = [false];
    expect(await transferFlow('box')).toBe(3);
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
