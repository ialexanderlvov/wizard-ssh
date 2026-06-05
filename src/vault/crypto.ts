/** Symmetric crypto primitives for the password vault.
 *  Key = scrypt(passphrase, salt); payload = AES-256-GCM. */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export interface KdfParams {
  salt: string; // base64
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export interface Cipher {
  iv: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
}

/** A known constant encrypted at setup to verify a passphrase/key on unlock. */
export const CHECK_PLAINTEXT = 'wizard-ssh::vault::ok';

export function defaultKdf(): KdfParams {
  // N=2^17 (~128 MiB), r=8, p=1 — the OWASP-recommended scrypt cost for a
  // password-derived key. The params are stored per-vault, so an existing vault
  // keeps decrypting with its own (older) N and only re-keying adopts this one.
  return { salt: randomBytes(16).toString('base64'), N: 131072, r: 8, p: 1, keylen: 32 };
}

/** Validate KDF params BEFORE they reach scryptSync. A hand-edited or imported
 *  vault.json is untrusted input: missing keylen/r crashes deriveKey (TypeError),
 *  a non-power-of-two N throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS and permanently
 *  locks the user out, and a huge N hangs the event loop or blows past maxmem
 *  (OOM). We require a power-of-two N in a bounded cost range, sane r/p, a 32-byte
 *  AES-256 key, and cap the real scrypt memory (128*N*r) at ~1 GiB. */
export function isValidKdf(kdf: unknown): kdf is KdfParams {
  if (!kdf || typeof kdf !== 'object') return false;
  const k = kdf as KdfParams;
  if (typeof k.salt !== 'string' || !k.salt) return false;
  const fields = [k.N, k.r, k.p, k.keylen];
  if (!fields.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)) return false;
  if ((k.N & (k.N - 1)) !== 0 || k.N < 1 << 14 || k.N > 1 << 21) return false; // power of two, 2^14..2^21
  if (k.r < 1 || k.r > 16) return false;
  if (k.p < 1 || k.p > 4) return false; // p>4 buys nothing on one machine
  if (k.keylen !== 32) return false; // AES-256-GCM key length
  if (128 * k.N * k.r > 1 << 30) return false; // cap real scrypt MEMORY at ~1 GiB
  // scrypt CPU work is O(N*r*p); the memory cap omits p, so a large p (within the
  // r/N bounds) could still freeze the single-threaded unlock for tens of seconds
  // (a DoS via an imported/hand-edited vault.json). Bound the work product to a
  // few × the default (default N*r*p = 2^17*8*1 = 2^20 ≈ 1M).
  if (k.N * k.r * k.p > 1 << 23) return false; // ≈ 8M, ~8× the default cost
  return true;
}

export function deriveKey(passphrase: string, kdf: KdfParams): Buffer {
  const salt = Buffer.from(kdf.salt, 'base64');
  // maxmem must exceed 128*N*r bytes; give headroom.
  return scryptSync(passphrase, salt, kdf.keylen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * kdf.N * kdf.r,
  });
}

/** GCM nonce/tag sizes we always produce — anything else on disk is corrupt or
 *  hostile and is rejected before it reaches the cipher. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encrypt(key: Buffer, plaintext: string): Cipher {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(key: Buffer, c: Cipher): string {
  const iv = Buffer.from(c.iv, 'base64');
  const tag = Buffer.from(c.tag, 'base64');
  // encrypt() always emits a 12-byte IV and a full 16-byte GCM tag. Node would
  // otherwise accept a TRUNCATED tag (4/8/12 bytes — only a deprecation warning),
  // collapsing forgery resistance from 2^128 toward 2^32; and any IV length >= 1.
  // A hand-edited / imported vault.json is untrusted, so reject a downgraded nonce
  // or tag outright instead of feeding it to the cipher.
  if (iv.length !== IV_BYTES) throw new Error('bad GCM nonce length');
  if (tag.length !== TAG_BYTES) throw new Error('bad GCM tag length');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(Buffer.from(c.data, 'base64')), decipher.final()]);
  return out.toString('utf8');
}

/** Verify a key decrypts the check blob to the expected constant. */
export function keyMatchesCheck(key: Buffer, check: Cipher): boolean {
  try {
    const plain = decrypt(key, check);
    const a = Buffer.from(plain);
    const b = Buffer.from(CHECK_PLAINTEXT);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
