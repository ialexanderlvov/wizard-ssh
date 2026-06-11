/** Platform keystore facade for the vault master key: Touch ID + Keychain on
 *  macOS, Secret Service (libsecret) on Linux. The vault stores ONE flag for
 *  "OS keystore unlock enabled" (historically named `touchId`) and routes every
 *  store/load/delete through here, so the two backends can't drift. */

import * as touchid from './touchid.js';
import * as keyring from './keyring.js';
import { isMac, isLinux } from '../utils/platform.js';

export type KeystoreKind = 'touchid' | 'keyring';

export function kind(): KeystoreKind | null {
  if (isMac && touchid.isSupported()) return 'touchid';
  if (isLinux && keyring.isSupported()) return 'keyring';
  return null;
}

export const isSupported = (): boolean => kind() !== null;

/** Technical display name — intentionally the same in every locale (and
 *  indeclinable, so it composes safely into RU sentences). On unsupported
 *  boxes fall back to the PLATFORM-expected backend, not to Touch ID — a Linux
 *  machine without secret-tool must not be told about Touch ID. */
export function label(): string {
  const k = kind() ?? (isMac ? 'touchid' : 'keyring');
  return k === 'keyring' ? 'Keyring (Secret Service)' : 'Touch ID';
}

/** Gate before releasing the key. Touch ID shows the biometric prompt; the
 *  Linux keyring is already gated by the login session (no extra prompt). */
export function authenticate(): boolean {
  const k = kind();
  if (k === 'touchid') return touchid.authenticate();
  return k === 'keyring';
}

export function storeKey(keyBase64: string): boolean {
  const k = kind();
  if (k === 'touchid') return touchid.storeKey(keyBase64);
  if (k === 'keyring') return keyring.storeKey(keyBase64);
  return false;
}

export function loadKey(): string | null {
  const k = kind();
  if (k === 'touchid') return touchid.loadKey();
  if (k === 'keyring') return keyring.loadKey();
  return null;
}

/** Clear both backends — a vault reset/disable must leave no copy anywhere
 *  (e.g. after switching platforms via a synced home directory). */
export function deleteKey(): void {
  touchid.deleteKey();
  keyring.deleteKey();
}
