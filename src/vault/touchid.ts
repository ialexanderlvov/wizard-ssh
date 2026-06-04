/** Optional macOS Touch ID unlock + Keychain-backed key storage.
 *
 *  Strategy: the vault's 32-byte AES key is stashed in the login Keychain via
 *  the system `security` tool. A tiny Swift helper (compiled once, cached under
 *  ~/.wizard-ssh/bin) shows a biometric prompt; on success THIS CLI then reads
 *  the key from the Keychain. If Touch ID hardware / Command Line Tools are
 *  missing we report unsupported and the caller falls back to the passphrase.
 *
 *  Trade-off (IMPORTANT — do not over-trust this): the biometric prompt is a UX
 *  gate inside this CLI, NOT an OS-enforced access control on the key. The
 *  `security` tool cannot attach a biometric ACL, so the Keychain item is a
 *  plain generic-password readable by ANY process running as you (via
 *  `security find-generic-password`) WITHOUT Touch ID. This is a convenience
 *  layer for same-user use, not a hardware-bound secret; the vault passphrase
 *  remains the real root of trust. (A future hardening would store + release the
 *  key inside the Swift helper under a SecAccessControl biometric ACL.) */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FILES, ensureDir } from '../core/paths.js';
import { isMac } from '../utils/platform.js';
import { commandExists, capture } from '../utils/exec.js';
import { tr } from '../i18n/index.js';

const KEYCHAIN_SERVICE = 'wizard-ssh';
const KEYCHAIN_ACCOUNT = 'vault-master-key';
const HELPER_BIN = path.join(FILES.binDir, 'wssh-touchid');
const HELPER_SRC = path.join(FILES.binDir, 'wssh-touchid.swift');

const SWIFT_SOURCE = `import LocalAuthentication
import Foundation

let ctx = LAContext()
ctx.localizedFallbackTitle = ""
var err: NSError?
let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "unlock wizard-ssh"
if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
  let sem = DispatchSemaphore(value: 0)
  var ok = false
  ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
    ok = success
    sem.signal()
  }
  sem.wait()
  exit(ok ? 0 : 1)
} else {
  exit(2)
}
`;

/** Touch ID can be used on this machine (macOS + swiftc available). */
export function isSupported(): boolean {
  return isMac && commandExists('swiftc');
}

/** Compile (once) and cache the biometric helper binary. */
function ensureHelper(): boolean {
  if (fs.existsSync(HELPER_BIN)) return true;
  if (!isSupported()) return false;
  try {
    ensureDir(FILES.binDir);
    fs.writeFileSync(HELPER_SRC, SWIFT_SOURCE, { mode: 0o600 });
    const res = spawnSync('swiftc', ['-O', '-o', HELPER_BIN, HELPER_SRC], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return res.status === 0 && fs.existsSync(HELPER_BIN);
  } catch {
    return false;
  }
}

/** Show the Touch ID prompt. Resolves true only on a successful match. */
export function authenticate(reason = tr.vault.touchidReason): boolean {
  if (!ensureHelper()) return false;
  const res = spawnSync(HELPER_BIN, [reason], { stdio: 'inherit', timeout: 60_000 });
  return res.status === 0;
}

// ---------- Keychain (via the system `security` tool) ----------

export function storeKey(keyBase64: string): boolean {
  if (!isMac) return false;
  const common = ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT];
  // Prefer feeding the key over stdin so the 32-byte master key never appears as
  // an argv token (which is visible in the process table to other processes). A
  // trailing `-w` with no value reads the password from stdin; on a tty it also
  // asks for a retype, so we send it twice. `security` returns 0 even on a retype
  // mismatch, so confirm the value actually landed via loadKey() before trusting.
  const viaStdin = capture('security', [...common, '-w'], `${keyBase64}\n${keyBase64}\n`);
  if (viaStdin.status === 0 && loadKey() === keyBase64) return true;
  // Fallback: if a given macOS build won't take the key from stdin here, use the
  // argv form so Touch ID keeps working. The brief argv exposure is no worse than
  // the documented same-user readability of the keychain item itself.
  const viaArg = capture('security', [...common, '-w', keyBase64]);
  return viaArg.status === 0;
}

export function loadKey(): string | null {
  if (!isMac) return null;
  const res = capture('security', [
    'find-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    KEYCHAIN_ACCOUNT,
    '-w',
  ]);
  if (res.status !== 0) return null;
  const out = res.stdout.trim();
  return out || null;
}

export function deleteKey(): void {
  if (!isMac) return;
  capture('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT]);
}
