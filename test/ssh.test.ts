import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { buildRunArgs, targetOptions, destination, forwardFlags } from '../src/ssh/args.js';
import { checkTcp, resolveEndpoint } from '../src/ssh/features.js';
import type { ConnectionTarget, Tunnel } from '../src/core/types.js';

const manual = (o: Partial<ConnectionTarget> = {}): ConnectionTarget => ({
  hostMode: 'manual',
  sshHost: '',
  host: '203.0.113.7',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  ...o,
});

describe('args extras', () => {
  it('destination shapes', () => {
    expect(destination(manual({ user: 'deploy', host: 'h' }))).toBe('deploy@h');
    expect(destination(manual({ hostMode: 'sshconfig', sshHost: 'alias' }))).toBe('alias');
  });

  it('targetOptions omits -p for ssh-config hosts but keeps robustness opts', () => {
    const a = targetOptions(manual({ hostMode: 'sshconfig', sshHost: 'x' }));
    expect(a).not.toContain('-p');
    expect(a.join(' ')).toContain('ConnectTimeout=15');
  });

  it('targetOptions adds -p only for non-default ports', () => {
    expect(targetOptions(manual({ sshPort: 22 }))).not.toContain('-p');
    expect(targetOptions(manual({ sshPort: 2222 }))).toContain('2222');
  });

  it('buildRunArgs appends -- command', () => {
    const a = buildRunArgs(manual(), ['uptime', '-p']);
    expect(a.slice(-3)).toEqual(['--', 'uptime', '-p']);
  });

  it('forwardFlags remote defaults localhost', () => {
    const t = { type: 'remote', remotePort: 9000, remoteHost: '', localPort: 3000 } as Tunnel;
    expect(forwardFlags(t)).toEqual(['-R', '9000:localhost:3000']);
  });

  it('key auth pins the identity with IdentitiesOnly=yes right after -i', () => {
    const a = targetOptions(manual({ auth: 'key', keyPath: '/home/me/.ssh/id_ed25519' }));
    const i = a.indexOf('-i');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(a[i + 1]).toBe('/home/me/.ssh/id_ed25519');
    expect(a[i + 2]).toBe('-o');
    expect(a[i + 3]).toBe('IdentitiesOnly=yes');
  });

  it('agent and password auth never add IdentitiesOnly', () => {
    expect(targetOptions(manual({ auth: 'agent' })).join(' ')).not.toContain('IdentitiesOnly');
    expect(targetOptions(manual({ auth: 'password' })).join(' ')).not.toContain('IdentitiesOnly');
  });
});

describe('checkTcp', () => {
  it('reports an open port as reachable', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const res = await checkTcp('127.0.0.1', port, 2000);
      expect(res.open).toBe(true);
      expect(res.port).toBe(port);
    } finally {
      server.close();
    }
  });

  it('reports a closed port as unreachable', async () => {
    const res = await checkTcp('127.0.0.1', 1, 1500);
    expect(res.open).toBe(false);
  });

  it('treats an invalid port as unreachable without throwing', async () => {
    expect((await checkTcp('127.0.0.1', 70000, 1000)).open).toBe(false);
  });
});

describe('resolveEndpoint', () => {
  it('manual mode returns host + ssh port directly', () => {
    expect(resolveEndpoint(manual({ host: '1.2.3.4', sshPort: 2200 }))).toEqual({
      host: '1.2.3.4',
      port: 2200,
    });
  });
});
