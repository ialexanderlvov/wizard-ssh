import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { healthCheckAll } from '../src/ssh/features.js';
import type { FleetTarget } from '../src/ssh/features.js';
import type { ConnectionTarget } from '../src/core/types.js';

const manual = (o: Partial<ConnectionTarget>): ConnectionTarget => ({
  hostMode: 'manual',
  sshHost: '',
  host: '127.0.0.1',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  ...o,
});

describe('healthCheckAll', () => {
  it('checks many targets concurrently, preserving order, marking up/down', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const targets: FleetTarget[] = [
      { name: 'up', kind: 'server', target: manual({ sshPort: port }) },
      { name: 'down', kind: 'tunnel', target: manual({ sshPort: 1 }) },
    ];
    try {
      const res = await healthCheckAll(targets, { concurrency: 2, timeoutMs: 1500 });
      expect(res.map((r) => r.name)).toEqual(['up', 'down']); // order preserved
      expect(res[0]?.result.open).toBe(true);
      expect(res[0]?.result.port).toBe(port);
      expect(res[1]?.result.open).toBe(false);
    } finally {
      server.close();
    }
  });

  it('returns [] for no targets', async () => {
    expect(await healthCheckAll([])).toEqual([]);
  });
});
