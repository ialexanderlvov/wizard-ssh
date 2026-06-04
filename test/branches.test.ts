import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';
import type { Tunnel } from '../src/core/types.js';

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
const feat = {
  healthOpen: false,
  copyId: vi.fn(async () => 0),
  transfer: vi.fn(async () => 0),
  runCommand: vi.fn(async () => 0),
};

function setupMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: feat.copyId,
    runCommand: feat.runCommand,
    transfer: feat.transfer,
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

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  feat.healthOpen = false;
  [
    runner.runInteractive,
    runner.runTunnel,
    runner.runSshInherit,
    runner.runProgram,
    feat.copyId,
    feat.transfer,
    feat.runCommand,
  ].forEach((m) => m.mockClear());
  feat.copyId.mockImplementation(async () => 0);
  feat.transfer.mockImplementation(async () => 0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('actions: every resolution + option branch', () => {
  it('checkFlow: reachable server, by name', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    feat.healthOpen = true;
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('box')).toBe(0); // open → printOk branch
  });

  it('checkFlow: no name → picker', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.pick = ['box']; // picker resolves the seeded server by name
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow()).toBe(2); // unreachable → printError branch
  });

  it('copyIdFlow: server with key auth reuses its key (no picker)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({
      name: 'box',
      host: '1.2.3.4',
      auth: 'key',
      keyPath: '/keys/id',
      kind: 'server',
    });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), '/keys/id', undefined);
  });

  it('copyIdFlow: pick the "default" key option', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    fs.writeFileSync(path.join(ssh, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['__default__'];
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });

  it('runFlow: explicit command (no prompt)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', ['ls', '-la'])).toBe(0);
  });

  it('transferFlow: recursive download', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['download'];
    q.text = ['./local', '/remote'];
    q.confirm = [true]; // recursive
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recursive: true }),
      undefined,
    );
  });
});

describe('wizard: defaults (left side of ?? / ||)', () => {
  it('askConnectionTarget with manual defaults', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['9.9.9.9', 'deploy', '2222'];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({
      hostMode: 'manual',
      host: '1.1.1.1',
      user: 'olduser',
      sshPort: 22,
      auth: 'agent',
      keyPath: '/k',
      secretId: 'sec',
      sshHost: '',
    });
    expect(t.secretId).toBe('sec'); // preserved
  });

  it('askForward local/remote/dynamic with defaults supplied', async () => {
    const { askForward } = await import('../src/commands/wizard.js');
    const def: Partial<Tunnel> = {
      type: 'local',
      remotePort: 81,
      remoteHost: '10.0.0.1',
      localPort: 8080,
      openBrowser: false,
    };

    q.choose = ['local'];
    q.text = ['81', '10.0.0.1', '8080'];
    q.confirm = [false];
    expect((await askForward(def)).remoteHost).toBe('10.0.0.1');

    q.choose = ['remote'];
    q.text = ['9000', 'srv', '3000'];
    expect((await askForward({ ...def, type: 'remote', remotePort: 9000 })).type).toBe('remote');

    q.choose = ['dynamic'];
    q.text = ['1080'];
    expect((await askForward({ ...def, type: 'dynamic', localPort: 1080 })).type).toBe('dynamic');
  });

  it('askForward fills empty remoteHost defaults', async () => {
    const { askForward } = await import('../src/commands/wizard.js');
    q.choose = ['local'];
    q.text = ['81', '', '']; // empty remoteHost/localPort → fallbacks
    q.confirm = [true];
    const fwd = await askForward({});
    expect(fwd.remoteHost).toBe('127.0.0.1');
  });

  it('askMeta with provided defaults', async () => {
    q.text = ['kept-name', 'kept-desc', 'a,b'];
    const { askMeta } = await import('../src/commands/wizard.js');
    const m = await askMeta({ name: 'old', description: 'd', tags: ['x'] }, () => false);
    expect(m.name).toBe('kept-name');
  });
});

describe('config: validate + merge + manageable branches', () => {
  const writeConfig = (c: string): void => {
    const dir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config'), c);
  };

  it('addConfigHost: alias validate rejects invalid + existing', async () => {
    writeConfig('Host taken\n    HostName 1.1.1.1\n');
    // first run: invalid alias triggers the !isValidSshAlias branch
    q.text = ['*bad*', '1.2.3.4', 'u', '', '', ''];
    const c = await import('../src/commands/config.js');
    await c.addConfigHost();
    // second run: existing alias triggers the getHost branch
    vi.resetModules();
    setupMocks();
    writeConfig('Host taken\n    HostName 1.1.1.1\n');
    q.text = ['taken', '1.2.3.4', 'u', '', '', ''];
    const c2 = await import('../src/commands/config.js');
    await c2.addConfigHost();
  });

  it('editConfigHost preserves non-standard params (mergeParams sort)', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n    ProxyCommand nc %h %p\n');
    q.text = ['2.2.2.2', 'u', '', '', ''];
    const { editConfigHost } = await import('../src/commands/config.js');
    await editConfigHost('h1');
    const cfg = await import('../src/ssh-config/index.js');
    const h = cfg.getHost('h1');
    expect(h?.hostName).toBe('2.2.2.2');
    expect(h?.params.some((p) => p.key === 'ProxyCommand')).toBe(true);
  });
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

describe('vault guard branches', () => {
  async function v() {
    const { vault } = await import('../src/vault/vault.js');
    return vault;
  }

  it('enableTouchId returns false when locked / unsupported', async () => {
    const vault = await v();
    expect(vault.enableTouchId()).toBe(false); // no vault yet
    vault.setup('m'); // touchid mock unsupported → enableTouchId false
    expect(vault.enableTouchId()).toBe(false);
  });

  it('unlock returns true immediately when already unlocked', async () => {
    const vault = await v();
    vault.setup('m');
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'never',
        onError: () => {},
      }),
    ).toBe(true);
  });

  it('getSecret on a missing id returns null; removeSecret no-ops', async () => {
    const vault = await v();
    vault.setup('m');
    expect(vault.getSecret('nope')).toBeNull();
    vault.removeSecret('nope');
    vault.removeSecret(null);
    const explicit = vault.setSecret('pw', 'fixed-id');
    expect(explicit).toBe('fixed-id');
  });

  it('rekey throws when locked', async () => {
    const vault = await v();
    vault.setup('m');
    vault.lock();
    expect(() => vault.rekey('new')).toThrow();
  });
});
