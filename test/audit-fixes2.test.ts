/** Regression tests for the second-round audit fixes:
 *   C-1  bash-completion RCE (compgen -W re-expansion + unsafe alias candidates)
 *   C-2  readJson crashing on a valid-JSON non-object (`null`) at startup
 *   I-2  background-log viewer printing raw terminal-escape bytes
 *   L-20 AES-GCM tag/IV length not pinned (downgrade from an edited vault.json)
 *   L-2  import rewinding local usage stats
 *   L-13 tilde() collapsing a sibling home dir
 *   I-17 safeIso() accepting non-ISO date formats
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

async function buildProgram(): Promise<Command> {
  const { registerCommands } = await import('../src/commands/index.js');
  const p = new Command();
  p.name('wssh').enablePositionalOptions();
  registerCommands(p);
  return p;
}

function writeSshConfig(text: string): void {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), text);
}

describe('C-1 bash completion is injection-safe', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('the bash wrapper never re-expands candidates (no compgen -W)', async () => {
    const { completionScript } = await import('../src/commands/completion.js');
    const bash = completionScript('bash');
    expect(bash).not.toContain('compgen -W');
    expect(bash).toContain('while IFS= read -r line'); // literal, prefix-matched
  });

  it('a hostile config-host alias is dropped from completion candidates', async () => {
    writeSshConfig(
      'Host $(touch_pwned)\n  HostName 1.1.1.1\n\nHost prod-web\n  HostName 2.2.2.2\n',
    );
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const cands = completeFromProgram(await buildProgram(), ['connect', '']);
    expect(cands).toContain('prod-web');
    expect(cands.some((c) => c.includes('$('))).toBe(false);
    expect(cands.some((c) => c.includes('`'))).toBe(false);
  });
});

describe('C-2 readJson never crashes on a valid-JSON non-object', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('a file containing `null` reads as the fallback + a corrupt backup', async () => {
    const { readJson } = await import('../src/store/json-file.js');
    const file = path.join(os.homedir(), 'store.json');
    for (const bad of ['null', '42', '"x"', '[1,2]']) {
      fs.writeFileSync(file, bad);
      const res = readJson<{ items?: unknown[] }>(file, { items: [] });
      expect(res.data).toEqual({ items: [] }); // fallback, not the parsed scalar
      expect(res.corruptBackup).toBeTruthy();
      // The original dereference site would now be safe:
      expect(Array.isArray(res.data.items)).toBe(true);
    }
  });
});

describe('I-2 background-log viewer strips terminal escapes', () => {
  it('sanitizeLog/tailLines drop ESC/OSC bytes but keep newlines and tabs', async () => {
    const { tailLines, sanitizeLog } = await import('../src/utils/logtail.js');
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const malicious = `line1${ESC}]0;hijacked-title${BEL}\tcol\nline2`;
    expect(sanitizeLog(malicious)).toBe('line1]0;hijacked-title\tcol\nline2');
    expect(tailLines(malicious, 5)).toEqual(['line1]0;hijacked-title\tcol', 'line2']);
    // a non-integer/zero tail count means "all", not a crash
    expect(tailLines('a\nb\nc', NaN)).toEqual(['a', 'b', 'c']);
  });
});

describe('L-20 AES-GCM tag/IV lengths are pinned', () => {
  it('decrypt rejects a truncated auth tag and a short IV', async () => {
    const crypto = await import('../src/vault/crypto.js');
    const key = crypto.deriveKey('pw', crypto.defaultKdf());
    const blob = crypto.encrypt(key, 'secret');
    expect(crypto.decrypt(key, blob)).toBe('secret'); // round-trips

    // Truncate the 16-byte tag to 4 bytes (the downgrade attack) → rejected.
    const tag4 = Buffer.from(blob.tag, 'base64').subarray(0, 4).toString('base64');
    expect(() => crypto.decrypt(key, { ...blob, tag: tag4 })).toThrow();

    // A non-12-byte IV → rejected.
    const iv8 = Buffer.from(blob.iv, 'base64').subarray(0, 8).toString('base64');
    expect(() => crypto.decrypt(key, { ...blob, iv: iv8 })).toThrow();
  });

  it('isVaultFileShape rejects a vault whose check blob has a truncated tag', async () => {
    const { isVaultFileShape } = await import('../src/vault/vault.js');
    const goodKdf = { salt: 'AAAA', N: 131072, r: 8, p: 1, keylen: 32 };
    const shape = (tagBytes: number) => ({
      version: 1,
      kdf: goodKdf,
      check: {
        iv: Buffer.alloc(12).toString('base64'),
        tag: Buffer.alloc(tagBytes).toString('base64'),
        data: 'c',
      },
      secrets: {},
      touchId: false,
    });
    expect(isVaultFileShape(shape(16))).toBe(true);
    expect(isVaultFileShape(shape(4))).toBe(false);
  });
});

describe('L-2 import does not rewind local usage stats', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });
  it('usage.merge keeps the higher useCount and later lastUsedAt', async () => {
    const { usage } = await import('../src/store/usage.store.js');
    usage.set('box', { useCount: 10, lastUsedAt: '2026-06-01T00:00:00.000Z' });
    usage.merge('box', { useCount: 2, lastUsedAt: '2020-01-01T00:00:00.000Z' });
    expect(usage.get('box').useCount).toBe(10); // not rewound to 2
    expect(usage.get('box').lastUsedAt).toBe('2026-06-01T00:00:00.000Z'); // not rewound
    usage.merge('box', { useCount: 25, lastUsedAt: '2026-06-09T00:00:00.000Z' });
    expect(usage.get('box').useCount).toBe(25); // advances
  });
});

describe('utility hardening', () => {
  it('L-13 tilde does not collapse a sibling home directory', async () => {
    const { tilde } = await import('../src/utils/strings.js');
    const home = os.homedir();
    expect(tilde(home)).toBe('~');
    expect(tilde(path.join(home, 'x'))).toBe(`~${path.sep}x`);
    expect(tilde(home + 'by/secret')).toBe(home + 'by/secret'); // sibling untouched
  });

  it('I-17 safeIso accepts ISO shapes and rejects locale formats', async () => {
    const { safeIso } = await import('../src/utils/time.js');
    expect(safeIso('2026-06-09T10:00:00.000Z', null)).toBe('2026-06-09T10:00:00.000Z');
    expect(safeIso('2026-06-09', null)).toBe('2026-06-09');
    expect(safeIso('12/31/2020', null)).toBeNull(); // locale format rejected
    expect(safeIso('not a date', null)).toBeNull();
  });
});
