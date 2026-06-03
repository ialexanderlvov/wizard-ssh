/** Encrypted password store. Secrets are AES-256-GCM blobs keyed by id; the
 *  master key is derived from a passphrase (scrypt) and held only in memory for
 *  the session. Optional macOS Touch ID unlock via the Keychain-backed helper.
 *
 *  The Vault is UI-agnostic: the caller injects a passphrase prompt. */

import fs from 'node:fs';
import { FILES } from '../core/paths.js';
import { readJson, writeJson } from '../store/json-file.js';
import { newId } from '../utils/id.js';
import {
  type Cipher,
  type KdfParams,
  CHECK_PLAINTEXT,
  decrypt,
  defaultKdf,
  deriveKey,
  encrypt,
  keyMatchesCheck,
} from './crypto.js';
import * as touchid from './touchid.js';

interface VaultFile {
  version: 1;
  kdf: KdfParams;
  check: Cipher;
  secrets: Record<string, Cipher>;
  touchId: boolean;
}

export interface UnlockOptions {
  /** Asked when Touch ID is off/unavailable or biometric auth fails. */
  promptPassphrase: () => Promise<string>;
  /** Try Touch ID first when enabled (default true). */
  allowTouchId?: boolean;
  /** Notify the caller of soft failures (wrong passphrase, etc.). */
  onError?: (message: string) => void;
}

class Vault {
  private key: Buffer | null = null;
  private file: VaultFile | null = null;

  // ---------- file helpers ----------
  exists(): boolean {
    return fs.existsSync(FILES.vault);
  }

  private read(): VaultFile | null {
    if (this.file) return this.file;
    if (!this.exists()) return null;
    const { data } = readJson<VaultFile | Record<string, never>>(FILES.vault, {});
    if (!data || !('check' in data) || !('kdf' in data)) return null;
    this.file = data as VaultFile;
    return this.file;
  }

  private write(file: VaultFile): void {
    this.file = file;
    writeJson(FILES.vault, file);
  }

  // ---------- state ----------
  isUnlocked(): boolean {
    return this.key !== null;
  }

  isTouchIdEnabled(): boolean {
    return this.read()?.touchId === true;
  }

  touchIdSupported(): boolean {
    return touchid.isSupported();
  }

  lock(): void {
    this.key = null;
  }

  // ---------- setup ----------
  /** Create a brand-new vault protected by `passphrase`. */
  setup(passphrase: string, opts: { enableTouchId?: boolean } = {}): void {
    const kdf = defaultKdf();
    const key = deriveKey(passphrase, kdf);
    const file: VaultFile = {
      version: 1,
      kdf,
      check: encrypt(key, CHECK_PLAINTEXT),
      secrets: {},
      touchId: false,
    };
    this.write(file);
    this.key = key;
    if (opts.enableTouchId) this.enableTouchId();
  }

  /** Store the live key in the Keychain so Touch ID can release it later. */
  enableTouchId(): boolean {
    if (!this.key || !this.read()) return false;
    if (!touchid.isSupported()) return false;
    if (!touchid.storeKey(this.key.toString('base64'))) return false;
    this.write({ ...(this.read() as VaultFile), touchId: true });
    return true;
  }

  disableTouchId(): void {
    touchid.deleteKey();
    const f = this.read();
    if (f) this.write({ ...f, touchId: false });
  }

  // ---------- unlock ----------
  async unlock(opts: UnlockOptions): Promise<boolean> {
    if (this.isUnlocked()) return true;
    const file = this.read();
    if (!file) return false;

    // 1) Touch ID path.
    if (file.touchId && opts.allowTouchId !== false && touchid.isSupported()) {
      if (touchid.authenticate()) {
        const stored = touchid.loadKey();
        if (stored) {
          const key = Buffer.from(stored, 'base64');
          if (keyMatchesCheck(key, file.check)) {
            this.key = key;
            return true;
          }
        }
      }
      // fall through to passphrase on any biometric/keychain failure
    }

    // 2) Passphrase path (up to 3 attempts).
    for (let attempt = 0; attempt < 3; attempt++) {
      const pass = await opts.promptPassphrase();
      const key = deriveKey(pass, file.kdf);
      if (keyMatchesCheck(key, file.check)) {
        this.key = key;
        // Heal a missing keychain entry so Touch ID keeps working.
        if (file.touchId && touchid.isSupported() && !touchid.loadKey()) {
          touchid.storeKey(key.toString('base64'));
        }
        return true;
      }
      opts.onError?.(`Неверная парольная фраза (попытка ${attempt + 1}/3).`);
    }
    return false;
  }

  // ---------- secrets ----------
  hasSecret(id: string | null | undefined): boolean {
    if (!id) return false;
    return Boolean(this.read()?.secrets[id]);
  }

  /** Encrypt + store a secret; returns its id. Requires an unlocked vault. */
  setSecret(plaintext: string, id = newId()): string {
    if (!this.key) throw new Error('Vault is locked');
    const file = this.read();
    if (!file) throw new Error('Vault not initialised');
    file.secrets[id] = encrypt(this.key, plaintext);
    this.write(file);
    return id;
  }

  getSecret(id: string): string | null {
    if (!this.key) throw new Error('Vault is locked');
    const blob = this.read()?.secrets[id];
    if (!blob) return null;
    try {
      return decrypt(this.key, blob);
    } catch {
      return null;
    }
  }

  removeSecret(id: string | null | undefined): void {
    if (!id) return;
    const file = this.read();
    if (file && file.secrets[id]) {
      delete file.secrets[id];
      this.write(file);
    }
  }

  secretCount(): number {
    return Object.keys(this.read()?.secrets ?? {}).length;
  }

  listSecretIds(): string[] {
    return Object.keys(this.read()?.secrets ?? {});
  }

  /** Wipe the whole vault (e.g. forgotten passphrase). Callers must also clear
   *  any secretId references on entities so they revert to asking each time. */
  reset(): void {
    touchid.deleteKey();
    try {
      fs.rmSync(FILES.vault, { force: true });
    } catch {
      /* noop */
    }
    this.file = null;
    this.key = null;
  }

  /** Re-encrypt the whole vault under a new passphrase. Requires unlocked. */
  rekey(newPassphrase: string): void {
    if (!this.key) throw new Error('Vault is locked');
    const file = this.read();
    if (!file) throw new Error('Vault not initialised');

    const plain: Record<string, string> = {};
    try {
      for (const [id, blob] of Object.entries(file.secrets)) plain[id] = decrypt(this.key, blob);
    } catch {
      // A corrupt/tampered blob would otherwise crash mid-rekey. Bail before
      // touching any state so the existing vault stays intact.
      throw new Error(
        'Не удалось расшифровать часть хранилища (повреждение?). Смена фразы отменена.',
      );
    }

    const kdf = defaultKdf();
    const key = deriveKey(newPassphrase, kdf);
    const secrets: Record<string, Cipher> = {};
    for (const [id, pw] of Object.entries(plain)) secrets[id] = encrypt(key, pw);

    this.write({
      version: 1,
      kdf,
      check: encrypt(key, CHECK_PLAINTEXT),
      secrets,
      touchId: file.touchId,
    });
    this.key = key;
    if (file.touchId && touchid.isSupported()) touchid.storeKey(key.toString('base64'));
  }
}

export const vault = new Vault();
