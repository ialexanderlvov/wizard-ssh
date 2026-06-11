// Tests for src/commands/actions.ts — check/copy-id/run/transfer flows + the shared tag inventory.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';

const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
  pick: [] as unknown[],
};
const resetQ = (): void => (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));

const runner = {
  runInteractive: vi.fn(async () => 0),
  runTunnel: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
  runProgram: vi.fn(async () => 0),
  // pid = this test process (alive) so the recorded session survives the
  // liveness reap in transferSessions.list().
  startTransferDetached: vi.fn(() => ({ pid: process.pid, logFile: '/tmp/wssh-t.log' })),
};
const feat = {
  healthOpen: false,
  // plain exit codes consumed by setupMocksCodes
  copyCode: 0,
  transferCode: 0,
  // spies consumed by setupMocks / setupMocksExtra
  copyId: vi.fn(async () => 0),
  transfer: vi.fn(async () => 0),
  runCommand: vi.fn(async () => 0),
};
const touch = { supported: false };

const touchidUnsupported = () => ({
  isSupported: () => false,
  authenticate: () => false,
  storeKey: () => false,
  loadKey: () => null,
  deleteKey: () => {},
});

function setupMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: feat.copyId,
    runCommand: feat.runCommand,
    transfer: feat.transfer,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
  vi.doMock('../src/vault/touchid.js', touchidUnsupported);
}

// Variant: features report the plain exit codes from `feat.copyCode` / `feat.transferCode`.
function setupMocksCodes(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: async () => feat.copyCode,
    runCommand: async () => 0,
    transfer: async () => feat.transferCode,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
  vi.doMock('../src/vault/touchid.js', touchidUnsupported);
}

// Variant: fully static features (always succeed, never reachable).
function setupMocksStatic(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
    copyId: async () => 0,
    runCommand: async () => 0,
    transfer: async () => 0,
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: false, ms: 1 }),
  }));
  vi.doMock('../src/vault/touchid.js', touchidUnsupported);
}

// Variant: + clipboard print-fallback, transferArgv and a touch-aware keystore.
function setupMocksExtra(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  // Force the reveal flow down its print fallback (and never touch the real
  // system clipboard) by making copyToClipboard report no clipboard tool.
  vi.doMock('../src/utils/platform.js', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/platform.js')>(
      '../src/utils/platform.js',
    );
    return { ...actual, copyToClipboard: () => null };
  });
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: feat.copyId,
    runCommand: feat.runCommand,
    transfer: feat.transfer,
    transferArgv: () => ({ program: 'scp', args: [] }),
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
  let stored: string | null = null;
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => touch.supported,
    authenticate: () => true,
    storeKey: (k: string) => {
      stored = k;
      return true;
    },
    loadKey: () => stored,
    deleteKey: () => {
      stored = null;
    },
  }));
}

describe('actions: every resolution + option branch', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    feat.healthOpen = false;
    [
      runner.runInteractive,
      runner.runTunnel,
      runner.runSshInherit,
      runner.runProgram,
      feat.copyId,
      feat.transfer,
      feat.runCommand,
    ].forEach((m) => m.mockClear());
    feat.copyId.mockImplementation(async () => 0);
    feat.transfer.mockImplementation(async () => 0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setupMocks();
  });

  it('checkFlow: reachable server, by name', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    feat.healthOpen = true;
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('box')).toBe(0); // open → printOk branch
  });

  it('checkFlow: no name → picker', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.pick = ['box']; // picker resolves the seeded server by name
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow()).toBe(2); // unreachable → printError branch
  });

  it('copyIdFlow: server with key auth reuses its key (no picker)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({
      name: 'box',
      host: '1.2.3.4',
      auth: 'key',
      keyPath: '/keys/id',
      kind: 'server',
    });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), '/keys/id', undefined);
  });

  it('copyIdFlow: pick the "default" key option', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    fs.writeFileSync(path.join(ssh, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['__default__'];
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });

  it('runFlow: explicit command (no prompt)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', ['ls', '-la'])).toBe(0);
  });

  it('transferFlow: recursive download', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['download'];
    q.text = ['./local', '/remote'];
    q.confirm = [true]; // recursive
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recursive: true }),
      undefined,
    );
  });
});

describe('actions: empty resolution + non-zero exit codes', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    feat.copyCode = 0;
    feat.transferCode = 0;
    feat.healthOpen = false;
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setupMocksCodes();
  });

  it('flows return 0 when no server is resolved (empty store, no name)', async () => {
    const a = await import('../src/commands/actions.js');
    expect(await a.checkFlow()).toBe(0);
    expect(await a.copyIdFlow()).toBe(0);
    expect(await a.runFlow(undefined, [])).toBe(0);
    expect(await a.transferFlow()).toBe(0);
  });

  it('checkFlow on an unreachable tunnel returns 2', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tnl', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('tnl')).toBe(2);
  });

  it('copyIdFlow / transferFlow surface a non-zero exit code', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    feat.copyCode = 2;
    const { copyIdFlow, transferFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(2);
    feat.transferCode = 3;
    q.choose = ['upload'];
    q.text = ['a', 'b'];
    q.confirm = [false];
    expect(await transferFlow('box')).toBe(3);
  });
});

describe('actions', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setupMocksStatic();
  });

  it('checkFlow returns non-zero for an unreachable target', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { checkFlow } = await import('../src/commands/actions.js');
    expect(await checkFlow('box')).toBe(2);
  });

  it('runFlow executes a command on a resolved server', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', ['uptime'])).toBe(0);
    expect(servers.findByName('box')?.useCount).toBe(1);
  });

  it('copyIdFlow installs a key (agent server, no local keys)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
  });

  it('transferFlow asks direction + paths', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['upload'];
    q.text = ['./a', '/remote/b'];
    q.confirm = [false];
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
  });
});

describe('actions branches', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    feat.healthOpen = false;
    touch.supported = false;
    [
      runner.runInteractive,
      runner.runTunnel,
      runner.runSshInherit,
      runner.runProgram,
      runner.startTransferDetached,
      feat.copyId,
      feat.transfer,
      feat.runCommand,
    ].forEach((m) => m.mockClear());
    feat.copyId.mockImplementation(async () => 0);
    feat.transfer.mockImplementation(async () => 0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setupMocksExtra();
  });

  it('checkFlow resolves a tunnel by name', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tnl', type: 'local', localPort: 8181, remotePort: 81, kind: 'tunnel' });
    const { checkFlow } = await import('../src/commands/actions.js');
    feat.healthOpen = true;
    expect(await checkFlow('tnl')).toBe(0);
  });

  it('copyIdFlow lets you pick a discovered key', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    const key = path.join(ssh, 'id_ed25519');
    fs.writeFileSync(key, '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = [key];
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), key, undefined);
  });

  it('copyIdFlow reports a failure', async () => {
    feat.copyId.mockRejectedValueOnce?.(new Error('boom'));
    feat.copyId.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(1);
  });

  it('runFlow prompts for a command when none is given', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.text = ['uptime -p'];
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', [])).toBe(0);
    expect(feat.runCommand).toHaveBeenCalled();
  });

  it('transferFlow reports a failure', async () => {
    feat.transfer.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['download'];
    q.text = ['./a', '/b'];
    q.confirm = [false];
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(1);
  });

  it('transferFlow via rsync picks the tool and rsync options', async () => {
    vi.doMock('../src/utils/exec.js', async (o) => {
      const a = await o<typeof import('../src/utils/exec.js')>();
      return { ...a, commandExists: () => true }; // rsync available
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['rsync', 'upload'];
    q.text = ['./a', '/b'];
    q.confirm = [true, false, false]; // compress, delete, dry-run
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', compress: true, archive: true }),
      undefined,
    );
  });

  it('transferFlow runs fully from CLI flags (no prompts)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('box', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      recursive: true,
    });
    expect(code).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tool: 'scp',
        direction: 'upload',
        localPath: './a',
        remotePath: '/b',
        recursive: true,
      }),
      undefined,
    );
  });

  it('transferFlow errors when scripted and a required field is missing', async () => {
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ nonInteractive: true }); // reset by vi.resetModules in beforeEach
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    await expect(transferFlow('box', { local: './a', remote: '/b' })).rejects.toThrow();
  });

  it('transferFlow applies saved transfer defaults when flags are omitted', async () => {
    const { settings } = await import('../src/store/settings.store.js');
    settings.update({
      transfer: { tool: 'rsync', recursive: false, compress: true, delete: true },
    });
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ nonInteractive: true });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    await transferFlow('box', { direction: 'upload', local: './a', remote: '/b' }); // no tool/compress/delete
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', compress: true, delete: true }),
      undefined,
    );
  });

  it('transferFlow --bg starts a detached transfer and records a session', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', auth: 'agent', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('box', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      bg: true,
    });
    expect(code).toBe(0);
    expect(runner.startTransferDetached).toHaveBeenCalled();
    expect(feat.transfer).not.toHaveBeenCalled(); // backgrounded, not run in foreground
    const { FILES } = await import('../src/core/paths.js');
    const data = JSON.parse(fs.readFileSync(FILES.transferSessions, 'utf8'));
    expect(data.sessions.some((s: { name: string }) => s.name === 'box')).toBe(true);
  });

  it('transferFlow --bg refuses password auth (no detached process)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'pw', host: '1.2.3.4', auth: 'password', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('pw', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      bg: true,
    });
    expect(code).toBe(1);
    expect(runner.startTransferDetached).not.toHaveBeenCalled();
  });

  it('transferFlow under --yes accepts toggle defaults (no forced --delete / --dry-run)', async () => {
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ assumeYes: true }); // --yes, but session is still "interactive"
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    // rsync via flag (skips picker); no toggle flags → must fall to defaults, NOT "yes"
    await transferFlow('box', { tool: 'rsync', direction: 'upload', local: './a', remote: '/b' });
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', delete: false, dryRun: false }),
      undefined,
    );
  });
});

describe('tagCounts (shared tag inventory)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  const tunnelInput = (name: string, tags: string[]) => ({
    name,
    description: '',
    tags,
    kind: 'tunnel' as const,
    hostMode: 'manual' as const,
    sshHost: '',
    host: 'h.example.com',
    user: 'root',
    sshPort: 22,
    auth: 'agent' as const,
    keyPath: null,
    secretId: null,
    type: 'local' as const,
    localPort: 8080,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    openBrowser: false,
  });

  it("'tunnels' includes temporary tunnels (profiles span both stores); 'all' mirrors the group/status surface", async () => {
    const { tunnels, tempTunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create(tunnelInput('main-1', ['work']));
    tempTunnels.create(tunnelInput('tmp-1', ['demo']));
    const { tagCounts } = await import('../src/commands/actions.js');
    // profile picker ('tunnels') must offer the temp-only tag — down --tag stops it
    expect(Object.fromEntries(tagCounts('tunnels'))).toEqual({ work: 1, demo: 1 });
    // groups/status don't cover temp tunnels, so 'all' must not offer 'demo'
    expect(Object.fromEntries(tagCounts('all'))).toEqual({ work: 1 });
    expect(tagCounts('servers')).toEqual([]);
  });

  it('sorts by count desc, then name asc, and accepts a pre-scanned pool', async () => {
    const { tagCounts } = await import('../src/commands/actions.js');
    const mk = (tags: string[]) => ({ tags });
    const rows = tagCounts('all', {
      servers: [mk(['b']), mk(['a']), mk(['a'])] as never[],
      tunnels: [],
      tempTunnels: [],
    });
    expect(rows).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});
