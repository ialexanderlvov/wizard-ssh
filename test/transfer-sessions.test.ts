import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

const mk = (id: string, pid: number) => ({
  id,
  name: id,
  tool: 'scp' as const,
  direction: 'upload' as const,
  summary: `${id} → host:/x`,
  pid,
  logFile: `/tmp/${id}.log`,
});

describe('transfer sessions store', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('keeps a live process and reaps a dead one on list()', async () => {
    const { transferSessions } = await import('../src/store/transfer-sessions.store.js');
    transferSessions.add(mk('alive', process.pid)); // this test process — alive
    transferSessions.add(mk('dead', 0x7fffffff)); // implausible pid — not alive
    const ids = transferSessions.list().map((s) => s.id);
    expect(ids).toContain('alive');
    expect(ids).not.toContain('dead');
  });

  it('remove drops a session', async () => {
    const { transferSessions } = await import('../src/store/transfer-sessions.store.js');
    transferSessions.add(mk('alive', process.pid));
    expect(transferSessions.list()).toHaveLength(1);
    transferSessions.remove('alive');
    expect(transferSessions.list()).toHaveLength(0);
  });
});
