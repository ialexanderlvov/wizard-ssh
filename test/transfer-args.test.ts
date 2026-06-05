import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ssh/runner.js', () => ({
  runProgram: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
}));
vi.mock('../src/utils/exec.js', async (orig) => {
  const actual = await orig<typeof import('../src/utils/exec.js')>();
  return { ...actual, commandExists: () => true, rsyncSupportsInfoProgress: () => true };
});

import { transfer } from '../src/ssh/features.js';
import { runProgram } from '../src/ssh/runner.js';
import type { Server } from '../src/core/types.js';

const server = {
  id: 's1',
  name: 'box',
  kind: 'server',
  hostMode: 'manual',
  host: '1.2.3.4',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  sshHost: '',
  description: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
  lastUsedAt: null,
  useCount: 0,
} as unknown as Server;

describe('transfer argument building', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rsync requests overall progress with --info=progress2', async () => {
    await transfer(
      server,
      { direction: 'upload', localPath: './a', remotePath: '/b', tool: 'rsync', archive: true },
      undefined,
    );
    expect(runProgram).toHaveBeenCalledWith(
      'rsync',
      expect.arrayContaining(['--info=progress2']),
      undefined,
    );
  });

  it('scp passes -r for a recursive copy', async () => {
    await transfer(
      server,
      { direction: 'download', localPath: './a', remotePath: '/b', tool: 'scp', recursive: true },
      undefined,
    );
    expect(runProgram).toHaveBeenCalledWith('scp', expect.arrayContaining(['-r']), undefined);
  });
});
