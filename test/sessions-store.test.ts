import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

const DEAD_PID = 2_147_483_646; // astronomically unlikely to be live

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('sessions store', () => {
  it('pidAlive reports the current process and rejects dead/invalid pids', async () => {
    const { pidAlive } = await import('../src/store/sessions.store.js');
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(DEAD_PID)).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });

  it('reaps dead sessions on list(); add/find/remove round-trip a live one', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    sessions.add({
      tunnelId: 'alive',
      name: 'alive',
      pid: process.pid,
      store: 'main',
      forward: '8080→127.0.0.1:80',
      target: 'root@h',
      logFile: '/tmp/x.log',
    });
    sessions.add({
      tunnelId: 'dead',
      name: 'dead',
      pid: DEAD_PID,
      store: 'temp',
      forward: ':1080 SOCKS',
      target: 'root@h',
      logFile: '/tmp/y.log',
    });
    const live = sessions.list();
    expect(live.map((s) => s.tunnelId)).toEqual(['alive']); // dead one reaped
    expect(sessions.find('alive')?.name).toBe('alive');
    expect(sessions.find('dead')).toBeNull();
    sessions.remove('alive');
    expect(sessions.list()).toEqual([]);
  });

  it('adding the same tunnel twice keeps a single (latest) session', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    const base = {
      tunnelId: 't',
      name: 't',
      pid: process.pid,
      store: 'main' as const,
      forward: 'f',
      target: 'tg',
      logFile: 'l',
    };
    sessions.add(base);
    sessions.add({ ...base, pid: process.pid });
    expect(sessions.list()).toHaveLength(1);
  });
});
