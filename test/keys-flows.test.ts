import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('keyReferences', () => {
  it('finds servers and tunnels that point at a key path (~ and absolute match)', async () => {
    const { keyReferences } = await import('../src/commands/keys.js');
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');

    const abs = path.join(os.homedir(), '.ssh', 'id_ed25519');
    servers.create({
      name: 'web',
      host: '1.2.3.4',
      auth: 'key',
      keyPath: '~/.ssh/id_ed25519',
      kind: 'server',
    });
    tunnels.create({
      name: 'db',
      hostMode: 'manual',
      host: '1.1.1.1',
      auth: 'key',
      keyPath: abs,
      kind: 'tunnel',
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      remoteHost: '127.0.0.1',
    });

    const refs = keyReferences('~/.ssh/id_ed25519');
    const names = refs.map((r) => r.name).sort();
    expect(names).toEqual(['db', 'web']);
    expect(keyReferences('~/.ssh/nonexistent')).toEqual([]);
  });
});
