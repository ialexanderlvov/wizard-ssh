import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rsyncVersionHasInfoProgress } from '../src/utils/exec.js';

describe('rsyncVersionHasInfoProgress (pure version parsing)', () => {
  it('rejects Apple openrsync ("2.6.9 compatible")', () => {
    expect(
      rsyncVersionHasInfoProgress('openrsync: protocol version 29\nrsync version 2.6.9 compatible'),
    ).toBe(false);
  });
  it('rejects old samba rsync 2.6.9 and 3.0.x', () => {
    expect(rsyncVersionHasInfoProgress('rsync  version 2.6.9  protocol version 29')).toBe(false);
    expect(rsyncVersionHasInfoProgress('rsync  version 3.0.9  protocol version 30')).toBe(false);
  });
  it('accepts real rsync >= 3.1', () => {
    expect(rsyncVersionHasInfoProgress('rsync  version 3.1.0  protocol version 31')).toBe(true);
    expect(rsyncVersionHasInfoProgress('rsync  version 3.2.7  protocol version 31')).toBe(true);
    expect(rsyncVersionHasInfoProgress('rsync version v3.4.1')).toBe(true);
  });
  it('treats unparseable output as unsupported', () => {
    expect(rsyncVersionHasInfoProgress('garbage')).toBe(false);
  });
});

// On openrsync / old rsync the transfer must NOT pass --info=progress2 (it dies
// with "unrecognized option"); it must fall back to the portable --progress.
const h = vi.hoisted(() => ({ runProgram: vi.fn(async () => 0) }));
vi.mock('../src/ssh/runner.js', () => ({
  runProgram: h.runProgram,
  runSshInherit: vi.fn(async () => 0),
}));
vi.mock('../src/utils/exec.js', async (orig) => {
  const actual = await orig<typeof import('../src/utils/exec.js')>();
  return { ...actual, commandExists: () => true, rsyncSupportsInfoProgress: () => false };
});

describe('rsync arg building on legacy rsync (no --info support)', () => {
  beforeEach(() => h.runProgram.mockClear());
  it('falls back to --progress and omits --info=progress2 and -h', async () => {
    const { transfer } = await import('../src/ssh/features.js');
    const server = {
      hostMode: 'manual',
      host: '1.2.3.4',
      user: 'root',
      sshPort: 22,
      auth: 'agent',
    };
    await transfer(
      server as never,
      { direction: 'upload', localPath: './a', remotePath: '/b', tool: 'rsync', archive: true },
      undefined,
    );
    const args = (h.runProgram.mock.calls[0]?.[1] ?? []) as string[];
    expect(args).toContain('--progress');
    expect(args).not.toContain('--info=progress2');
    expect(args).not.toContain('-h');
  });
});
