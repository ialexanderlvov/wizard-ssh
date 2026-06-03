import { describe, it, expect } from 'vitest';
import { buildConnectArgs, buildTunnelArgs, forwardFlags } from '../src/ssh/args.js';
import {
  CHECK_PLAINTEXT,
  decrypt,
  defaultKdf,
  deriveKey,
  encrypt,
  keyMatchesCheck,
} from '../src/vault/crypto.js';
import { relativeTime, safeIso, ts } from '../src/utils/time.js';
import { isValidHostOrIp, isValidPort, isValidSshAlias } from '../src/utils/validators.js';
import { splitTokens } from '../src/ssh-config/parser.js';
import { checkTcp } from '../src/ssh/features.js';
import { filterEntities } from '../src/search/index.js';
import type { ConnectionTarget, Server, Tunnel } from '../src/core/types.js';

const target = (over: Partial<ConnectionTarget> = {}): ConnectionTarget => ({
  hostMode: 'manual',
  sshHost: '',
  host: '203.0.113.7',
  user: 'deploy',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  ...over,
});

const tunnel = (over: Partial<Tunnel> = {}): Tunnel => ({
  ...target(over),
  kind: 'tunnel',
  id: 't',
  name: 't',
  description: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
  lastUsedAt: null,
  useCount: 0,
  type: 'local',
  localPort: 8181,
  remoteHost: '127.0.0.1',
  remotePort: 81,
  openBrowser: true,
  ...over,
});

describe('ssh args', () => {
  it('connect manual uses port + key + user@host', () => {
    const a = buildConnectArgs(target({ sshPort: 2222, auth: 'key', keyPath: '/k' }));
    expect(a).toContain('-p');
    expect(a).toContain('2222');
    expect(a).toContain('-i');
    expect(a.at(-1)).toBe('deploy@203.0.113.7');
  });

  it('connect via ssh alias is just the alias', () => {
    const a = buildConnectArgs(target({ hostMode: 'sshconfig', sshHost: 'homelab' }));
    expect(a.at(-1)).toBe('homelab');
    expect(a).not.toContain('-p');
  });

  it('local forward maps localPort:remoteHost:remotePort', () => {
    expect(forwardFlags(tunnel())).toEqual(['-L', '8181:127.0.0.1:81']);
  });

  it('reverse forward maps serverPort:localHost:localPort', () => {
    expect(
      forwardFlags(
        tunnel({ type: 'remote', remotePort: 8080, remoteHost: 'localhost', localPort: 3000 }),
      ),
    ).toEqual(['-R', '8080:localhost:3000']);
  });

  it('dynamic forward is -D localPort', () => {
    expect(forwardFlags(tunnel({ type: 'dynamic', localPort: 1080 }))).toEqual(['-D', '1080']);
  });

  it('tunnel args start with -N and ExitOnForwardFailure', () => {
    const a = buildTunnelArgs(tunnel());
    expect(a[0]).toBe('-N');
    expect(a.join(' ')).toContain('ExitOnForwardFailure=yes');
  });

  it('password auth adds password-only options', () => {
    const a = buildConnectArgs(target({ auth: 'password' }));
    expect(a.join(' ')).toContain('PreferredAuthentications=password');
    expect(a.join(' ')).toContain('PubkeyAuthentication=no');
  });
});

describe('vault crypto', () => {
  it('round-trips a secret', () => {
    const kdf = defaultKdf();
    const key = deriveKey('passphrase', kdf);
    const c = encrypt(key, 'super-secret');
    expect(decrypt(key, c)).toBe('super-secret');
  });

  it('rejects a wrong key via the check blob', () => {
    const kdf = defaultKdf();
    const right = deriveKey('right', kdf);
    const wrong = deriveKey('wrong', kdf);
    const check = encrypt(right, CHECK_PLAINTEXT);
    expect(keyMatchesCheck(right, check)).toBe(true);
    expect(keyMatchesCheck(wrong, check)).toBe(false);
  });
});

describe('time helpers', () => {
  it('safeIso keeps valid and falls back on garbage', () => {
    const good = new Date().toISOString();
    expect(safeIso(good, null)).toBe(good);
    expect(safeIso('not-a-date', null)).toBeNull();
  });
  it('ts is total (0 for missing)', () => {
    expect(ts(null)).toBe(0);
    expect(ts('garbage')).toBe(0);
    expect(ts(new Date(0).toISOString())).toBe(0);
  });
  it('relativeTime handles null', () => {
    expect(relativeTime(null)).toBe('никогда');
  });
});

describe('validators', () => {
  it('ports', () => {
    expect(isValidPort('22')).toBe(true);
    expect(isValidPort('70000')).toBe(false);
    expect(isValidPort('0')).toBe(false);
  });
  it('hosts', () => {
    expect(isValidHostOrIp('203.0.113.7')).toBe(true);
    expect(isValidHostOrIp('example.com')).toBe(true);
    expect(isValidHostOrIp('999.1.1.1')).toBe(false);
  });
  it('aliases reject globs', () => {
    expect(isValidSshAlias('homelab-proxy')).toBe(true);
    expect(isValidSshAlias('*.internal')).toBe(false);
  });
});

describe('ssh-config tokens', () => {
  it('respects quoted paths with spaces', () => {
    expect(splitTokens('"~/My Confs/a" b c')).toEqual(['~/My Confs/a', 'b', 'c']);
  });
});

describe('checkTcp', () => {
  // Regression: an out-of-range port must not throw synchronously and hang the
  // Promise — it should resolve quickly as unreachable.
  it('resolves invalid ports as unreachable without hanging', async () => {
    for (const port of [70000, 0, -1]) {
      const r = await checkTcp('127.0.0.1', port, 500);
      expect(r.open).toBe(false);
    }
  });
});

describe('fuzzy filter', () => {
  const mk = (name: string, host: string, tags: string[] = []): Server => ({
    kind: 'server',
    id: name,
    name,
    description: '',
    tags,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'manual',
    sshHost: '',
    host,
    user: 'root',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: null,
  });
  it('finds by name/tag, empty term returns all', () => {
    const items = [mk('web-prod', '10.0.0.1', ['prod']), mk('db-stage', '10.0.0.2', ['stage'])];
    expect(filterEntities(items, '').length).toBe(2);
    expect(filterEntities(items, 'prod').map((e) => e.name)).toContain('web-prod');
    expect(filterEntities(items, 'db').map((e) => e.name)).toContain('db-stage');
  });
});
