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
  isValidKdf,
  keyMatchesCheck,
} from './crypto.js';
import * as keystore from './keystore.js';
import { tr } from '../i18n/index.js';

interface VaultFile {
  version: 1;
  kdf: KdfParams;
  check: Cipher;
  secrets: Record<string, Cipher>;
  touchId: boolean;
}

/** A base64 string that decodes to exactly `bytes` bytes. */
function isB64Len(v: unknown, bytes: number): boolean {
  if (typeof v !== 'string' || !v) return false;
  try {
    return Buffer.from(v, 'base64').length === bytes;
  } catch {
    return false;
  }
}

function isCipher(c: unknown): c is Cipher {
  if (!c || typeof c !== 'object') return false;
  const cc = c as Cipher;
  // Pin the GCM nonce/tag sizes encrypt() always produces (12-byte IV, 16-byte
  // tag): a truncated tag from a hand-edited/imported vault is rejected here, at
  // shape-validation time, not just deferred to decrypt().
  return isB64Len(cc.iv, 12) && isB64Len(cc.tag, 16) && typeof cc.data === 'string';
}

/** Validate the on-disk shape instead of blindly casting arbitrary JSON — a
 *  hand-edited, truncated, or IMPORTED vault.json must read as "not a vault",
 *  never as a half-formed VaultFile that crashes later in decrypt/rekey. The KDF
 *  params are bounded (isValidKdf) so a hostile cost can't OOM/hang/lock-out the
 *  unlock, and version is pinned to 1 so a future format isn't misread as v1.
 *  Exported so the importer can reject a bad bundled vault before persisting it. */
export function isVaultFileShape(d: unknown): d is VaultFile {
  if (!d || typeof d !== 'object') return false;
  const f = d as VaultFile;
  return (
    f.version === 1 &&
    isCipher(f.check) &&
    isValidKdf(f.kdf) &&
    !!f.secrets &&
    typeof f.secrets === 'object'
  );
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
  private corruptHandled = false;
  /** Set when a present vault.json existed but was unusable (tampered / truncated
   *  / hostile KDF / future version). The original bytes are preserved at this
   *  path so the UI can warn instead of silently losing recoverable ciphertext. */
  corruptBackup?: string;

  // ---------- file helpers ----------
  exists(): boolean {
    return fs.existsSync(FILES.vault);
  }

  private read(): VaultFile | null {
    if (this.file) return this.file;
    if (!this.exists()) return null;
    const { data, corruptBackup } = readJson<unknown>(FILES.vault, null);
    if (corruptBackup) this.corruptBackup = corruptBackup;
    if (!isVaultFileShape(data)) {
      // readJson only backs up on a JSON *syntax* error. A file that parses but
      // fails the shape/KDF check (data !== null) would otherwise be silently
      // treated as "no vault" — and a later reset() would then destroy ciphertext
      // that might still be recoverable. Preserve the bytes once.
      if (data !== null && !this.corruptHandled) {
        this.corruptHandled = true;
        try {
          const dest = `${FILES.vault}.corrupt-${Date.now()}`;
          fs.copyFileSync(FILES.vault, dest);
          this.corruptBackup = dest;
        } catch {
          /* best-effort */
        }
      }
      return null;
    }
    this.file = data;
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
    return keystore.isSupported();
  }

  /** Best-effort zeroization of the in-memory master key before dropping it, so
   *  it doesn't linger in a heap buffer for the rest of the process lifetime. */
  private wipeKey(): void {
    if (this.key) this.key.fill(0);
    this.key = null;
  }

  lock(): void {
    this.wipeKey();
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
    if (!keystore.isSupported()) return false;
    if (!keystore.storeKey(this.key.toString('base64'))) return false;
    this.write({ ...(this.read() as VaultFile), touchId: true });
    return true;
  }

  disableTouchId(): void {
    keystore.deleteKey();
    const f = this.read();
    if (f) this.write({ ...f, touchId: false });
  }

  // ---------- unlock ----------
  async unlock(opts: UnlockOptions): Promise<boolean> {
    if (this.isUnlocked()) return true;
    const file = this.read();
    if (!file) return false;

    // 1) Touch ID path.
    if (file.touchId && opts.allowTouchId !== false && keystore.isSupported()) {
      if (keystore.authenticate()) {
        const stored = keystore.loadKey();
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
        if (file.touchId && keystore.isSupported() && !keystore.loadKey()) {
          keystore.storeKey(key.toString('base64'));
        }
        return true;
      }
      opts.onError?.(tr.vault.wrongPassphrase(attempt + 1));
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
    keystore.deleteKey();
    try {
      fs.rmSync(FILES.vault, { force: true });
    } catch {
      /* noop */
    }
    this.file = null;
    this.wipeKey();
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
      throw new Error(tr.vault.rekeyDecryptFailed);
    }

    const kdf = defaultKdf();
    const key = deriveKey(newPassphrase, kdf);
    const secrets: Record<string, Cipher> = {};
    for (const [id, pw] of Object.entries(plain)) secrets[id] = encrypt(key, pw);

    // Re-stash the NEW key in the keychain before recording touchId=true. If the
    // store fails we'd otherwise leave the OLD key behind a NEW check blob —
    // silently breaking every future Touch ID unlock — so drop the keychain entry
    // and persist touchId=false instead of advertising a Touch ID that can't work.
    let keepTouchId = file.touchId;
    if (file.touchId && keystore.isSupported() && !keystore.storeKey(key.toString('base64'))) {
      keystore.deleteKey();
      keepTouchId = false;
    }
    this.write({
      version: 1,
      kdf,
      check: encrypt(key, CHECK_PLAINTEXT),
      secrets,
      touchId: keepTouchId,
    });
    this.wipeKey(); // scrub the old master key before swapping in the new one
    this.key = key;
  }
}

export const vault = new Vault();
