import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

const DEAD_PID = 2_147_483_646; // astronomically unlikely to be live

// Controllable `ps` probe so we can simulate a transient failure at check time.
const psMock = vi.hoisted(() => ({
  status: 0 as number | null,
  stdout: 'Mon Jan  1 00:00:00 2024',
}));
vi.mock('../src/utils/exec.js', async (orig) => {
  const actual = await orig<typeof import('../src/utils/exec.js')>();
  return {
    ...actual,
    capture: (cmd: string, args: string[], input?: string) =>
      cmd === 'ps'
        ? { status: psMock.status, stdout: psMock.stdout, stderr: '' }
        : actual.capture(cmd, args, input),
  };
});

beforeEach(() => {
  vi.resetModules();
  freshHome();
  psMock.status = 0;
  psMock.stdout = 'Mon Jan  1 00:00:00 2024';
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

  it('keeps a live session when the ps probe is inconclusive at check time', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    // ps works at launch → a real start token is recorded…
    sessions.add({
      tunnelId: 't',
      name: 't',
      pid: process.pid, // alive
      store: 'main',
      forward: 'f',
      target: 'tg',
      logFile: 'l',
    });
    // …but fails at check time (missing/timeout) → empty token. The PID is still
    // alive, so the session must NOT be pruned (no false PID-reuse mismatch).
    psMock.status = 1;
    psMock.stdout = '';
    expect(sessions.list().map((s) => s.tunnelId)).toEqual(['t']);
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
