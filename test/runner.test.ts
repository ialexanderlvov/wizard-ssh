import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Hoisted so the (also-hoisted) vi.mock factories can see them.
const h = vi.hoisted(() => {
  const state = { code: 0 as number | null, delay: 2, mode: 'close' as 'close' | 'error' };
  const cmds = new Set<string>(['ssh', 'sshpass', 'scp', 'ssh-copy-id']);
  const spawn = vi.fn(() => {
    const map: Record<string, Array<(...a: unknown[]) => void>> = {};
    const child = {
      killed: false,
      kill: vi.fn(() => {
        child.killed = true;
      }),
      unref: vi.fn(),
      on(ev: string, cb: (...a: unknown[]) => void) {
        (map[ev] ||= []).push(cb);
        return child;
      },
      once(ev: string, cb: (...a: unknown[]) => void) {
        (map[ev] ||= []).push(cb);
        return child;
      },
      removeListener() {
        return child;
      },
    };
    setTimeout(() => {
      if (state.mode === 'error') (map.error ?? []).forEach((f) => f(new Error('spawn failed')));
      else (map.close ?? []).forEach((f) => f(state.code));
    }, state.delay);
    return child;
  });
  return { state, cmds, spawn };
});

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  return { ...actual, spawn: h.spawn };
});
vi.mock('../src/utils/exec.js', async (orig) => {
  const actual = await orig<typeof import('../src/utils/exec.js')>();
  return { ...actual, commandExists: (c: string) => h.cmds.has(c) };
});

import {
  preflight,
  runInteractive,
  runTunnel,
  runSshInherit,
  runProgram,
} from '../src/ssh/runner.js';
import type { Server, Tunnel } from '../src/core/types.js';

const server = (o: Partial<Server> = {}): Server => ({
  kind: 'server',
  id: 's',
  name: 'box',
  description: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
  lastUsedAt: null,
  useCount: 0,
  hostMode: 'manual',
  sshHost: '',
  host: '1.2.3.4',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  linkedSshHost: null,
  ...o,
});

const tunnel = (o: Partial<Tunnel> = {}): Tunnel => ({
  ...server(o as Partial<Server>),
  kind: 'tunnel',
  type: 'local',
  localPort: 8181,
  remoteHost: '127.0.0.1',
  remotePort: 81,
  openBrowser: false,
  ...o,
});

beforeEach(() => {
  h.spawn.mockClear();
  h.state.code = 0;
  h.state.delay = 2;
  h.state.mode = 'close';
  h.cmds.clear();
  ['ssh', 'sshpass', 'scp', 'ssh-copy-id'].forEach((c) => h.cmds.add(c));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('preflight', () => {
  it('passes for a valid agent server', () => {
    expect(preflight(server())).toBeNull();
  });
  it('reports ssh missing', () => {
    h.cmds.delete('ssh');
    expect(preflight(server())).toMatch(/ssh не найден/);
  });
  it('reports missing host / alias', () => {
    expect(preflight(server({ host: '' }))).toMatch(/IP\/домен/);
    expect(preflight(server({ hostMode: 'sshconfig', sshHost: '' }))).toMatch(/алиас/);
  });
  it('validates forward ports for tunnels', () => {
    expect(preflight(tunnel(), { forwardPorts: { local: 0, remote: 81, type: 'local' } })).toMatch(
      /локальный порт/,
    );
    expect(
      preflight(tunnel(), { forwardPorts: { local: 8181, remote: 0, type: 'local' } }),
    ).toMatch(/удалённый порт/);
    expect(
      preflight(tunnel(), { forwardPorts: { local: 1080, remote: null, type: 'dynamic' } }),
    ).toBeNull();
  });
  it('checks key existence', () => {
    expect(preflight(server({ auth: 'key', keyPath: null }))).toMatch(/путь к ключу/);
    expect(preflight(server({ auth: 'key', keyPath: '/no/such/key' }))).toMatch(/не найден/);
    const real = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'k-')), 'id');
    fs.writeFileSync(real, 'x');
    expect(preflight(server({ auth: 'key', keyPath: real }))).toBeNull();
  });
  it('requires sshpass for password auth', () => {
    h.cmds.delete('sshpass');
    expect(preflight(server({ auth: 'password' }))).toMatch(/sshpass/);
  });
});

describe('runners (mocked spawn)', () => {
  it('runInteractive resolves with exit code', async () => {
    expect(await runInteractive(server())).toBe(0);
    expect(h.spawn).toHaveBeenCalledOnce();
    expect(h.spawn.mock.calls[0]?.[0]).toBe('ssh');
  });

  it('runInteractive wraps password auth in sshpass', async () => {
    await runInteractive(server({ auth: 'password' }), 's3cret');
    expect(h.spawn.mock.calls[0]?.[0]).toBe('sshpass');
  });

  it('runInteractive returns 1 on preflight failure without spawning', async () => {
    h.cmds.delete('ssh');
    expect(await runInteractive(server())).toBe(1);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('runTunnel success and failure codes', async () => {
    expect(await runTunnel(tunnel())).toBe(0);
    h.state.code = 255;
    expect(await runTunnel(tunnel())).toBe(255);
  });

  it('runSshInherit and runProgram pass through', async () => {
    expect(await runSshInherit(['-V'])).toBe(0);
    expect(await runProgram('scp', ['a', 'b'])).toBe(0);
    expect(h.spawn.mock.calls.at(-1)?.[0]).toBe('scp');
  });

  it('handles a spawn error', async () => {
    h.state.mode = 'error';
    expect(await runInteractive(server())).toBe(1);
  });
});

describe('runTunnel "up" box (fake timers)', () => {
  it('renders the local box and opens the browser', async () => {
    vi.useFakeTimers();
    try {
      h.state.delay = 5000; // close fires after the 1500ms up-timer
      const p = runTunnel(tunnel({ type: 'local', openBrowser: true }));
      await vi.advanceTimersByTimeAsync(1600); // fire the up-box timer
      // browser opener is spawned in addition to ssh
      expect(
        h.spawn.mock.calls.some((c) => c[0] === 'open' || c[0] === 'xdg-open' || c[0] === 'cmd'),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(4000); // fire close
      expect(await p).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the dynamic and remote boxes', async () => {
    vi.useFakeTimers();
    try {
      h.state.delay = 5000;
      const d = runTunnel(tunnel({ type: 'dynamic', localPort: 1080, openBrowser: false }));
      await vi.advanceTimersByTimeAsync(1600);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await d).toBe(0);

      const r = runTunnel(
        tunnel({ type: 'remote', remotePort: 9000, remoteHost: 'localhost', localPort: 3000 }),
      );
      await vi.advanceTimersByTimeAsync(1600);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await r).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
