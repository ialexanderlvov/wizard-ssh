import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, PICK_BACK, promptMock, stripAnsi } from './helpers.js';
import { renderEntityTable, renderConfigHostsTable } from '../src/ui/tables.js';
import type { Server, SshConfigHost, Tunnel } from '../src/core/types.js';

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
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({
    runInteractive: async () => 0,
    runTunnel: async () => 0,
    runSshInherit: async () => 0,
    runProgram: async () => 0,
    preflight: () => null,
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
  vi.spyOn(console, 'log').mockImplementation(() => {});
  cmdMocks();
});

describe('tables branches', () => {
  const server: Server = {
    kind: 'server',
    id: 's',
    name: 'srv',
    description: 'desc',
    tags: ['p'],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 2,
    hostMode: 'manual',
    sshHost: '',
    host: '1.1.1.1',
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: null,
  };
  const tunnel: Tunnel = {
    ...server,
    kind: 'tunnel',
    description: '',
    tags: [],
    type: 'local',
    localPort: 81,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    openBrowser: true,
  };
  it('entity table: with and without description/tags', () => {
    const out = stripAnsi(renderEntityTable([server, tunnel]));
    expect(out).toContain('srv');
  });
  it('config table: identityFile present and absent', () => {
    const withId: SshConfigHost = {
      alias: 'a',
      hostName: '1.1.1.1',
      user: 'u',
      port: '22',
      identityFile: '~/.ssh/id',
      proxyJump: '',
      params: [],
      source: '',
    };
    const without: SshConfigHost = {
      ...withId,
      alias: 'b',
      identityFile: '',
      user: '',
      port: '',
      hostName: '',
    };
    const out = stripAnsi(renderConfigHostsTable([withId, without]));
    expect(out).toContain('~/.ssh/id');
  });
});

describe('parser branches', () => {
  it('skips params before any Host and resolves relative + absolute Include', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'rel.conf'), 'Host relhost\n    HostName 3.3.3.3\n');
    writeConfig(
      'ForwardAgent yes\nInclude rel.conf\nInclude /no/such/abs/path\nHost base\n    HostName 1.1.1.1\n',
    );
    const cfg = await import('../src/ssh-config/index.js');
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('relhost'); // relative include resolved against ~/.ssh
    expect(aliases).toContain('base');
  });
});

describe('writer trim/swallow branches', () => {
  it('upsert trims trailing comment/blank lines of a block', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n\n# trailing\n');
    q.text = ['2.2.2.2', 'u', '', '', ''];
    const { editConfigHost } = await import('../src/commands/config.js');
    await editConfigHost('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')?.hostName).toBe('2.2.2.2');
  });

  it('remove swallows the trailing blank line between blocks', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n\nHost h2\n    HostName 2.2.2.2\n');
    q.confirm = [true];
    const { removeConfigHostFlow } = await import('../src/commands/config.js');
    await removeConfigHostFlow('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')).toBeNull();
    expect(cfg.getHost('h2')?.hostName).toBe('2.2.2.2');
  });
});

describe('search early returns + decline', () => {
  it('blank query returns immediately', async () => {
    const { searchFlow } = await import('../src/commands/search.js');
    await expect(searchFlow('   ')).resolves.toBeUndefined();
  });
  it('no results warns', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web', host: '1.1.1.1', kind: 'server' });
    const { searchFlow } = await import('../src/commands/search.js');
    await expect(searchFlow('zzzznomatch')).resolves.toBeUndefined();
  });
  it('declining the connect prompt returns', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web', host: '1.1.1.1', kind: 'server' });
    q.pick = [PICK_BACK]; // Esc on the connect picker → just view, do not connect
    const { searchFlow } = await import('../src/commands/search.js');
    await expect(searchFlow('web')).resolves.toBeUndefined();
  });
});

describe('import/export branches', () => {
  it('export without a vault, then import warns when a local vault exists', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'x', host: '1.1.1.1', kind: 'server' });
    const { exportData, importData } = await import('../src/commands/import-export.js');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'b.json');
    exportData(file); // no vault → bundle.vault undefined branch

    // now a local vault exists → import should NOT clobber it
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    await importData(file, { replace: true });
    expect(vault.exists()).toBe(true);
  });
  it('importExportMenu back option', async () => {
    q.choose = ['back'];
    const { importExportMenu } = await import('../src/commands/import-export.js');
    await expect(importExportMenu()).resolves.toBeUndefined();
  });
});

describe('settings/config picker branches', () => {
  it('vaultFlow with no vault offers setup then exits', async () => {
    // First iteration: only the «setup» row is offered → create the vault.
    // Second iteration: Esc to leave the loop menu.
    q.pick = ['setup', PICK_BACK];
    q.secret = ['mmmm', 'mmmm']; // matching passphrases for ensureVaultSetup
    const { vaultFlow } = await import('../src/commands/settings.js');
    await expect(vaultFlow()).resolves.toBeUndefined();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
  });

  it('editConfigHost with no alias and no hosts → picker returns null', async () => {
    const { editConfigHost } = await import('../src/commands/config.js');
    await expect(editConfigHost()).resolves.toBeUndefined();
  });
});
