// Tests for src/commands/settings.ts — settings/vault picker flows (plus a config picker edge).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

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
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
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

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  cmdMocks();
});

describe('settings/config picker branches', () => {
  it('vaultFlow with no vault offers setup then exits', async () => {
    // First iteration: only the «setup» row is offered → create the vault.
    // Second iteration: Esc to leave the loop menu.
    q.pick = ['setup', PICK_BACK];
    q.secret = ['mmmm', 'mmmm']; // matching passphrases for ensureVaultSetup
    const { vaultFlow } = await import('../src/commands/settings.js');
    await expect(vaultFlow()).resolves.toBeUndefined();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
  });

  it('editConfigHost with no alias and no hosts → picker returns null', async () => {
    const { editConfigHost } = await import('../src/commands/config.js');
    await expect(editConfigHost()).resolves.toBeUndefined();
  });
});
