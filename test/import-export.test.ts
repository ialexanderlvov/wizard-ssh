// Tests for src/commands/import-export.ts — export/import bundles and the import/export menu.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';

const exportFile = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-exp-')), 'bundle.json');

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

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  cmdMocks();
});

describe('export / import', () => {
  it('round-trips servers + tunnels (merge keeps both, renames on collision)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    servers.create({ name: 'web', host: '1.2.3.4', kind: 'server' });
    tunnels.create({ name: 'npm', type: 'local', localPort: 8181, remotePort: 81, kind: 'tunnel' });
    const { exportData } = await import('../src/commands/import-export.js');
    const file = exportData(exportFile());
    expect(fs.existsSync(file)).toBe(true);

    // fresh machine with a name clash → merge renames
    vi.resetModules();
    freshHome();
    const { servers: s2 } = await import('../src/store/servers.store.js');
    s2.create({ name: 'web', host: '9.9.9.9', kind: 'server' });
    const { importData } = await import('../src/commands/import-export.js');
    await importData(file); // merge (non-TTY → default)
    const names = s2
      .all()
      .map((s) => s.name)
      .sort();
    expect(names).toContain('web');
    expect(names.some((n) => n.startsWith('web-'))).toBe(true);
  });

  it('--replace upserts servers into ~/.ssh/config and hard-replaces tunnels', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    servers.create({ name: 'only', host: '1.1.1.1', kind: 'server' });
    tunnels.create({
      name: 'kept-tunnel',
      type: 'local',
      localPort: 7000,
      remotePort: 70,
      kind: 'tunnel',
    });
    const { exportData } = await import('../src/commands/import-export.js');
    const file = exportData(exportFile());

    vi.resetModules();
    freshHome();
    const { servers: s2 } = await import('../src/store/servers.store.js');
    const { tunnels: t2 } = await import('../src/store/tunnels.store.js');
    // A pre-existing config host + a tunnel that import --replace will overwrite.
    s2.create({ name: 'pre-existing', host: '2.2.2.2', kind: 'server' });
    t2.create({
      name: 'old-tunnel',
      type: 'local',
      localPort: 9999,
      remotePort: 99,
      kind: 'tunnel',
    });
    const { importData } = await import('../src/commands/import-export.js');
    await importData(file, { replace: true });

    // Servers: replaceAll UPSERTS — the imported alias is present, and the
    // pre-existing config host is NOT wiped (config is the source of truth).
    expect(s2.findByName('only')).not.toBeNull();
    expect(s2.findByName('only')?.host).toBe('1.1.1.1');
    expect(s2.findByName('pre-existing')).not.toBeNull();
    expect(
      s2
        .all()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['only', 'pre-existing']);

    // Tunnels: still a hard replace — the imported list wins, old ones vanish.
    expect(t2.all().map((t) => t.name)).toEqual(['kept-tunnel']);
  });

  it('restores an encrypted vault when none exists locally', async () => {
    vi.doMock('../src/vault/touchid.js', () => ({
      isSupported: () => false,
      authenticate: () => false,
      storeKey: () => false,
      loadKey: () => null,
      deleteKey: () => {},
    }));
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master');
    vault.setSecret('pw');
    const { exportData } = await import('../src/commands/import-export.js');
    const file = exportData(exportFile());

    vi.resetModules();
    freshHome();
    vi.doMock('../src/vault/touchid.js', () => ({
      isSupported: () => false,
      authenticate: () => false,
      storeKey: () => false,
      loadKey: () => null,
      deleteKey: () => {},
    }));
    const { importData } = await import('../src/commands/import-export.js');
    await importData(file, { replace: true });
    const { vault: v2 } = await import('../src/vault/vault.js');
    expect(v2.exists()).toBe(true);
  });

  it('rejects a missing file and a non-bundle file', async () => {
    const { importData } = await import('../src/commands/import-export.js');
    await importData('/no/such/bundle.json');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    const bad = exportFile();
    fs.writeFileSync(bad, JSON.stringify({ not: 'a bundle' }));
    await importData(bad);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
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

describe('import/export menu import branch', () => {
  it('imports from a chosen file', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'x', host: '1.1.1.1', kind: 'server' });
    const { exportData, importExportMenu } = await import('../src/commands/import-export.js');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'b.json');
    exportData(file);
    q.choose = ['import'];
    q.text = [file];
    await expect(importExportMenu()).resolves.toBeUndefined();
  });
});

describe('#4 a nameless-but-aliased imported server does not abort the import', () => {
  it('imports both a named server and one that only has sshHost', async () => {
    const { importData } = await import('../src/commands/import-export.js');
    const bundle = {
      app: 'wizard-ssh',
      version: 1,
      exportedAt: '2020-01-01T00:00:00.000Z',
      servers: [
        {
          kind: 'server',
          name: 'ok-host',
          hostMode: 'sshconfig',
          host: '5.6.7.8',
          user: 'deploy',
          sshPort: 22,
          auth: 'agent',
          keyPath: null,
          secretId: null,
        },
        // No `name`, only `sshHost` — passes serverIsSafe (name ?? sshHost) and
        // used to crash the add loop on `nameExists(undefined)`.
        {
          kind: 'server',
          sshHost: 'aliasonly',
          hostMode: 'sshconfig',
          host: '9.9.9.9',
          user: 'x',
          sshPort: 22,
          auth: 'agent',
        },
      ],
      tunnels: [],
      settings: {},
    };
    const file = path.join(os.homedir(), 'nameless-bundle.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    await expect(importData(file, { replace: false })).resolves.toBeUndefined();

    const { servers } = await import('../src/store/servers.store.js');
    const names = servers.all().map((s) => s.name);
    expect(names).toContain('ok-host');
    expect(names).toContain('aliasonly');
  });
});

describe('L-2 import does not rewind local usage stats', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });
  it('usage.merge keeps the higher useCount and later lastUsedAt', async () => {
    const { usage } = await import('../src/store/usage.store.js');
    usage.set('box', { useCount: 10, lastUsedAt: '2026-06-01T00:00:00.000Z' });
    usage.merge('box', { useCount: 2, lastUsedAt: '2020-01-01T00:00:00.000Z' });
    expect(usage.get('box').useCount).toBe(10); // not rewound to 2
    expect(usage.get('box').lastUsedAt).toBe('2026-06-01T00:00:00.000Z'); // not rewound
    usage.merge('box', { useCount: 25, lastUsedAt: '2026-06-09T00:00:00.000Z' });
    expect(usage.get('box').useCount).toBe(25); // advances
  });
});
