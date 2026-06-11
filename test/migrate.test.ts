// Tests for store/migrate (and store/migrate-servers edge combinations).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

describe('migration branch combinations', () => {
  it('empty tunnels + no settings → 0', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tunnels.json'), JSON.stringify({ tunnels: [] }));
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(0);
  });

  it('non-array tunnels field → 0', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tunnels.json'), JSON.stringify({ tunnels: 'oops' }));
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(0);
  });

  it('partial legacy settings (only remoteHost)', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tunnels.json'),
      JSON.stringify({
        settings: { defaultRemoteHost: '10.9.9.9' },
        tunnels: [{ name: 't', host: '1.1.1.1', type: 'local', localPort: 1, remotePort: 1 }],
      }),
    );
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(1);
    const { settings } = await import('../src/store/settings.store.js');
    expect(settings.get().defaultRemoteHost).toBe('10.9.9.9');
    expect(settings.get().defaultUser).toBe('root'); // default kept
  });
});

describe('migration without legacy settings', () => {
  it('imports tunnels only', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tunnels.json'),
      JSON.stringify({
        tunnels: [{ name: 't', host: '1.1.1.1', type: 'local', localPort: 1, remotePort: 1 }],
      }),
    );
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(1);
  });
});
