import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, stripAnsi } from './helpers.js';
import { capture, commandExists } from '../src/utils/exec.js';
import { isValidPort, isValidHostOrIp, isValidSshAlias } from '../src/utils/validators.js';
import { normalizeBase, normalizeConnection, asRaw } from '../src/store/normalize.js';
import { EntityCollection } from '../src/store/collection.js';
import type { BaseEntity, Server, Tunnel } from '../src/core/types.js';
import { targetSummary, forwardSummary, entityLine, detailBox } from '../src/ui/format.js';

const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};

describe('exec branches', () => {
  it('capture pipes input and returns output', () => {
    const r = capture(
      'node',
      ['-e', 'process.stdin.on("data",(d)=>process.stdout.write(d))'],
      'echoed',
    );
    expect(r.stdout).toBe('echoed');
  });
  it('capture of a missing command yields empty strings + non-zero status', () => {
    const r = capture('definitely-not-real-xyz', []);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.status).not.toBe(0);
  });
  it('commandExists uses "where" on Windows', async () => {
    vi.resetModules();
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const { commandExists: ce } = await import('../src/utils/exec.js');
      expect(typeof ce('node')).toBe('boolean'); // exercises the 'where' branch
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
  it('commandExists is truthy for node', () => {
    expect(commandExists('node')).toBe(true);
  });
});

describe('validators branches', () => {
  it('isValidPort rejects non-numbers and out-of-range', () => {
    expect(isValidPort('abc')).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort('65536')).toBe(false);
  });
  it('isValidHostOrIp rejects non-strings, empty, bad octets', () => {
    expect(isValidHostOrIp(123)).toBe(false);
    expect(isValidHostOrIp('')).toBe(false);
    expect(isValidHostOrIp('256.1.1.1')).toBe(false);
  });
  it('isValidSshAlias rejects non-strings', () => {
    expect(isValidSshAlias(123)).toBe(false);
    expect(isValidSshAlias('')).toBe(false);
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

describe('format branches', () => {
  const server = (o: Partial<Server> = {}): Server => ({
    kind: 'server',
    id: 's',
    name: 'srv',
    description: '',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'manual',
    sshHost: '',
    host: '1.1.1.1',
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: null,
    ...o,
  });
  const tunnel = (o: Partial<Tunnel> = {}): Tunnel => ({
    ...server(o as Partial<Server>),
    kind: 'tunnel',
    type: 'local',
    localPort: 8181,
    remoteHost: '127.0.0.1',
    remotePort: 81,
    openBrowser: true,
    ...o,
  });

  it('targetSummary omits :port for the default ssh port', () => {
    expect(targetSummary(server({ sshPort: 22 }))).toBe('root@1.1.1.1');
    expect(targetSummary(server({ sshPort: 2200 }))).toBe('root@1.1.1.1:2200');
  });
  it('forwardSummary remote falls back to localhost', () => {
    expect(
      forwardSummary(tunnel({ type: 'remote', remotePort: 9000, remoteHost: '', localPort: 3000 })),
    ).toContain('localhost');
  });
  it('entityLine without tags/description', () => {
    expect(stripAnsi(entityLine(server({ description: '', tags: [] })))).toContain('srv');
  });
  it('detailBox: sshconfig server with link, no description, no tags', () => {
    const box = stripAnsi(
      detailBox(server({ hostMode: 'sshconfig', sshHost: 'alias', linkedSshHost: 'alias' })),
    );
    expect(box).toContain('alias');
  });
  it('detailBox: dynamic tunnel (no localhost url) + remote tunnel', () => {
    expect(stripAnsi(detailBox(tunnel({ type: 'dynamic', localPort: 1080 })))).toContain('srv');
    expect(
      stripAnsi(detailBox(tunnel({ type: 'remote', remotePort: 9000, localPort: 3000 }))),
    ).toContain('srv');
  });
});

describe('migration branch combinations', () => {
  it('empty tunnels + no settings → 0', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tunnels.json'), JSON.stringify({ tunnels: [] }));
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(0);
  });

  it('non-array tunnels field → 0', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tunnels.json'), JSON.stringify({ tunnels: 'oops' }));
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(0);
  });

  it('partial legacy settings (only remoteHost)', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tunnels.json'),
      JSON.stringify({
        settings: { defaultRemoteHost: '10.9.9.9' },
        tunnels: [{ name: 't', host: '1.1.1.1', type: 'local', localPort: 1, remotePort: 1 }],
      }),
    );
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(1);
    const { settings } = await import('../src/store/settings.store.js');
    expect(settings.get().defaultRemoteHost).toBe('10.9.9.9');
    expect(settings.get().defaultUser).toBe('root'); // default kept
  });
});

describe('ssh-config parser branches', () => {
  it('filters wildcard/negated aliases and reads extra params', async () => {
    vi.resetModules();
    freshHome();
    writeConfig(
      [
        'Host real !nope srv?',
        '    HostName 1.1.1.1',
        '    IdentityFile ~/.ssh/id',
        '    ProxyJump bastion',
        'Host=eqstyle',
        '    User x',
      ].join('\n'),
    );
    const cfg = await import('../src/ssh-config/index.js');
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('real');
    expect(aliases).toContain('eqstyle'); // "Host=value" syntax
    expect(aliases).not.toContain('!nope');
    expect(aliases).not.toContain('srv?');
    const real = cfg.getHost('real');
    expect(real?.identityFile).toBe('~/.ssh/id');
    expect(real?.proxyJump).toBe('bastion');
  });

  it('expands a ~/ Include glob', async () => {
    vi.resetModules();
    freshHome();
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(path.join(sshDir, 'c.d'), { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'c.d', 'extra.conf'), 'Host inc\n    HostName 2.2.2.2\n');
    writeConfig('Include ~/.ssh/c.d/*.conf\nHost base\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toContain('inc');
  });
});

describe('touchid on a non-macOS platform', () => {
  it('reports unsupported and no-ops keychain ops', async () => {
    vi.resetModules();
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      vi.doMock('../src/utils/exec.js', async (o) => {
        const a = await o<typeof import('../src/utils/exec.js')>();
        return {
          ...a,
          commandExists: () => true,
          capture: () => ({ status: 0, stdout: '', stderr: '' }),
        };
      });
      const touch = await import('../src/vault/touchid.js');
      expect(touch.isSupported()).toBe(false);
      expect(touch.storeKey('k')).toBe(false);
      expect(touch.loadKey()).toBeNull();
      touch.deleteKey();
      expect(touch.authenticate()).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
});

describe('vault: Touch ID keychain self-heal on passphrase unlock', () => {
  it('re-stores the key when the keychain entry is missing', async () => {
    vi.resetModules();
    freshHome();
    const storeKey = vi.fn(() => true);
    vi.doMock('../src/vault/touchid.js', () => ({
      isSupported: () => true,
      authenticate: () => true,
      storeKey,
      loadKey: () => null, // keychain "empty"
      deleteKey: () => {},
    }));
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master', { enableTouchId: true });
    vault.lock();
    // touch path: authenticate ok but loadKey null → fall back to passphrase → heal
    const ok = await vault.unlock({
      allowTouchId: true,
      promptPassphrase: async () => 'master',
      onError: () => {},
    });
    expect(ok).toBe(true);
    expect(storeKey).toHaveBeenCalled();
  });
});
