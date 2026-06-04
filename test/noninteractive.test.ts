import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('addServerNonInteractive', () => {
  it('creates a server from flags', async () => {
    const { addServerNonInteractive } = await import('../src/commands/noninteractive.js');
    const { servers } = await import('../src/store/servers.store.js');
    addServerNonInteractive('web', { host: '10.0.0.5', user: 'deploy', port: '2222' });
    const s = servers.findById('web');
    expect(s?.host).toBe('10.0.0.5');
    expect(s?.user).toBe('deploy');
    expect(s?.sshPort).toBe(2222);
  });

  it('rejects password auth, missing host, and key auth without a key', async () => {
    const { addServerNonInteractive } = await import('../src/commands/noninteractive.js');
    expect(() => addServerNonInteractive('p', { host: '1.1.1.1', auth: 'password' })).toThrow();
    expect(() => addServerNonInteractive('q', {})).toThrow();
    expect(() => addServerNonInteractive('k', { host: '1.1.1.1', auth: 'key' })).toThrow();
    expect(() => addServerNonInteractive('', { host: '1.1.1.1' })).toThrow();
  });

  it('accepts key auth when the key file exists', async () => {
    const { addServerNonInteractive } = await import('../src/commands/noninteractive.js');
    const { servers } = await import('../src/store/servers.store.js');
    const keyFile = path.join(os.homedir(), 'mykey');
    fs.writeFileSync(keyFile, 'x');
    addServerNonInteractive('kb', { host: '2.2.2.2', auth: 'key', key: keyFile });
    expect(servers.findById('kb')?.keyPath).toBe(keyFile);
  });
});

describe('addTunnelNonInteractive', () => {
  it('creates a local tunnel off a config alias', async () => {
    const { addTunnelNonInteractive } = await import('../src/commands/noninteractive.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    addTunnelNonInteractive({ alias: 'prod', type: 'local', local: '8080', remotePort: '80' });
    const t = tunnels.all()[0];
    expect(t?.type).toBe('local');
    expect(t?.localPort).toBe(8080);
    expect(t?.remotePort).toBe(80);
    expect(t?.sshHost).toBe('prod');
  });

  it('requires a local port and a remote port for non-dynamic forwards', async () => {
    const { addTunnelNonInteractive } = await import('../src/commands/noninteractive.js');
    expect(() =>
      addTunnelNonInteractive({ alias: 'prod', type: 'local', remotePort: '80' }),
    ).toThrow();
    expect(() =>
      addTunnelNonInteractive({ alias: 'prod', type: 'local', local: '8080' }),
    ).toThrow();
    expect(() =>
      addTunnelNonInteractive({ type: 'local', local: '8080', remotePort: '80' }),
    ).toThrow();
  });

  it('creates a dynamic tunnel without a remote port', async () => {
    const { addTunnelNonInteractive } = await import('../src/commands/noninteractive.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    addTunnelNonInteractive({ alias: 'prod', type: 'dynamic', local: '1080' });
    expect(tunnels.all()[0]?.type).toBe('dynamic');
  });
});
