// Tests for core/paths.
import { describe, it, expect, vi } from 'vitest';
import fs, { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

describe('paths honour WIZARD_SSH_HOME', () => {
  it('uses the override and creates the dir', async () => {
    vi.resetModules();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-env-'));
    process.env.WIZARD_SSH_HOME = dir;
    const paths = await import('../src/core/paths.js');
    expect(paths.DATA_DIR).toBe(path.resolve(dir));
    paths.ensureDataDir();
    expect(fs.existsSync(dir)).toBe(true);
    delete process.env.WIZARD_SSH_HOME;
  });
});

describe('S-6: ensureDir only tightens directories the app owns', () => {
  it('leaves an external (user-chosen) directory mode untouched, but tightens under DATA_DIR', async () => {
    freshHome();
    vi.resetModules();
    const { ensureDir, DATA_DIR } = await import('../src/core/paths.js');

    // External destination (e.g. `wssh export ~/shared`): a pre-existing 0755 dir
    // must NOT be flipped to 0700.
    const ext = mkdtempSync(path.join(os.tmpdir(), 'wssh-ext-'));
    fs.chmodSync(ext, 0o755);
    ensureDir(ext);
    expect(fs.statSync(ext).mode & 0o777).toBe(0o755);

    // A directory under DATA_DIR is still tightened to 0700.
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const inner = path.join(DATA_DIR, 'sub');
    fs.mkdirSync(inner, { recursive: true });
    fs.chmodSync(inner, 0o755);
    ensureDir(inner);
    expect(fs.statSync(inner).mode & 0o777).toBe(0o700);
  });
});
