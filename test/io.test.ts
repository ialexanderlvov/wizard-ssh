import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

const exportFile = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-exp-')), 'bundle.json');

beforeEach(() => {
  vi.resetModules();
  freshHome();
  vi.spyOn(console, 'log').mockImplementation(() => {});
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

  it('--replace replaces all lists', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'only', host: '1.1.1.1', kind: 'server' });
    const { exportData } = await import('../src/commands/import-export.js');
    const file = exportData(exportFile());

    vi.resetModules();
    freshHome();
    const { servers: s2 } = await import('../src/store/servers.store.js');
    s2.create({ name: 'pre-existing', host: '2.2.2.2', kind: 'server' });
    const { importData } = await import('../src/commands/import-export.js');
    await importData(file, { replace: true });
    expect(s2.all().map((s) => s.name)).toEqual(['only']);
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
