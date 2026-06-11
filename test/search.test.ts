import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterEntities } from '../src/search/index.js';
import type { Server } from '../src/core/types.js';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

describe('filterEntities edge', () => {
  const mk = (name: string): Server => ({
    kind: 'server',
    id: name,
    name,
    description: '',
    tags: [],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'sshconfig',
    sshHost: name,
    host: '10.0.0.1',
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    manageable: true,
  });
  it('no match → empty', () => {
    expect(filterEntities([mk('alpha')], 'zzzzzz')).toEqual([]);
  });
  it('empty term returns all', () => {
    expect(filterEntities([mk('alpha'), mk('beta')], '')).toHaveLength(2);
    expect(filterEntities([mk('alpha'), mk('beta')], undefined)).toHaveLength(2);
  });
  it('matches by name / host / user', () => {
    const items = [mk('web-proxy'), mk('db-main')];
    items[0].host = '10.0.0.1';
    items[0].user = 'ada';
    items[1].host = '10.0.0.2';
    items[1].user = 'bob';
    expect(filterEntities(items, 'web').map((s) => s.name)).toContain('web-proxy');
    expect(filterEntities(items, 'bob').map((s) => s.name)).toContain('db-main');
  });
});

describe('searchEverything (isolated home)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('aggregates matches across servers and tunnels', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    // Servers are backed by ~/.ssh/config: create() writes a Host block.
    servers.create({ name: 'web-prod', host: '1.2.3.4', kind: 'server' });
    servers.create({ name: 'db-prod', host: '1.2.3.5', kind: 'server' });
    // Seeding via raw config text is also valid (config is the source of truth).
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.appendFileSync(path.join(sshDir, 'config'), 'Host web-host\n    HostName 9.9.9.9\n');

    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({
      name: 'web-tunnel',
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      kind: 'tunnel',
    });

    const { searchEverything } = await import('../src/search/index.js');
    const r = searchEverything('web');
    expect(r.servers.map((s) => s.name)).toContain('web-prod');
    expect(r.servers.map((s) => s.name)).toContain('web-host');
    expect(r.tunnels.map((t) => t.name)).toContain('web-tunnel');
    expect(r.total).toBe(r.servers.length + r.tunnels.length);
    expect(r).not.toHaveProperty('configHosts');

    expect(searchEverything('nomatchxyz').total).toBe(0);
  });
});

describe('fuzzy filter', () => {
  const mk = (name: string, host: string, tags: string[] = []): Server => ({
    kind: 'server',
    id: name,
    name,
    description: '',
    tags,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'manual',
    sshHost: '',
    host,
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: null,
  });
  it('finds by name/tag, empty term returns all', () => {
    const items = [mk('web-prod', '10.0.0.1', ['prod']), mk('db-stage', '10.0.0.2', ['stage'])];
    expect(filterEntities(items, '').length).toBe(2);
    expect(filterEntities(items, 'prod').map((e) => e.name)).toContain('web-prod');
    expect(filterEntities(items, 'db').map((e) => e.name)).toContain('db-stage');
  });
});

// Scaffolding from branches4.test.ts for the command-flow tests below.
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

describe('search early returns + decline', () => {
  // Scaffolding from branches4.test.ts (file-level beforeEach), scoped here.
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

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
