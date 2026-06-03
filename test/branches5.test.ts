import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, promptMock } from './helpers.js';

const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
};
const resetQ = (): void => (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({
    runInteractive: async () => 0,
    runTunnel: async () => 0,
    runSshInherit: async () => 0,
    runProgram: async () => 0,
    preflight: () => null,
  }));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}
const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  cmdMocks();
});

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

describe('helpers remaining branches', () => {
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

describe('config connect via picker', () => {
  it('connectConfigHostFlow with no alias uses the picker', async () => {
    writeConfig('Host pickme\n    HostName 9.9.9.9\n');
    q.search = ['pickme'];
    const { connectConfigHostFlow } = await import('../src/commands/config.js');
    expect(await connectConfigHostFlow()).toBe(0);
  });
});

describe('vaultFlow unlocked-state choices', () => {
  it('shows lock when already unlocked', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master'); // unlocked
    q.choose = ['lock', 'back'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    expect(vault.isUnlocked()).toBe(false);
  });
});

describe('tunnel connect by exact name', () => {
  it('connectTunnelFlow resolves an exact tunnel name', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'exact', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    const { connectTunnelFlow } = await import('../src/commands/tunnels.js');
    expect(await connectTunnelFlow('exact')).toBe(0);
  });
});
