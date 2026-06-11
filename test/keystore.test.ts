// Tests for vault/keystore (and the vault/keyring linux backend).
import { describe, expect, it } from 'vitest';

describe('keystore facade', () => {
  it('label and authenticate stay consistent with the backend kind', async () => {
    const keystore = await import('../src/vault/keystore.js');
    const k = keystore.kind();
    if (k === 'touchid') expect(keystore.label()).toBe('Touch ID');
    else if (k === 'keyring') expect(keystore.label()).toBe('Keyring (Secret Service)');
    else {
      // unsupported box: everything fails closed
      expect(keystore.isSupported()).toBe(false);
      expect(keystore.authenticate()).toBe(false);
      expect(keystore.storeKey('x')).toBe(false);
      expect(keystore.loadKey()).toBeNull();
    }
  });

  it('linux keyring backend is inert off-Linux', async () => {
    const keyring = await import('../src/vault/keyring.js');
    if (process.platform !== 'linux') {
      expect(keyring.isSupported()).toBe(false);
      expect(keyring.storeKey('abc')).toBe(false);
      expect(keyring.loadKey()).toBeNull();
      expect(() => keyring.deleteKey()).not.toThrow();
    }
  });
});
