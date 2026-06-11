import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs, { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../src/store/json-file.js';
import { EntityCollection } from '../src/store/collection.js';
import { normalizeBase, normalizeConnection, asRaw } from '../src/store/normalize.js';
import type { BaseEntity } from '../src/core/types.js';
import { freshHome } from './helpers.js';

const tmpFile = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-jf-')), 'data.json');

describe('json-file', () => {
  it('missing file → fallback', () => {
    const { data, corruptBackup } = readJson(
      path.join(os.tmpdir(), 'nope-' + Date.now(), 'x.json'),
      { v: 1 },
    );
    expect(data).toEqual({ v: 1 });
    expect(corruptBackup).toBeUndefined();
  });

  it('write then read round-trips and is 0600', () => {
    const f = tmpFile();
    writeJson(f, { hello: 'world', n: 42 });
    expect(readJson(f, {}).data).toEqual({ hello: 'world', n: 42 });
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });

  it('corrupt file → backup + fallback', () => {
    const f = tmpFile();
    fs.writeFileSync(f, '{ not json');
    const { data, corruptBackup } = readJson<{ items: unknown[] }>(f, { items: [] });
    expect(data).toEqual({ items: [] });
    expect(corruptBackup).toContain('.corrupt-');
    expect(fs.existsSync(corruptBackup as string)).toBe(true);
  });
});

describe('normalize helpers', () => {
  it('normalizeBase fills defaults and coerces', () => {
    const b = normalizeBase(asRaw({ name: '  srv ', useCount: '3', tags: ['a', 1, 'b'] }));
    expect(b.name).toBe('srv');
    expect(b.id).toBeTruthy();
    expect(b.useCount).toBe(3);
    expect(b.tags).toEqual(['a', 'b']);
    expect(Number.isNaN(Date.parse(b.createdAt))).toBe(false);
    expect(b.lastUsedAt).toBeNull();
  });

  it('normalizeBase drops invalid dates', () => {
    const b = normalizeBase(
      asRaw({ name: 'x', createdAt: 'bad', updatedAt: 'bad', lastUsedAt: 'bad' }),
    );
    expect(Number.isNaN(Date.parse(b.createdAt))).toBe(false);
    expect(b.lastUsedAt).toBeNull();
  });

  it('normalizeConnection clamps enums + defaults', () => {
    expect(normalizeConnection(asRaw({}))).toMatchObject({
      hostMode: 'manual',
      auth: 'agent',
      sshPort: 22,
    });
    expect(normalizeConnection(asRaw({ hostMode: 'sshconfig', auth: 'bogus' }))).toMatchObject({
      hostMode: 'sshconfig',
      auth: 'agent',
    });
    expect(normalizeConnection(asRaw({ keyPath: '/k', secretId: 's1' }))).toMatchObject({
      keyPath: '/k',
      secretId: 's1',
    });
  });
});

describe('EntityCollection', () => {
  const make = (file: string) =>
    new EntityCollection<BaseEntity>(file, (r) => normalizeBase(asRaw(r)));

  it('CRUD + persistence + uniqueness', () => {
    const f = tmpFile();
    const c = make(f);
    const a = c.create({ name: 'alpha' });
    const b = c.create({ name: 'beta' });
    expect(c.all()).toHaveLength(2);
    expect(c.findById(a.id)?.name).toBe('alpha');
    expect(c.findByName('BETA')?.id).toBe(b.id);
    expect(c.nameExists('alpha')).toBe(true);
    expect(c.nameExists('alpha', a.id)).toBe(false);

    const up = c.update(a.id, { description: 'edited' });
    expect(up?.description).toBe('edited');
    expect(c.update('missing', { name: 'x' })).toBeNull();

    // persistence: a fresh instance reads the same file
    expect(make(f).findByName('alpha')?.description).toBe('edited');

    expect(c.remove(b.id)).toBe(true);
    expect(c.remove('missing')).toBe(false);
    expect(c.all()).toHaveLength(1);
  });

  it('touch bumps usage; sorting honours it', () => {
    const f = tmpFile();
    const c = make(f);
    const a = c.create({ name: 'aaa' });
    c.create({ name: 'bbb' });
    expect(c.touch(a.id)).toBe(true);
    expect(c.touch('missing')).toBe(false);
    expect(c.findById(a.id)?.useCount).toBe(1);
    expect(c.sorted('recent')[0]?.name).toBe('aaa');
    expect(c.sorted('uses')[0]?.name).toBe('aaa');
    expect(c.sorted('name')[0]?.name).toBe('aaa');
    expect(c.sorted('name', true)[0]?.name).toBe('bbb');
    expect(c.sorted('created')).toHaveLength(2);
    expect(c.sorted('updated')).toHaveLength(2);
  });

  it('replaceAll + corruption recovery', () => {
    const f = tmpFile();
    fs.writeFileSync(f, 'totally broken');
    const c = make(f);
    expect(c.all()).toEqual([]);
    expect(c.corruptBackup).toBeTruthy();
    c.replaceAll([normalizeBase(asRaw({ name: 'imported' }))]);
    expect(make(f).all()[0]?.name).toBe('imported');
  });
});

describe('store singletons (isolated home)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('servers store normalizes and persists', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.create({ name: 'web', host: '1.2.3.4', kind: 'server' });
    expect(s.kind).toBe('server');
    // a config-backed server is ALWAYS hostMode 'sshconfig'
    expect(s.hostMode).toBe('sshconfig');
    expect(s.host).toBe('1.2.3.4');
    // re-read from ~/.ssh/config via the facade
    expect(servers.findByName('web')?.host).toBe('1.2.3.4');
    // and the single source of truth itself contains the Host block
    const configText = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    expect(configText).toContain('Host web');
    vi.resetModules();
    const { servers: reloaded } = await import('../src/store/servers.store.js');
    expect(reloaded.all()).toHaveLength(1);
  });

  it('tunnels store normalizes forward fields', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'npm',
      type: 'local',
      localPort: 8181,
      remotePort: 81,
      kind: 'tunnel',
    });
    expect(t.kind).toBe('tunnel');
    expect(t.type).toBe('local');
    expect(t.remoteHost).toBe('127.0.0.1');
    expect(tunnels.findByName('npm')?.localPort).toBe(8181);
  });

  it('settings store merges defaults + persists', async () => {
    const { settings } = await import('../src/store/settings.store.js');
    expect(settings.get().defaultUser).toBe('root');
    settings.update({ defaultUser: 'deploy', vault: { enabled: true, touchId: false } });
    expect(settings.get().defaultUser).toBe('deploy');
    expect(settings.get().vault.enabled).toBe(true);
    // unrelated defaults survive the partial update
    expect(settings.get().defaultSshPort).toBe(22);
  });
});

describe('migration from legacy ~/.ssh-tunnel-manager', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('imports legacy tunnels once', async () => {
    const legacyDir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'tunnels.json'),
      JSON.stringify({
        settings: { defaultUser: 'legacyuser', defaultSshPort: 2200 },
        tunnels: [
          { name: 'old-tunnel', host: '10.0.0.9', type: 'local', localPort: 9000, remotePort: 90 },
        ],
      }),
    );
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(1);
    const { tunnels } = await import('../src/store/tunnels.store.js');
    expect(tunnels.findByName('old-tunnel')?.host).toBe('10.0.0.9');
    const { settings } = await import('../src/store/settings.store.js');
    expect(settings.get().defaultUser).toBe('legacyuser');
    // second run is a no-op (new file now exists)
    expect(runMigration()).toBe(0);
  });

  it('no legacy file → no migration', async () => {
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(0);
  });
});

describe('normalize branches', () => {
  it('asRaw coerces non-objects to {}', () => {
    expect(asRaw(null)).toEqual({});
    expect(asRaw(42)).toEqual({});
    expect(asRaw('x')).toEqual({});
  });
  it('normalizeConnection coerces numbers + null secret/key', () => {
    const c = normalizeConnection(asRaw({ sshPort: '2222', keyPath: '', secretId: '' }));
    expect(c.sshPort).toBe(2222);
    expect(c.keyPath).toBeNull();
    expect(c.secretId).toBeNull();
  });
  it('normalizeBase coerces a non-array tags field to []', () => {
    expect(normalizeBase(asRaw({ name: 'x', tags: 'notarray' })).tags).toEqual([]);
  });
});

describe('collection branches', () => {
  const tmp = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'col-')), 'd.json');
  const make = (f: string) => new EntityCollection<BaseEntity>(f, (r) => normalizeBase(asRaw(r)));

  it('sorted falls back to recent for an unknown key', () => {
    const c = make(tmp());
    c.create({ name: 'b' });
    c.create({ name: 'a' });
    // @ts-expect-error intentional bad sort key → recent fallback
    expect(c.sorted('bogus')).toHaveLength(2);
  });
  it('findByName("") returns null', () => {
    const c = make(tmp());
    expect(c.findByName('')).toBeNull();
  });
  it('update on a missing id returns null', () => {
    expect(make(tmp()).update('nope', { name: 'x' })).toBeNull();
  });
});

const ESC = String.fromCharCode(27); // \x1b — the prefix of every terminal escape
const BEL = String.fromCharCode(7); // \x07 — OSC string terminator

function writeSshConfig(text: string, file = 'config'): string {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, text);
  return p;
}

describe('#2 control/escape bytes are stripped from connection fields', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('server fields parsed from ~/.ssh/config carry no control bytes', async () => {
    writeSshConfig(
      `Host evil${ESC}[31m\n` +
        `    HostName 1.2.3.4${ESC}]0;pwned${BEL}\n` +
        `    User ad${ESC}min\n` +
        `    ProxyJump bast${ESC}ion\n`,
    );
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.all()[0];
    expect(s).toBeTruthy();
    for (const v of [s!.name, s!.sshHost, s!.host, s!.user, s!.proxyJump ?? '']) {
      expect(v).not.toContain(ESC);
      expect(v).not.toContain(BEL);
    }
  });

  it('normalizeConnection strips control bytes from tunnel fields', async () => {
    const { normalizeConnection } = await import('../src/store/normalize.js');
    const c = normalizeConnection({
      host: `a${ESC}b`,
      user: `u${BEL}`,
      sshHost: `s${ESC}h`,
      keyPath: `/k${ESC}p`,
    });
    expect(c.host).toBe('ab');
    expect(c.user).toBe('u');
    expect(c.sshHost).toBe('sh');
    expect(c.keyPath).toBe('/kp');
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

const tmpFileAf3 = (): string =>
  path.join(mkdtempSync(path.join(os.tmpdir(), 'wssh-af3-')), 'data.json');

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
    const file = tmpFileAf3();
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
