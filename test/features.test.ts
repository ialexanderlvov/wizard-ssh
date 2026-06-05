import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cmds: new Set<string>(['ssh', 'ssh-copy-id', 'scp', 'rsync']),
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

import { copyId, runCommand, transfer, resolveEndpoint } from '../src/ssh/features.js';
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
  ['ssh', 'ssh-copy-id', 'scp', 'rsync'].forEach((c) => h.cmds.add(c));
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
    expect(args.slice(-3)).toEqual(['--', 'deploy@1.2.3.4', 'uptime']);
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

  it('adds -i for key auth and password options for password auth', async () => {
    await transfer(server({ auth: 'key', keyPath: '/k' }), {
      direction: 'upload',
      localPath: 'a',
      remotePath: 'b',
    });
    expect(h.runProgram.mock.calls[0]?.[1]).toContain('-i');
    h.runProgram.mockClear();
    await transfer(server({ auth: 'password' }), {
      direction: 'upload',
      localPath: 'a',
      remotePath: 'b',
    });
    expect((h.runProgram.mock.calls[0]?.[1] as string[]).join(' ')).toContain(
      'PreferredAuthentications=password',
    );
  });

  it('password-auth scp disables ProxyCommand/ProxyJump/LocalCommand (no SSHPASS leak)', async () => {
    await transfer(
      server({ auth: 'password' }),
      { direction: 'upload', localPath: 'a', remotePath: 'b' },
      'pw',
    );
    const args = (h.runProgram.mock.calls[0]?.[1] as string[]).join(' ');
    expect(args).toContain('ProxyCommand=none');
    expect(args).toContain('ProxyJump=none');
    expect(args).toContain('PermitLocalCommand=no');
  });

  it('key-auth scp keeps proxying available (no none-overrides)', async () => {
    await transfer(server({ auth: 'key', keyPath: '/k' }), {
      direction: 'upload',
      localPath: 'a',
      remotePath: 'b',
    });
    expect((h.runProgram.mock.calls[0]?.[1] as string[]).join(' ')).not.toContain('ProxyJump=none');
  });
});

describe('copyId SSHPASS leak protection', () => {
  it('password-auth ssh-copy-id disables ProxyCommand/ProxyJump/LocalCommand', async () => {
    await copyId(server({ auth: 'password' }), '/keys/id.pub', 'pw');
    const args = (h.runProgram.mock.calls[0]?.[1] as string[]).join(' ');
    expect(args).toContain('ProxyCommand=none');
    expect(args).toContain('ProxyJump=none');
    expect(args).toContain('PermitLocalCommand=no');
  });

  it('non-password ssh-copy-id adds no proxy overrides', async () => {
    await copyId(server({ auth: 'agent' }), '/keys/id.pub');
    expect((h.runProgram.mock.calls[0]?.[1] as string[]).join(' ')).not.toContain('ProxyJump=none');
  });
});

describe('copyId / resolveEndpoint port branches', () => {
  it('copyId omits -p for default port and ssh-config hosts', async () => {
    await copyId(server({ sshPort: 22 }), null);
    expect(h.runProgram.mock.calls[0]?.[1]).not.toContain('-p');
    h.runProgram.mockClear();
    await copyId(server({ hostMode: 'sshconfig', sshHost: 'alias' }), null);
    expect(h.runProgram.mock.calls[0]?.[1]).not.toContain('-p');
    expect((h.runProgram.mock.calls[0]?.[1] as string[]).at(-1)).toBe('alias');
  });

  it('resolveEndpoint: manual host with falsy port → 22', () => {
    expect(
      resolveEndpoint({
        hostMode: 'manual',
        sshHost: '',
        host: '1.2.3.4',
        user: 'u',
        sshPort: 0,
        auth: 'agent',
        keyPath: null,
        secretId: null,
      }),
    ).toEqual({ host: '1.2.3.4', port: 22 });
  });
});

describe('transfer via rsync', () => {
  it('uploads with -e ssh transport, archive mode by default', async () => {
    expect(
      await transfer(server(), {
        tool: 'rsync',
        direction: 'upload',
        localPath: './a',
        remotePath: '/b',
      }),
    ).toBe(0);
    const [prog, args] = h.runProgram.mock.calls[0] ?? [];
    expect(prog).toBe('rsync');
    const a = args as string[];
    expect(a[0]).toBe('-e');
    expect(a[1]).toContain('ssh');
    expect(a[1]).toContain("'-p' '2222'"); // transport carries the port (shell-quoted, #1-3)
    expect(a).toContain('-a');
    expect(a.at(-1)).toBe('deploy@1.2.3.4:/b');
  });

  it('passes compress / delete / dry-run + download direction; alias transport has no -p', async () => {
    await transfer(server({ hostMode: 'sshconfig', sshHost: 'alias' }), {
      tool: 'rsync',
      direction: 'download',
      localPath: './local',
      remotePath: '/remote',
      compress: true,
      delete: true,
      dryRun: true,
    });
    const a = h.runProgram.mock.calls[0]?.[1] as string[];
    expect(a).toEqual(expect.arrayContaining(['-z', '--delete', '-n', '--info=progress2']));
    expect(a[1]).not.toContain('-p');
    expect(a[a.length - 2]).toBe('alias:/remote');
    expect(a[a.length - 1]).toContain('local');
  });

  it('falls back to -r when archive is disabled', async () => {
    await transfer(server(), {
      tool: 'rsync',
      direction: 'upload',
      localPath: 'a',
      remotePath: 'b',
      archive: false,
      recursive: true,
    });
    const a = h.runProgram.mock.calls[0]?.[1] as string[];
    expect(a).toContain('-r');
    expect(a).not.toContain('-a');
  });

  it('rejects when rsync is missing', async () => {
    h.cmds.delete('rsync');
    await expect(
      transfer(server(), { tool: 'rsync', direction: 'upload', localPath: 'a', remotePath: 'b' }),
    ).rejects.toThrow(/rsync/);
  });
});
