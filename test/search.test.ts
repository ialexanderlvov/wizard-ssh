import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterConfigHosts, filterEntities } from '../src/search/index.js';
import type { Server, SshConfigHost } from '../src/core/types.js';
import { freshHome } from './helpers.js';

const host = (alias: string, hostName = '', user = ''): SshConfigHost => ({
  alias,
  hostName,
  user,
  port: '',
  identityFile: '',
  proxyJump: '',
  params: [],
  source: '',
});

describe('filterConfigHosts', () => {
  const hosts = [host('web-proxy', '10.0.0.1', 'ada'), host('db-main', '10.0.0.2', 'bob')];
  it('empty term returns all', () => {
    expect(filterConfigHosts(hosts, '')).toHaveLength(2);
    expect(filterConfigHosts(hosts, undefined)).toHaveLength(2);
  });
  it('matches by alias / hostName / user', () => {
    expect(filterConfigHosts(hosts, 'web').map((h) => h.alias)).toContain('web-proxy');
    expect(filterConfigHosts(hosts, 'bob').map((h) => h.alias)).toContain('db-main');
  });
});

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
    hostMode: 'manual',
    sshHost: '',
    host: '10.0.0.1',
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: null,
  });
  it('no match → empty', () => {
    expect(filterEntities([mk('alpha')], 'zzzzzz')).toEqual([]);
  });
});

describe('searchEverything (isolated home)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('aggregates matches across servers, tunnels and config', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web-prod', host: '1.2.3.4', kind: 'server' });
    servers.create({ name: 'db-prod', host: '1.2.3.5', kind: 'server' });
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({
      name: 'web-tunnel',
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      kind: 'tunnel',
    });

    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'config'), 'Host web-host\n    HostName 9.9.9.9\n');

    const { searchEverything } = await import('../src/search/index.js');
    const r = searchEverything('web');
    expect(r.servers.map((s) => s.name)).toContain('web-prod');
    expect(r.tunnels.map((t) => t.name)).toContain('web-tunnel');
    expect(r.configHosts.map((h) => h.alias)).toContain('web-host');
    expect(r.total).toBe(r.servers.length + r.tunnels.length + r.configHosts.length);

    expect(searchEverything('nomatchxyz').total).toBe(0);
  });
});
