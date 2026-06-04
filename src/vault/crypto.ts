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

export function encrypt(key: Buffer, plaintext: string): Cipher {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(key: Buffer, c: Cipher): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(c.tag, 'base64'));
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
