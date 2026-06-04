import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveVaultPassphrase } from '../src/commands/helpers.js';

const VARS = ['WSSH_VAULT_PASSPHRASE', 'WSSH_VAULT_PASSPHRASE_FILE', 'WSSH_VAULT_PASSPHRASE_CMD'];
const clear = (): void => VARS.forEach((v) => delete process.env[v]);

beforeEach(clear);
afterEach(clear);

describe('resolveVaultPassphrase', () => {
  it('returns null when nothing is set', () => {
    expect(resolveVaultPassphrase()).toBeNull();
  });

  it('reads the direct env var first', () => {
    process.env.WSSH_VAULT_PASSPHRASE = 'secret';
    expect(resolveVaultPassphrase()).toBe('secret');
  });

  it('reads from a file (trailing newline trimmed)', () => {
    const f = path.join(os.tmpdir(), `wssh-pass-${process.pid}`);
    fs.writeFileSync(f, 'fromfile\n');
    process.env.WSSH_VAULT_PASSPHRASE_FILE = f;
    try {
      expect(resolveVaultPassphrase()).toBe('fromfile');
    } finally {
      fs.rmSync(f, { force: true });
    }
  });

  it('reads from a command', () => {
    process.env.WSSH_VAULT_PASSPHRASE_CMD = 'printf hunter2';
    expect(resolveVaultPassphrase()).toBe('hunter2');
  });
});
