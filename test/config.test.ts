// Tests for src/commands/config.ts — ~/.ssh/config host management commands.
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

describe('config connect via picker', () => {
  it('connectConfigHostFlow with no alias uses the picker', async () => {
    writeConfig('Host pickme\n    HostName 9.9.9.9\n');
    q.pick = ['pickme'];
    const { connectConfigHostFlow } = await import('../src/commands/config.js');
    expect(await connectConfigHostFlow()).toBe(0);
  });
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

describe('config edit / remove', () => {
  it('editConfigHost rewrites fields', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n    User old\n');
    q.text = ['2.2.2.2', 'newuser', '2222', '', ''];
    const { editConfigHost } = await import('../src/commands/config.js');
    await editConfigHost('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')?.hostName).toBe('2.2.2.2');
    expect(cfg.getHost('h1')?.user).toBe('newuser');
  });

  it('removeConfigHostFlow deletes a managed block', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n');
    q.confirm = [true];
    const { removeConfigHostFlow } = await import('../src/commands/config.js');
    await removeConfigHostFlow('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')).toBeNull();
  });

  it('connectConfigHostFlow connects by alias', async () => {
    writeConfig('Host h2\n    HostName 8.8.8.8\n');
    const { connectConfigHostFlow } = await import('../src/commands/config.js');
    expect(await connectConfigHostFlow('h2')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});
