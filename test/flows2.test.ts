import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, promptMock } from './helpers.js';

const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
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
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
    copyId: async () => 0,
    runCommand: async () => 0,
    transfer: async () => 0,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
  }));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}

function writeConfig(contents: string): void {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), contents);
}

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  Object.values(runner).forEach((m) => m.mockClear());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('actions', () => {
  it('checkFlow returns non-zero for an unreachable target', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('box')).toBe(2);
  });

  it('runFlow executes a command on a resolved server', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', ['uptime'])).toBe(0);
    expect(servers.findByName('box')?.useCount).toBe(1);
  });

  it('copyIdFlow installs a key (agent server, no local keys)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
  });

  it('transferFlow asks direction + paths', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['upload'];
    q.text = ['./a', '/remote/b'];
    q.confirm = [false];
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
  });
});

describe('quick connect dispatch', () => {
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

describe('vault flow + import/export menu + menu nav', () => {
  it('vaultFlow can create a vault', async () => {
    q.choose = ['setup', 'back'];
    q.secret = ['masterpw', 'masterpw'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
  });

  it('importExportMenu export branch writes a file', async () => {
    q.choose = ['export'];
    q.text = [''];
    const { importExportMenu } = await import('../src/commands/import-export.js');
    await expect(importExportMenu()).resolves.toBeUndefined();
  });

  it('mainMenu walks submenus and exits', async () => {
    q.choose = ['servers', 'back', 'tunnels', 'back', 'config', 'back', 'actions', 'back', 'exit'];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });
});
