import { describe, it, expect, vi } from 'vitest';
import {
  encrypt,
  decrypt,
  deriveKey,
  defaultKdf,
  keyMatchesCheck,
  CHECK_PLAINTEXT,
} from '../src/vault/crypto.js';
import { freshHome } from './helpers.js';

describe('crypto', () => {
  it('encrypt uses a fresh iv each time', () => {
    const key = deriveKey('p', defaultKdf());
    const a = encrypt(key, 'x');
    const b = encrypt(key, 'x');
    expect(a.iv).not.toBe(b.iv);
    expect(decrypt(key, a)).toBe('x');
  });

  it('decrypt throws on a tampered tag', () => {
    const key = deriveKey('p', defaultKdf());
    const c = encrypt(key, 'secret');
    const tampered = { ...c, data: Buffer.from('garbage').toString('base64') };
    expect(() => decrypt(key, tampered)).toThrow();
  });

  it('keyMatchesCheck distinguishes keys', () => {
    const kdf = defaultKdf();
    const right = deriveKey('right', kdf);
    const check = encrypt(right, CHECK_PLAINTEXT);
    expect(keyMatchesCheck(right, check)).toBe(true);
    expect(keyMatchesCheck(deriveKey('wrong', kdf), check)).toBe(false);
  });
});

// touchid stub: no biometrics available.
const noTouch = () => ({
  isSupported: () => false,
  authenticate: () => false,
  storeKey: () => false,
  loadKey: () => null,
  deleteKey: () => {},
});

// touchid stub: biometrics succeed; storeKey/loadKey keep state.
function fakeTouch() {
  let stored: string | null = null;
  const authenticate = vi.fn(() => true);
  return {
    mod: {
      isSupported: () => true,
      authenticate,
      storeKey: (k: string) => {
        stored = k;
        return true;
      },
      loadKey: () => stored,
      deleteKey: () => {
        stored = null;
      },
    },
    authenticate,
  };
}

async function loadVault(touchMod: object) {
  vi.resetModules();
  freshHome();
  vi.doMock('../src/vault/touchid.js', () => touchMod);
  return (await import('../src/vault/vault.js')).vault;
}

describe('vault (passphrase)', () => {
  it('setup, secret round-trip, lock/unlock, attempts', async () => {
    const vault = await loadVault(noTouch());
    expect(vault.exists()).toBe(false);

    vault.setup('master');
    expect(vault.exists()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    expect(vault.touchIdSupported()).toBe(false);
    expect(vault.isTouchIdEnabled()).toBe(false);

    const id = vault.setSecret('hunter2');
    expect(vault.getSecret(id)).toBe('hunter2');
    expect(vault.hasSecret(id)).toBe(true);
    expect(vault.hasSecret(null)).toBe(false);
    expect(vault.secretCount()).toBe(1);

    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    expect(() => vault.getSecret(id)).toThrow(/locked/i);

    const onError = vi.fn();
    let n = 0;
    const ok = await vault.unlock({
      allowTouchId: false,
      promptPassphrase: async () => (++n === 1 ? 'wrong' : 'master'),
      onError,
    });
    expect(ok).toBe(true);
    expect(n).toBe(2);
    expect(onError).toHaveBeenCalledOnce();
    expect(vault.getSecret(id)).toBe('hunter2');

    vault.removeSecret(id);
    expect(vault.secretCount()).toBe(0);
    expect(vault.hasSecret(id)).toBe(false);
  });

  it('three wrong attempts → unlock fails', async () => {
    const vault = await loadVault(noTouch());
    vault.setup('master');
    vault.lock();
    const ok = await vault.unlock({
      allowTouchId: false,
      promptPassphrase: async () => 'nope',
      onError: () => {},
    });
    expect(ok).toBe(false);
  });

  it('rekey re-encrypts under a new passphrase', async () => {
    const vault = await loadVault(noTouch());
    vault.setup('old');
    const id = vault.setSecret('pw');
    vault.rekey('new');
    vault.lock();
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'old',
        onError: () => {},
      }),
    ).toBe(false);
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'new',
        onError: () => {},
      }),
    ).toBe(true);
    expect(vault.getSecret(id)).toBe('pw');
  });

  it('enableTouchId fails when unsupported', async () => {
    const vault = await loadVault(noTouch());
    vault.setup('master');
    expect(vault.enableTouchId()).toBe(false);
  });
});

describe('vault (Touch ID)', () => {
  it('unlocks via biometrics without asking for the passphrase', async () => {
    const touch = fakeTouch();
    const vault = await loadVault(touch.mod);
    vault.setup('master', { enableTouchId: true });
    expect(vault.isTouchIdEnabled()).toBe(true);

    vault.lock();
    const prompt = vi.fn(async () => 'should-not-be-called');
    const ok = await vault.unlock({
      allowTouchId: true,
      promptPassphrase: prompt,
      onError: () => {},
    });
    expect(ok).toBe(true);
    expect(touch.authenticate).toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('enable then disable Touch ID', async () => {
    const touch = fakeTouch();
    const vault = await loadVault(touch.mod);
    vault.setup('master');
    expect(vault.enableTouchId()).toBe(true);
    expect(vault.isTouchIdEnabled()).toBe(true);
    vault.disableTouchId();
    expect(vault.isTouchIdEnabled()).toBe(false);
  });
});
