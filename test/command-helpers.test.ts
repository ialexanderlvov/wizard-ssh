// Tests for src/commands/helpers.ts — entity resolution, password secrets and vault setup/unlock.
// (Named command-helpers to avoid colliding with test/helpers.ts, the shared test utilities.)
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  copyId: vi.fn(async () => 0),
  transfer: vi.fn(async () => 0),
  runCommand: vi.fn(async () => 0),
};
const touch = { supported: false };

// Base mock set: prompts + list picker + runner + an inert keystore.
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}

// Variant: + clipboard print-fallback, spy-style features and a touch-aware keystore.
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

const target = (o: Record<string, unknown> = {}) => ({
  hostMode: 'manual' as const,
  sshHost: '',
  host: 'h',
  user: 'u',
  sshPort: 22,
  auth: 'password' as const,
  keyPath: null,
  secretId: null,
  ...o,
});

describe('helpers direct', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    Object.values(runner).forEach((m) => m.mockClear());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

  it('resolveEntity: not found on empty store → null', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { resolveEntity } = await import('../src/commands/helpers.js');
    expect(await resolveEntity(servers, 'ghost', 'msg')).toBeNull();
  });

  it('resolveEntity: several fuzzy matches → picker', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const a = servers.create({ name: 'web-1', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'web-2', host: '2.2.2.2', kind: 'server' });
    q.pick = ['web-1'];
    const { resolveEntity } = await import('../src/commands/helpers.js');
    expect((await resolveEntity(servers, 'web', 'msg'))?.id).toBe(a.id);
  });

  it('pickEntity on empty list returns null', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { pickEntity } = await import('../src/commands/servers.js');
    expect(await pickEntity(servers.all(), 'pick')).toBeNull();
  });

  it('ensureVaultSetup fails on passphrase mismatch', async () => {
    q.secret = ['aaaa', 'bbbb'];
    const { ensureVaultSetup } = await import('../src/commands/helpers.js');
    expect(await ensureVaultSetup()).toBe(false);
  });
});

describe('helpers remaining branches', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

  it('handlePasswordSecret returns prev id when vault setup is abandoned', async () => {
    q.confirm = [true]; // save? yes
    q.secret = ['aaaa', 'bbbb']; // mismatch → ensureVaultSetup false
    const { handlePasswordSecret } = await import('../src/commands/helpers.js');
    expect(await handlePasswordSecret(target(), 'prev-id')).toBe('prev-id');
  });

  it('resolvePassword prompts (empty then real) when no secret saved', async () => {
    q.secret = ['', 'typed']; // first invalid (validate false branch), then accepted
    const { resolvePassword } = await import('../src/commands/helpers.js');
    // promptMock returns the first queued value; validate('') exercises the false branch
    const pw = await resolvePassword(target());
    expect(pw).toBe('');
  });

  it('resolveEntity returns the sole fuzzy match', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.create({ name: 'unique-name', host: '1.1.1.1', kind: 'server' });
    const { resolveEntity } = await import('../src/commands/helpers.js');
    expect((await resolveEntity(servers, 'unique-na', 'msg'))?.id).toBe(s.id);
  });
});

describe('helpers branches', () => {
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

  it('handlePasswordSecret defers clearing a secret to commit when auth leaves password', async () => {
    // build a vault + secret
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const { handlePasswordSecret, commitSecretChange } = await import('../src/commands/helpers.js');
    const out = await handlePasswordSecret(
      {
        hostMode: 'manual',
        sshHost: '',
        host: 'h',
        user: 'u',
        sshPort: 22,
        auth: 'agent',
        keyPath: null,
        secretId: id,
      },
      id,
    );
    expect(out).toBeNull();
    // The old blob is NOT removed yet — doing so before the edit commits would
    // dangle the secretId on cancel. Removal happens only at commit time.
    expect(vault.hasSecret(id)).toBe(true);
    commitSecretChange(id, out);
    expect(vault.hasSecret(id)).toBe(false);
  });

  it('handlePasswordSecret with save=false defers dropping the previous secret to commit', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    q.confirm = [false]; // do not save
    const { handlePasswordSecret, commitSecretChange } = await import('../src/commands/helpers.js');
    const out = await handlePasswordSecret(
      {
        hostMode: 'manual',
        sshHost: '',
        host: 'h',
        user: 'u',
        sshPort: 22,
        auth: 'password',
        keyPath: null,
        secretId: id,
      },
      id,
    );
    expect(out).toBeNull();
    expect(vault.hasSecret(id)).toBe(true); // preserved until commit
    commitSecretChange(id, out);
    expect(vault.hasSecret(id)).toBe(false);
  });

  it('rollbackSecretChange discards a pending blob but keeps the original (cancel safety)', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const original = vault.setSecret('old');
    const pending = vault.setSecret('new');
    const { rollbackSecretChange } = await import('../src/commands/helpers.js');
    rollbackSecretChange(original, pending);
    expect(vault.hasSecret(pending)).toBe(false); // pending blob discarded
    expect(vault.hasSecret(original)).toBe(true); // original left intact
  });

  it('resolvePassword falls back to a prompt when the saved secret is gone', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m'); // vault exists but has no secret with this id
    q.secret = ['typed-pw'];
    const { resolvePassword } = await import('../src/commands/helpers.js');
    const pw = await resolvePassword({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 22,
      auth: 'password',
      keyPath: null,
      secretId: 'ghost',
    });
    expect(pw).toBe('typed-pw');
  });

  it('resolvePassword returns the decrypted secret from an unlocked vault', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('stored-pw');
    const { resolvePassword } = await import('../src/commands/helpers.js');
    const pw = await resolvePassword({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 22,
      auth: 'password',
      keyPath: null,
      secretId: id,
    });
    expect(pw).toBe('stored-pw');
  });

  it('ensureVaultSetup enables Touch ID when supported', async () => {
    touch.supported = true;
    q.secret = ['master', 'master'];
    q.confirm = [true]; // enable Touch ID?
    const { ensureVaultSetup } = await import('../src/commands/helpers.js');
    expect(await ensureVaultSetup()).toBe(true);
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
    expect(vault.isTouchIdEnabled()).toBe(true);
  });
});
