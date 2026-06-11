/** Regression coverage for the 2026-06 feature batch: ssh-agent integration,
 *  remote path browser parsing, autostart unit generation, command snippets,
 *  tunnel tag profiles and the keystore facade. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshHome } from './helpers.js';

describe('ssh-agent: parseAgentList', () => {
  it('parses ssh-add -l lines into identities', async () => {
    const { parseAgentList } = await import('../src/ssh/agent.js');
    const out = parseAgentList(
      '256 SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8 user@host (ED25519)\n' +
        '4096 SHA256:8sMd9Rhc7bztspbqLD40aaaab7YPMXRolIdLnASxqWg work key (RSA)\n',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ bits: 256, type: 'ED25519', comment: 'user@host' });
    expect(out[1]).toMatchObject({ bits: 4096, type: 'RSA', comment: 'work key' });
    expect(out[1]?.fingerprint).toMatch(/^SHA256:/);
  });

  it('returns [] for noise / empty output', async () => {
    const { parseAgentList } = await import('../src/ssh/agent.js');
    expect(parseAgentList('')).toEqual([]);
    expect(parseAgentList('The agent has no identities.\n')).toEqual([]);
  });
});

describe('remote picker: parseRemoteListing', () => {
  it('reads pwd then entries, dirs first and stripped of the / suffix', async () => {
    const { parseRemoteListing } = await import('../src/commands/remote-picker.js');
    const res = parseRemoteListing('/home/user\nzeta.txt\napp/\n.config/\nREADME\n');
    expect(res).not.toBeNull();
    expect(res?.dir).toBe('/home/user');
    expect(res?.entries.map((e) => e.name)).toEqual(['.config', 'app', 'README', 'zeta.txt']);
    expect(res?.entries.map((e) => e.isDir)).toEqual([true, true, false, false]);
  });

  it('rejects output whose first line is not an absolute dir (pwd failed)', async () => {
    const { parseRemoteListing } = await import('../src/commands/remote-picker.js');
    expect(parseRemoteListing('sh: cd: no such directory\n')).toBeNull();
    expect(parseRemoteListing('')).toBeNull();
  });
});

const TUNNEL = {
  id: 'abc123',
  name: 'db',
  description: '',
  tags: ['work'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  useCount: 0,
  kind: 'tunnel' as const,
  hostMode: 'manual' as const,
  sshHost: '',
  host: 'db.example.com',
  user: 'root',
  sshPort: 22,
  auth: 'key' as const,
  keyPath: '/tmp/key with space',
  secretId: null,
  type: 'local' as const,
  localPort: 5432,
  remoteHost: '127.0.0.1',
  remotePort: 5432,
  openBrowser: false,
};

describe('autostart unit generation', () => {
  it('systemd unit quotes every ExecStart token and restarts always', async () => {
    const { buildSystemdUnit } = await import('../src/ssh/autostart.js');
    const unit = buildSystemdUnit(TUNNEL, '/usr/bin/ssh');
    expect(unit).toContain('Description=wizard-ssh tunnel db');
    expect(unit).toContain('ExecStart="/usr/bin/ssh" "-N" "-L" "5432:127.0.0.1:5432"');
    // a key path with a space must survive as ONE token
    expect(unit).toContain('"/tmp/key with space"');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('launchd plist XML-escapes args and keeps the job alive', async () => {
    const { buildLaunchdPlist } = await import('../src/ssh/autostart.js');
    const evil = { ...TUNNEL, host: 'a&b<c>.example.com' };
    const plist = buildLaunchdPlist(evil, '/usr/bin/ssh', '/tmp/log');
    expect(plist).toContain('<string>root@a&amp;b&lt;c&gt;.example.com</string>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>com.wizard-ssh.tunnel.abc123</string>');
    expect(plist).not.toContain('a&b<c>'); // nothing unescaped leaks into the XML
  });
});

describe('snippets store', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('add / find / forServer / remove round-trip', async () => {
    const { snippets } = await import('../src/store/snippets.store.js');
    const global = snippets.add({ name: 'uptime', command: 'uptime', server: null });
    snippets.add({ name: 'deploy', command: 'git pull', server: 'prod' });

    expect(snippets.all()).toHaveLength(2);
    expect(snippets.nameExists('UPTIME')).toBe(true); // case-insensitive
    expect(snippets.findByName('deploy')?.server).toBe('prod');

    // per-server view: own + global, never another server's
    expect(snippets.forServer('prod').map((s) => s.name)).toEqual(['uptime', 'deploy']);
    expect(snippets.forServer('staging').map((s) => s.name)).toEqual(['uptime']);

    snippets.remove(global.id);
    expect(snippets.all().map((s) => s.name)).toEqual(['deploy']);
  });

  it('drops malformed records on load instead of crashing', async () => {
    const fs = await import('node:fs');
    const { FILES, ensureDataDir } = await import('../src/core/paths.js');
    ensureDataDir();
    fs.writeFileSync(
      FILES.snippets,
      JSON.stringify({
        version: 1,
        snippets: [
          { id: '1', name: 'ok', command: 'ls', server: null },
          { id: '2', name: '', command: 'broken', server: null }, // empty name
          { nope: true }, // wrong shape
        ],
      }),
    );
    const { snippets } = await import('../src/store/snippets.store.js');
    expect(snippets.all().map((s) => s.name)).toEqual(['ok']);
  });
});

describe('tagCounts (shared tag inventory)', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  const tunnelInput = (name: string, tags: string[]) => ({
    name,
    description: '',
    tags,
    kind: 'tunnel' as const,
    hostMode: 'manual' as const,
    sshHost: '',
    host: 'h.example.com',
    user: 'root',
    sshPort: 22,
    auth: 'agent' as const,
    keyPath: null,
    secretId: null,
    type: 'local' as const,
    localPort: 8080,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    openBrowser: false,
  });

  it("'tunnels' includes temporary tunnels (profiles span both stores); 'all' mirrors the group/status surface", async () => {
    const { tunnels, tempTunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create(tunnelInput('main-1', ['work']));
    tempTunnels.create(tunnelInput('tmp-1', ['demo']));
    const { tagCounts } = await import('../src/commands/actions.js');
    // profile picker ('tunnels') must offer the temp-only tag — down --tag stops it
    expect(Object.fromEntries(tagCounts('tunnels'))).toEqual({ work: 1, demo: 1 });
    // groups/status don't cover temp tunnels, so 'all' must not offer 'demo'
    expect(Object.fromEntries(tagCounts('all'))).toEqual({ work: 1 });
    expect(tagCounts('servers')).toEqual([]);
  });

  it('sorts by count desc, then name asc, and accepts a pre-scanned pool', async () => {
    const { tagCounts } = await import('../src/commands/actions.js');
    const mk = (tags: string[]) => ({ tags });
    const rows = tagCounts('all', {
      servers: [mk(['b']), mk(['a']), mk(['a'])] as never[],
      tunnels: [],
      tempTunnels: [],
    });
    expect(rows).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('tunnel tag profiles', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('start --tag with no matching tunnels warns and exits 0', async () => {
    const { tunnelUpByTagFlow, tunnelDownByTagFlow } = await import('../src/commands/tunnels.js');
    expect(await tunnelUpByTagFlow('work')).toBe(0);
    expect(tunnelDownByTagFlow('work')).toBe(0);
  });

  it('a blank tag is a usage error (exit 1)', async () => {
    const { tunnelUpByTagFlow, tunnelDownByTagFlow } = await import('../src/commands/tunnels.js');
    expect(await tunnelUpByTagFlow('  ')).toBe(1);
    expect(tunnelDownByTagFlow('')).toBe(1);
  });
});

describe('keystore facade', () => {
  it('label and authenticate stay consistent with the backend kind', async () => {
    const keystore = await import('../src/vault/keystore.js');
    const k = keystore.kind();
    if (k === 'touchid') expect(keystore.label()).toBe('Touch ID');
    else if (k === 'keyring') expect(keystore.label()).toBe('Keyring (Secret Service)');
    else {
      // unsupported box: everything fails closed
      expect(keystore.isSupported()).toBe(false);
      expect(keystore.authenticate()).toBe(false);
      expect(keystore.storeKey('x')).toBe(false);
      expect(keystore.loadKey()).toBeNull();
    }
  });

  it('linux keyring backend is inert off-Linux', async () => {
    const keyring = await import('../src/vault/keyring.js');
    if (process.platform !== 'linux') {
      expect(keyring.isSupported()).toBe(false);
      expect(keyring.storeKey('abc')).toBe(false);
      expect(keyring.loadKey()).toBeNull();
      expect(() => keyring.deleteKey()).not.toThrow();
    }
  });
});
