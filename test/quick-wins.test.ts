import { describe, it, expect, beforeEach, vi } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('utils/net — port probes', () => {
  it('detects a bound port as busy and finds a free one above it', async () => {
    const { isPortFree, findFreePort } = await import('../src/utils/net.js');
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as net.AddressInfo).port;

    expect(await isPortFree(port)).toBe(false);
    const free = await findFreePort(port + 1, 200);
    expect(free).not.toBeNull();
    expect(free).toBeGreaterThan(port);
    expect(await isPortFree(free as number)).toBe(true);

    await new Promise<void>((r) => srv.close(() => r()));
  });

  it('rejects invalid ports', async () => {
    const { isPortFree } = await import('../src/utils/net.js');
    expect(await isPortFree(0)).toBe(false);
    expect(await isPortFree(70_000)).toBe(false);
    expect(await isPortFree(-1)).toBe(false);
  });
});

describe('tunnel clone', () => {
  const baseTunnel = {
    kind: 'tunnel' as const,
    type: 'local' as const,
    localPort: 0,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    host: '10.0.0.5',
    user: 'root',
    sshPort: 22,
    auth: 'agent' as const,
    keyPath: null,
    secretId: 'secret-1',
    hostMode: 'manual' as const,
    sshHost: '',
    openBrowser: true,
    description: 'web',
    tags: ['prod'],
  };

  it('clones under an explicit name, copying fields and dropping the vault secret', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'web', localPort: 18080 });

    await cloneTunnelFlow('web', 'web-staging');
    const clone = tunnels.findByName('web-staging');

    expect(clone).toBeTruthy();
    expect(clone?.type).toBe('local');
    expect(clone?.remotePort).toBe(80);
    expect(clone?.host).toBe('10.0.0.5');
    expect(clone?.tags).toEqual(['prod']);
    expect(clone?.secretId).toBeNull(); // never shares a vault blob
  });

  it('auto-names the copy when no name is given', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'db', localPort: 15432 });

    await cloneTunnelFlow('db');
    expect(tunnels.findByName('db-copy')).toBeTruthy();
  });
});

describe('server duplicate', () => {
  it('duplicates a server under a new alias', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { duplicateServerFlow } = await import('../src/commands/servers.js');
    servers.create({
      name: 'prod',
      host: '10.0.0.1',
      user: 'deploy',
      sshPort: 2222,
      auth: 'agent',
      keyPath: null,
      secretId: null,
      kind: 'server',
      description: 'prod box',
      tags: ['eu'],
    });

    await duplicateServerFlow('prod', 'staging');
    const dup = servers.findByName('staging');

    expect(dup).toBeTruthy();
    expect(dup?.host).toBe('10.0.0.1');
    expect(dup?.user).toBe('deploy');
    expect(dup?.sshPort).toBe(2222);
    expect(dup?.tags).toEqual(['eu']);
  });
});

describe('tunnel logs', () => {
  it('tailLines returns the last N lines (trailing newline ignored)', async () => {
    const { tailLines } = await import('../src/commands/tunnels.js');
    expect(tailLines('a\nb\nc\n', 2)).toEqual(['b', 'c']);
    expect(tailLines('a\nb\nc', 2)).toEqual(['b', 'c']);
    expect(tailLines('', 5)).toEqual([]);
    expect(tailLines('x\ny\nz', 0)).toEqual(['x', 'y', 'z']);
  });

  it('tails a live session log and reports not-found / no-sessions', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    const { tunnelLogsFlow } = await import('../src/commands/tunnels.js');

    // no sessions → 0 (warn)
    expect(await tunnelLogsFlow()).toBe(0);

    const logFile = path.join(os.tmpdir(), `wssh-test-log-${process.pid}.log`);
    fs.writeFileSync(logFile, 'line1\nline2\nline3\n');
    sessions.add({
      tunnelId: 't1',
      name: 'mytun',
      pid: process.pid, // alive → not reaped
      store: 'main',
      forward: '8080→127.0.0.1:80',
      target: 'root@h',
      logFile,
    });

    const out: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    });
    const code = await tunnelLogsFlow('mytun', { tail: 2 });
    spy.mockRestore();

    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('line2');
    expect(text).toContain('line3');
    expect(text).not.toContain('line1'); // tail 2 dropped the first line

    expect(await tunnelLogsFlow('does-not-exist')).toBe(1);
    fs.unlinkSync(logFile);
  });
});
