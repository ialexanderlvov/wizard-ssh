/** Regression tests for the third-round audit fixes:
 *   M-1  ssh-copy-id / rsync / scp option-injection via a leading-dash ~/.ssh/config
 *        alias reaching an inner ssh (assertSafeDestination guard) — local RCE
 *   M-2  EntityCollection.replaceAll silently discarding imported items on a cold
 *        cache over an existing file (`import --replace` data loss)
 *   S-3  a key path with whitespace written unquoted, corrupting the whole config
 *   S-6  ensureDir tightening a user-chosen (external) directory to 0700
 *   S-13 isValidProxyJump accepting an out-of-range hop port
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { freshHome } from './helpers.js';

import { assertSafeDestination } from '../src/ssh/args.js';
import { transferArgv } from '../src/ssh/features.js';
import { EntityCollection } from '../src/store/collection.js';
import { formatBlock } from '../src/ssh-config/writer.js';
import { splitTokens } from '../src/ssh-config/parser.js';
import { isValidProxyJump } from '../src/utils/validators.js';
import type { BaseEntity, Server } from '../src/core/types.js';

const tmpFile = (): string =>
  path.join(mkdtempSync(path.join(os.tmpdir(), 'wssh-af3-')), 'data.json');

const configServer = (alias: string): Server =>
  ({
    kind: 'server',
    id: alias,
    name: alias,
    description: '',
    tags: [],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'sshconfig',
    sshHost: alias,
    host: '',
    user: '',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
  }) as unknown as Server;

describe('M-1: leading-dash destination is rejected before it reaches an inner ssh', () => {
  it('assertSafeDestination throws on a "-" destination, passes otherwise', () => {
    expect(() => assertSafeDestination('-oProxyCommand=touch /tmp/pwned')).toThrow();
    expect(() => assertSafeDestination('user@host')).not.toThrow();
    expect(() => assertSafeDestination('prod')).not.toThrow();
  });

  it('transferArgv (scp) refuses a config alias starting with "-"', () => {
    const evil = configServer('-oProxyCommand=touch${IFS}/tmp/pwned');
    expect(() =>
      transferArgv(evil, { direction: 'upload', localPath: './a', remotePath: '/b', tool: 'scp' }),
    ).toThrow();
  });

  it('transferArgv (rsync) refuses a config alias starting with "-"', () => {
    const evil = configServer('-oProxyCommand=touch${IFS}/tmp/pwned');
    expect(() =>
      transferArgv(evil, {
        direction: 'download',
        localPath: './a',
        remotePath: '/b',
        tool: 'rsync',
      }),
    ).toThrow();
  });

  it('a normal config alias still builds an argv', () => {
    const ok = configServer('prod');
    const { program, args } = transferArgv(ok, {
      direction: 'upload',
      localPath: './a',
      remotePath: '/b',
      tool: 'scp',
    });
    expect(program).toBe('scp');
    expect(args).toContain('prod:/b');
  });
});

describe('M-2: replaceAll over an existing file on a cold cache persists the new items', () => {
  const entity = (id: string): BaseEntity => ({
    id,
    name: id,
    description: '',
    tags: [],
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 0,
  });
  const norm = (raw: unknown): BaseEntity => {
    const r = (raw ?? {}) as Partial<BaseEntity>;
    return { ...entity(r.id ?? 'x'), ...r, name: r.name ?? r.id ?? 'x' };
  };

  it('does not silently re-read and drop the imported items', () => {
    const file = tmpFile();
    // An existing store file (mtime > 0) — the situation `import --replace` hits.
    fs.writeFileSync(file, JSON.stringify({ version: 1, items: [entity('old')] }));

    // A FRESH collection → cold cache (sig=''), mirroring the non-interactive
    // import path where the collection was never loaded at bootstrap.
    const coll = new EntityCollection(file, norm);
    coll.replaceAll([entity('new')]);

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { items: BaseEntity[] };
    expect(onDisk.items.map((i) => i.id)).toEqual(['new']);
    // And a brand-new reader sees only the imported item.
    expect(new EntityCollection(file, norm).all().map((i) => i.id)).toEqual(['new']);
  });
});

describe('S-3: a key path with whitespace is double-quoted (and round-trips)', () => {
  it('quotes IdentityFile with a space so OpenSSH does not reject the config', () => {
    const out = formatBlock({
      alias: 'h',
      params: [{ key: 'IdentityFile', value: '~/My Keys/id_ed25519' }],
    });
    const line = out.find((l) => l.includes('IdentityFile'))!;
    expect(line).toContain('IdentityFile "~/My Keys/id_ed25519"');
    // The parser reads the quoted value back as a single token.
    expect(splitTokens(line.trim().replace(/^IdentityFile\s+/, ''))).toEqual([
      '~/My Keys/id_ed25519',
    ]);
  });

  it('leaves a space-free value unquoted', () => {
    const out = formatBlock({ alias: 'h', params: [{ key: 'HostName', value: '10.0.0.1' }] });
    expect(out).toContain('    HostName 10.0.0.1');
  });
});

describe('S-13: isValidProxyJump range-checks the hop port', () => {
  it('accepts valid hops', () => {
    expect(isValidProxyJump('bastion')).toBe(true);
    expect(isValidProxyJump('user@host:22')).toBe(true);
    expect(isValidProxyJump('host:65535')).toBe(true);
    expect(isValidProxyJump('[::1]:2222')).toBe(true);
    expect(isValidProxyJump('a,b:22,c')).toBe(true);
    expect(isValidProxyJump('none')).toBe(true);
  });
  it('rejects an out-of-range hop port', () => {
    expect(isValidProxyJump('host:0')).toBe(false);
    expect(isValidProxyJump('host:99999')).toBe(false);
    expect(isValidProxyJump('host:65536')).toBe(false);
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
