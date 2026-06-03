import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

const dataDir = (): string => path.join(os.homedir(), '.wizard-ssh');
const serversJson = (): string => path.join(dataDir(), 'servers.json');
const cfgPath = (): string => path.join(os.homedir(), '.ssh', 'config');
const readCfg = (): string => {
  try {
    return fs.readFileSync(cfgPath(), 'utf8');
  } catch {
    return '';
  }
};

function writeServersJson(items: unknown[]): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(serversJson(), JSON.stringify({ version: 1, items }));
}

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('servers.json → ~/.ssh/config migration', () => {
  it('migrates manual servers into config with #wssh + usage, then retires servers.json', async () => {
    writeServersJson([
      {
        id: '1',
        name: 'web prod', // not a valid alias → slugified
        hostMode: 'manual',
        host: '1.2.3.4',
        user: 'root',
        sshPort: 2222,
        auth: 'password',
        secretId: 'sec',
        keyPath: null,
        description: 'main',
        tags: ['p'],
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-02-01T00:00:00.000Z',
        useCount: 4,
      },
    ]);
    const { migrateServersToConfig } = await import('../src/store/migrate-servers.js');
    const res = migrateServersToConfig();
    expect(res?.count).toBe(1);

    const text = readCfg();
    expect(text).toMatch(/Host web-prod/);
    expect(text).toContain('HostName 1.2.3.4');
    expect(text).toContain('Port 2222');
    expect(text).toContain('#wssh ');

    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.findByName('web-prod');
    expect(s?.auth).toBe('password');
    expect(s?.secretId).toBe('sec');
    expect(s?.useCount).toBe(4);
    expect(s?.lastUsedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(s?.createdAt).toBe('2026-01-01T00:00:00.000Z');

    // servers.json retired → idempotent
    expect(fs.existsSync(serversJson())).toBe(false);
    expect(fs.existsSync(serversJson() + '.migrated')).toBe(true);
    expect(migrateServersToConfig()).toBeNull();
  });

  it('annotates an existing config host for an sshconfig-mode legacy server', async () => {
    fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true });
    fs.writeFileSync(cfgPath(), 'Host homelab\n  HostName 10.0.0.1\n  User me\n');
    writeServersJson([
      {
        id: '2',
        name: 'homelab',
        hostMode: 'sshconfig',
        sshHost: 'homelab',
        host: '',
        user: '',
        sshPort: 22,
        auth: 'agent',
        secretId: null,
        keyPath: null,
        description: 'lab',
        tags: ['home'],
        createdAt: '2026-03-03T00:00:00.000Z',
        lastUsedAt: null,
        useCount: 0,
      },
    ]);
    const { migrateServersToConfig } = await import('../src/store/migrate-servers.js');
    migrateServersToConfig();

    const text = readCfg();
    expect(text).toContain('HostName 10.0.0.1'); // existing params preserved
    expect(text).toContain('User me');
    expect(text).toContain('#wssh ');

    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.findByName('homelab');
    expect(s?.description).toBe('lab');
    expect(s?.tags).toEqual(['home']);
    expect(s?.host).toBe('10.0.0.1'); // came from the existing config block
  });

  it('does not clobber a multi-alias config host; creates a separate alias instead', async () => {
    fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true });
    fs.writeFileSync(
      cfgPath(),
      'Host work alt\n  HostName 10.0.0.5\n  IdentityFile ~/.ssh/id_work\n',
    );
    writeServersJson([
      {
        id: '1',
        name: 'work',
        hostMode: 'sshconfig',
        sshHost: 'work', // matches a MULTI-alias (non-manageable) block
        host: '',
        user: '',
        sshPort: 22,
        auth: 'agent',
        secretId: null,
        keyPath: null,
        description: 'lab',
        tags: [],
        createdAt: '',
        lastUsedAt: null,
        useCount: 0,
      },
    ]);
    const { migrateServersToConfig } = await import('../src/store/migrate-servers.js');
    migrateServersToConfig();
    const text = readCfg();
    expect(text).toContain('Host work alt'); // original multi-alias block untouched
    expect(text).toContain('IdentityFile ~/.ssh/id_work');
    const { servers } = await import('../src/store/servers.store.js');
    expect(servers.findByName('work-2')?.description).toBe('lab'); // separate annotated alias
  });

  it('returns null when there is no servers.json', async () => {
    const { migrateServersToConfig } = await import('../src/store/migrate-servers.js');
    expect(migrateServersToConfig()).toBeNull();
  });
});
