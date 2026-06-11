import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('vault crypto', () => {
  it('round-trips a secret', () => {
    const kdf = defaultKdf();
    const key = deriveKey('passphrase', kdf);
    const c = encrypt(key, 'super-secret');
    expect(decrypt(key, c)).toBe('super-secret');
  });

  it('rejects a wrong key via the check blob', () => {
    const kdf = defaultKdf();
    const right = deriveKey('right', kdf);
    const wrong = deriveKey('wrong', kdf);
    const check = encrypt(right, CHECK_PLAINTEXT);
    expect(keyMatchesCheck(right, check)).toBe(true);
    expect(keyMatchesCheck(wrong, check)).toBe(false);
  });
});

describe('vault corruption handling', () => {
  it('getSecret returns null and rekey throws on a tampered blob', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { vault } = await import('../src/vault/vault.js');
    const { FILES } = await import('../src/core/paths.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const f = JSON.parse(fs.readFileSync(FILES.vault, 'utf8'));
    f.secrets[id].data = Buffer.from('garbage-bytes').toString('base64');
    fs.writeFileSync(FILES.vault, JSON.stringify(f));

    vi.resetModules();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { vault: v2 } = await import('../src/vault/vault.js');
    await v2.unlock({ allowTouchId: false, promptPassphrase: async () => 'm', onError: () => {} });
    expect(v2.getSecret(id)).toBeNull();
    expect(() => v2.rekey('new')).toThrow();
  });

  it('unlock returns false for a malformed vault file', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { ensureDataDir, FILES } = await import('../src/core/paths.js');
    ensureDataDir();
    fs.writeFileSync(FILES.vault, JSON.stringify({ version: 1 })); // no check / kdf
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'x',
        onError: () => {},
      }),
    ).toBe(false);
  });
});

describe('vault: Touch ID keychain self-heal on passphrase unlock', () => {
  it('re-stores the key when the keychain entry is missing', async () => {
    vi.resetModules();
    freshHome();
    const storeKey = vi.fn(() => true);
    vi.doMock('../src/vault/touchid.js', () => ({
      isSupported: () => true,
      authenticate: () => true,
      storeKey,
      loadKey: () => null, // keychain "empty"
      deleteKey: () => {},
    }));
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master', { enableTouchId: true });
    vault.lock();
    // touch path: authenticate ok but loadKey null → fall back to passphrase → heal
    const ok = await vault.unlock({
      allowTouchId: true,
      promptPassphrase: async () => 'master',
      onError: () => {},
    });
    expect(ok).toBe(true);
    expect(storeKey).toHaveBeenCalled();
  });
});

describe('#3 scrypt cost cap accounts for the parallelism factor p', () => {
  // Scaffolding from audit-fixes.test.ts (file-level beforeEach), scoped here.
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('isValidKdf rejects a high-p / high-work KDF and accepts the default', async () => {
    const { defaultKdf, isValidKdf } = await import('../src/vault/crypto.js');
    expect(isValidKdf(defaultKdf())).toBe(true);
    const base = { salt: 'AAAA', N: 131072, r: 8, p: 1, keylen: 32 };
    // The exact boundary the old cap let through (128*N*r == 2^30, p ignored).
    expect(isValidKdf({ ...base, N: 1 << 19, r: 16, p: 16 })).toBe(false);
    expect(isValidKdf({ ...base, p: 16 })).toBe(false); // p out of the new bound
    // Work product N*r*p over the ~8M cap is rejected even with sane memory.
    expect(isValidKdf({ ...base, N: 1 << 18, r: 16, p: 4 })).toBe(false);
    // A modest p within both caps is still accepted.
    expect(isValidKdf({ ...base, p: 4 })).toBe(true);
  });

  it('import skips a bundled vault whose KDF only abuses p', async () => {
    const { FILES } = await import('../src/core/paths.js');
    const { importData } = await import('../src/commands/import-export.js');
    const bundle = {
      app: 'wizard-ssh',
      version: 1,
      exportedAt: '2020-01-01T00:00:00.000Z',
      servers: [],
      tunnels: [],
      settings: {},
      vault: {
        version: 1,
        kdf: { salt: 'AAAA', N: 1 << 19, r: 16, p: 16, keylen: 32 },
        check: { iv: 'a', tag: 'b', data: 'c' },
        secrets: {},
        touchId: false,
      },
    };
    const file = path.join(os.homedir(), 'p-bundle.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    await importData(file, { replace: false });
    expect(fs.existsSync(FILES.vault)).toBe(false);
  });
});

describe('L-20 AES-GCM tag/IV lengths are pinned', () => {
  it('decrypt rejects a truncated auth tag and a short IV', async () => {
    const crypto = await import('../src/vault/crypto.js');
    const key = crypto.deriveKey('pw', crypto.defaultKdf());
    const blob = crypto.encrypt(key, 'secret');
    expect(crypto.decrypt(key, blob)).toBe('secret'); // round-trips

    // Truncate the 16-byte tag to 4 bytes (the downgrade attack) → rejected.
    const tag4 = Buffer.from(blob.tag, 'base64').subarray(0, 4).toString('base64');
    expect(() => crypto.decrypt(key, { ...blob, tag: tag4 })).toThrow();

    // A non-12-byte IV → rejected.
    const iv8 = Buffer.from(blob.iv, 'base64').subarray(0, 8).toString('base64');
    expect(() => crypto.decrypt(key, { ...blob, iv: iv8 })).toThrow();
  });

  it('isVaultFileShape rejects a vault whose check blob has a truncated tag', async () => {
    const { isVaultFileShape } = await import('../src/vault/vault.js');
    const goodKdf = { salt: 'AAAA', N: 131072, r: 8, p: 1, keylen: 32 };
    const shape = (tagBytes: number) => ({
      version: 1,
      kdf: goodKdf,
      check: {
        iv: Buffer.alloc(12).toString('base64'),
        tag: Buffer.alloc(tagBytes).toString('base64'),
        data: 'c',
      },
      secrets: {},
      touchId: false,
    });
    expect(isVaultFileShape(shape(16))).toBe(true);
    expect(isVaultFileShape(shape(4))).toBe(false);
  });
});
