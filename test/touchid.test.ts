import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import type { SpawnSyncReturns } from 'node:child_process';
import { freshHome } from './helpers.js';

// touchid is macOS-only; on other platforms isSupported() is always false.
const onMac = process.platform === 'darwin';

function captureResult(
  status: number,
  stdout = '',
): { status: number; stdout: string; stderr: string } {
  return { status, stdout, stderr: '' };
}

async function loadTouchid(opts: {
  swiftc?: boolean;
  captureStatus?: number;
  captureStdout?: string;
  authStatus?: number;
}) {
  vi.resetModules();
  freshHome();
  const commandExists = vi.fn((c: string) => (c === 'swiftc' ? (opts.swiftc ?? true) : true));
  const capture = vi.fn(() => captureResult(opts.captureStatus ?? 0, opts.captureStdout ?? ''));
  const spawnSync = vi.fn((cmd: string, args: readonly string[]) => {
    // swiftc is now invoked by absolute path (/usr/bin/swiftc) to avoid PATH hijack.
    const isSwiftc = cmd === 'swiftc' || cmd.endsWith('/swiftc');
    // emulate swiftc producing the helper binary
    if (isSwiftc && args[2]) fs.writeFileSync(args[2], '#!/bin/sh\n');
    const status = isSwiftc ? 0 : (opts.authStatus ?? 0);
    return { status } as SpawnSyncReturns<string>;
  });
  vi.doMock('../src/utils/exec.js', async (orig) => {
    const actual = await orig<typeof import('../src/utils/exec.js')>();
    return { ...actual, commandExists, capture };
  });
  vi.doMock('node:child_process', async (orig) => {
    const actual = await orig<typeof import('node:child_process')>();
    return { ...actual, spawnSync };
  });
  return { touch: await import('../src/vault/touchid.js'), spawnSync, capture };
}

describe('touchid', () => {
  beforeEach(() => vi.resetModules());

  it('isSupported reflects platform + swiftc', async () => {
    const yes = await loadTouchid({ swiftc: true });
    expect(yes.touch.isSupported()).toBe(onMac);
    const no = await loadTouchid({ swiftc: false });
    expect(no.touch.isSupported()).toBe(false);
  });

  it('keychain store/load/delete go through `security`', async () => {
    // storeKey now fails closed: it confirms the value round-trips via loadKey
    // (no argv fallback), so the mocked `security` must echo back the stored key.
    const { touch, capture } = await loadTouchid({ captureStatus: 0, captureStdout: 'k\n' });
    if (!onMac) {
      expect(touch.storeKey('k')).toBe(false);
      expect(touch.loadKey()).toBeNull();
      return;
    }
    expect(touch.storeKey('k')).toBe(true);
    expect(touch.loadKey()).toBe('k');
    touch.deleteKey();
    expect(capture).toHaveBeenCalled();
  });

  it('storeKey fails closed when the key does not round-trip (no argv fallback)', async () => {
    const { touch } = await loadTouchid({ captureStatus: 0, captureStdout: 'different\n' });
    // On non-mac storeKey is false anyway; on mac the loadKey() mismatch must fail
    // it rather than silently falling back to the argv form.
    expect(touch.storeKey('k')).toBe(false);
  });

  it('loadKey returns null on non-zero status', async () => {
    const { touch } = await loadTouchid({ captureStatus: 1 });
    expect(touch.loadKey()).toBeNull();
  });

  it.skipIf(!onMac)('authenticate compiles the helper then runs it', async () => {
    const ok = await loadTouchid({ swiftc: true, authStatus: 0 });
    expect(ok.touch.authenticate('reason')).toBe(true);
    const fail = await loadTouchid({ swiftc: true, authStatus: 1 });
    expect(fail.touch.authenticate()).toBe(false);
  });

  it.skipIf(!onMac)('authenticate is false when swiftc is unavailable', async () => {
    const { touch } = await loadTouchid({ swiftc: false });
    expect(touch.authenticate()).toBe(false);
  });
});
