import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cmds: new Set<string>(['ssh', 'ssh-copy-id', 'scp']),
  runProgram: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
}));

vi.mock('../src/utils/exec.js', async (orig) => {
  const actual = await orig<typeof import('../src/utils/exec.js')>();
  return { ...actual, commandExists: (c: string) => h.cmds.has(c) };
});
vi.mock('../src/ssh/runner.js', async (orig) => {
  const actual = await orig<typeof import('../src/ssh/runner.js')>();
  return { ...actual, runProgram: h.runProgram, runSshInherit: h.runSshInherit };
});

import { copyId, runCommand, transfer } from '../src/ssh/features.js';
import type { Server } from '../src/core/types.js';

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
  user: 'deploy',
  sshPort: 2222,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  linkedSshHost: null,
  ...o,
});

beforeEach(() => {
  h.runProgram.mockClear();
  h.runSshInherit.mockClear();
  h.cmds.clear();
  ['ssh', 'ssh-copy-id', 'scp'].forEach((c) => h.cmds.add(c));
});

describe('copyId', () => {
  it('invokes ssh-copy-id with -i and -p', async () => {
    expect(await copyId(server(), '/keys/id.pub', 'pw')).toBe(0);
    const [prog, args, pw] = h.runProgram.mock.calls[0] ?? [];
    expect(prog).toBe('ssh-copy-id');
    expect(args).toContain('-i');
    expect(args).toContain('/keys/id.pub');
    expect(args).toContain('-p');
    expect(args).toContain('2222');
    expect((args as string[]).at(-1)).toBe('deploy@1.2.3.4');
    expect(pw).toBe('pw');
  });
  it('rejects when ssh-copy-id is missing', async () => {
    h.cmds.delete('ssh-copy-id');
    await expect(copyId(server(), null)).rejects.toThrow(/ssh-copy-id/);
  });
});

describe('runCommand', () => {
  it('delegates to runSshInherit with a -- command', async () => {
    expect(await runCommand(server(), ['uptime'])).toBe(0);
    const args = h.runSshInherit.mock.calls[0]?.[0] as string[];
    expect(args.slice(-2)).toEqual(['--', 'uptime']);
  });
});

describe('transfer', () => {
  it('builds an upload scp command (-P for port)', async () => {
    expect(
      await transfer(server(), { direction: 'upload', localPath: './a', remotePath: '/b' }),
    ).toBe(0);
    const [prog, args] = h.runProgram.mock.calls[0] ?? [];
    expect(prog).toBe('scp');
    expect(args).toContain('-P');
    expect((args as string[]).at(-1)).toBe('deploy@1.2.3.4:/b');
  });
  it('download swaps source/dest and supports -r', async () => {
    await transfer(server(), {
      direction: 'download',
      localPath: './local',
      remotePath: '/remote',
      recursive: true,
    });
    const args = h.runProgram.mock.calls[0]?.[1] as string[];
    expect(args).toContain('-r');
    expect(args[args.length - 2]).toBe('deploy@1.2.3.4:/remote');
    expect(args[args.length - 1]).toContain('local');
  });
  it('rejects when scp is missing', async () => {
    h.cmds.delete('scp');
    await expect(
      transfer(server(), { direction: 'upload', localPath: 'a', remotePath: 'b' }),
    ).rejects.toThrow(/scp/);
  });
});
