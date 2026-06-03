import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, stripAnsi } from './helpers.js';
import type { ConnectItem } from '../src/ui/rows.js';

beforeEach(() => {
  freshHome();
});

describe('unified row renderers / sorts / searches', () => {
  it('renders servers, tunnels and config-hosts as aligned emoji-free rows', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const rows = await import('../src/ui/rows.js');

    const srv = servers.create({ name: 'alpha', host: '1.2.3.4', user: 'root', kind: 'server' });
    const cfgSrv = servers.create({
      name: 'viacfg',
      hostMode: 'sshconfig',
      sshHost: 'myalias',
      kind: 'server',
    });
    const tun = tunnels.create({
      name: 'tun',
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      kind: 'tunnel',
    });

    const entities = [srv, cfgSrv, tun];
    const er = rows.entityRowRenderer(entities);
    expect(stripAnsi(er(srv))).toContain('alpha');
    expect(stripAnsi(er(cfgSrv))).toContain('viacfg'); // sshconfig branch (magenta target)
    expect(stripAnsi(er(tun))).toContain('tun'); // tunnel → forwardSummary
    expect(rows.entitySearch(srv)).toContain('alpha');
    for (const s of rows.ENTITY_SORTS) expect(typeof s.compare(srv, tun)).toBe('number');

    // config hosts (one full block, one bare alias → meta "—" branch)
    const dir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'config'),
      'Host h1\n  HostName 9.9.9.9\n  User bob\n  Port 2222\nHost h2\n',
    );
    const sshConfig = await import('../src/ssh-config/index.js');
    const hosts = sshConfig.listHosts();
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    const cr = rows.configRowRenderer(hosts);
    expect(stripAnsi(cr(hosts[0]!))).toContain(hosts[0]!.alias);
    expect(stripAnsi(cr(hosts[1]!))).toContain('—'); // no HostName → dash
    expect(rows.configSearch(hosts[0]!)).toContain(hosts[0]!.alias);
    for (const s of rows.CONFIG_SORTS)
      expect(typeof s.compare(hosts[0]!, hosts[hosts.length - 1]!)).toBe('number');

    // unified connect items (entity + config branches)
    const items: ConnectItem[] = [
      { kind: 'entity', entity: srv },
      { kind: 'entity', entity: tun },
      { kind: 'config', host: hosts[0]! },
    ];
    const conn = rows.connectRowRenderer(items);
    expect(stripAnsi(conn(items[0]!))).toContain('alpha');
    expect(stripAnsi(conn(items[1]!))).toContain('tun');
    expect(stripAnsi(conn(items[2]!))).toContain('config');
    expect(rows.connectSearch(items[0]!)).toContain('alpha');
    expect(rows.connectSearch(items[2]!)).toContain(hosts[0]!.alias);
  });
});
