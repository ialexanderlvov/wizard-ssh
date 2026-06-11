/** Optional Linux keyring (Secret Service / libsecret) storage for the vault
 *  master key — the Linux sibling of the macOS Touch ID/Keychain helper. Uses
 *  the `secret-tool` CLI (gnome-keyring, KWallet ≥5.97 via the Secret Service
 *  D-Bus API).
 *
 *  Trade-off (same as Touch ID — do not over-trust): the keyring unlocks with
 *  the login session, so the stored key is readable by ANY process running as
 *  you. It is a convenience layer; the vault passphrase remains the real root
 *  of trust. */

import { capture, commandExists } from '../utils/exec.js';
import { isLinux } from '../utils/platform.js';

const SERVICE = 'wizard-ssh';
const ACCOUNT = 'vault-master-key';
const ATTRS = ['service', SERVICE, 'account', ACCOUNT];

/** The Secret Service is usable: Linux + secret-tool + a session D-Bus. */
export function isSupported(): boolean {
  if (!isLinux || !commandExists('secret-tool')) return false;
  return Boolean(process.env.DBUS_SESSION_BUS_ADDRESS || process.env.XDG_RUNTIME_DIR);
}

export function storeKey(keyBase64: string): boolean {
  if (!isSupported()) return false;
  // secret-tool reads the secret from stdin — the master key never rides argv
  // (visible in the process table), mirroring the macOS `security -w` approach.
  const res = capture(
    'secret-tool',
    ['store', '--label=wizard-ssh vault master key', ...ATTRS],
    `${keyBase64}\n`,
  );
  // Confirm the value actually landed before trusting it (a locked/absent
  // keyring daemon can fail soft).
  return res.status === 0 && loadKey() === keyBase64;
}

export function loadKey(): string | null {
  if (!isSupported()) return null;
  const res = capture('secret-tool', ['lookup', ...ATTRS]);
  if (res.status !== 0) return null;
  const out = res.stdout.trim();
  return out || null;
}

export function deleteKey(): void {
  if (!isLinux || !commandExists('secret-tool')) return;
  capture('secret-tool', ['clear', ...ATTRS]);
}
