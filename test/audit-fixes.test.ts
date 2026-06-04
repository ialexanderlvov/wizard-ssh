/** Regression tests for the security audit fixes:
 *   #1 path traversal via an attacker-controlled tunnel id (normalize + sink)
 *   #2 terminal-escape injection from untrusted ~/.ssh/config / store records
 *   #3 scrypt cost cap that ignored the parallelism factor p (unlock DoS)
 *   #4 a nameless-but-aliased imported server crashing the add-import mid-write
 *   #5 upsertHost appending a shadow block for an Include-only alias
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

// startTunnelDetached spawns a detached ssh; stub it so the test never launches a
// real process (it only needs a child with pid + unref).
const h = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn() })),
}));
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  return { ...actual, spawn: h.spawn };
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

beforeEach(() => {
  vi.resetModules();
  freshHome();
  h.spawn.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#1 tunnel id can never carry path traversal into the log path', () => {
  it('normalizeBase regenerates an id with path/dangerous bytes, keeps a safe one', async () => {
    const { normalizeBase } = await import('../src/store/normalize.js');
    const bad = normalizeBase({ id: '../../../../../../tmp/pwn', name: 't' });
    expect(bad.id).not.toContain('/');
    expect(bad.id).not.toContain('..');
    expect(bad.id).toMatch(/^[A-Za-z0-9_-]+$/);

    // A well-formed id (uuid or legacy alphanumeric) is preserved verbatim.
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeBase({ id: uuid }).id).toBe(uuid);
    expect(normalizeBase({ id: 'legacy_ID-7' }).id).toBe('legacy_ID-7');
    // An empty/absent id still mints a fresh one.
    expect(normalizeBase({}).id).toMatch(/^[A-Za-z0-9-]{36}$/);
  });

  it('a malicious id in tunnels.json is sanitized on load', async () => {
    const { FILES } = await import('../src/core/paths.js');
    fs.mkdirSync(path.dirname(FILES.tunnels), { recursive: true });
    fs.writeFileSync(
      FILES.tunnels,
      JSON.stringify({
        version: 1,
        items: [{ id: '../../../../etc/evil', name: 'x', kind: 'tunnel', type: 'local' }],
      }),
    );
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.all()[0];
    expect(t?.id).not.toMatch(/[/.]/);
  });

  it('startTunnelDetached keeps the log file inside logsDir for a hostile id', async () => {
    const { FILES } = await import('../src/core/paths.js');
    const { startTunnelDetached } = await import('../src/ssh/runner.js');
    const res = startTunnelDetached({
      id: '../../../../../../tmp/pwn',
      name: 't',
      kind: 'tunnel',
      type: 'local',
      hostMode: 'sshconfig',
      sshHost: 'box',
      host: '',
      user: '',
      sshPort: 22,
      auth: 'agent',
      keyPath: null,
      localPort: 8080,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    } as never);
    expect(path.dirname(path.resolve(res.logFile))).toBe(path.resolve(FILES.logsDir));
    expect(fs.existsSync(path.join(path.parse(os.homedir()).root, 'tmp', 'pwn.log'))).toBe(false);
    expect(h.spawn).toHaveBeenCalledOnce();
  });
});

describe('#2 control/escape bytes are stripped from connection fields', () => {
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

describe('#3 scrypt cost cap accounts for the parallelism factor p', () => {
  it('isValidKdf rejects a high-p / high-work KDF and accepts the default', async () => {
    const { defaultKdf, isValidKdf } = await import('../src/vault/crypto.js');
    expect(isValidKdf(defaultKdf())).toBe(true);
    const base = { salt: 'AAAA', N: 131072, r: 8, p: 1, keylen: 32 };
    // The exact boundary the old cap let through (128*N*r == 2^30, p ignored).
    expect(isValidKdf({ ...base, N: 1 << 19, r: 16, p: 16 })).toBe(false);
    expect(isValidKdf({ ...base, p: 16 })).toBe(false); // p out of the new bound
    // Work product N*r*p over the ~8M cap is rejected even with sane memory.
    expect(isValidKdf({ ...base, N: 1 << 18, r: 16, p: 4 })).toBe(false);
    // A modest p within both caps is still accepted.
    expect(isValidKdf({ ...base, p: 4 })).toBe(true);
  });

  it('import skips a bundled vault whose KDF only abuses p', async () => {
    const { FILES } = await import('../src/core/paths.js');
    const { importData } = await import('../src/commands/import-export.js');
    const bundle = {
      app: 'wizard-ssh',
      version: 1,
      exportedAt: '2020-01-01T00:00:00.000Z',
      servers: [],
      tunnels: [],
      settings: {},
      vault: {
        version: 1,
        kdf: { salt: 'AAAA', N: 1 << 19, r: 16, p: 16, keylen: 32 },
        check: { iv: 'a', tag: 'b', data: 'c' },
        secrets: {},
        touchId: false,
      },
    };
    const file = path.join(os.homedir(), 'p-bundle.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    await importData(file, { replace: false });
    expect(fs.existsSync(FILES.vault)).toBe(false);
  });
});

describe('#4 a nameless-but-aliased imported server does not abort the import', () => {
  it('imports both a named server and one that only has sshHost', async () => {
    const { importData } = await import('../src/commands/import-export.js');
    const bundle = {
      app: 'wizard-ssh',
      version: 1,
      exportedAt: '2020-01-01T00:00:00.000Z',
      servers: [
        {
          kind: 'server',
          name: 'ok-host',
          hostMode: 'sshconfig',
          host: '5.6.7.8',
          user: 'deploy',
          sshPort: 22,
          auth: 'agent',
          keyPath: null,
          secretId: null,
        },
        // No `name`, only `sshHost` — passes serverIsSafe (name ?? sshHost) and
        // used to crash the add loop on `nameExists(undefined)`.
        {
          kind: 'server',
          sshHost: 'aliasonly',
          hostMode: 'sshconfig',
          host: '9.9.9.9',
          user: 'x',
          sshPort: 22,
          auth: 'agent',
        },
      ],
      tunnels: [],
      settings: {},
    };
    const file = path.join(os.homedir(), 'nameless-bundle.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    await expect(importData(file, { replace: false })).resolves.toBeUndefined();

    const { servers } = await import('../src/store/servers.store.js');
    const names = servers.all().map((s) => s.name);
    expect(names).toContain('ok-host');
    expect(names).toContain('aliasonly');
  });
});

describe('#5 upsertHost refuses to shadow an Include-only alias', () => {
  it('throws instead of appending a duplicate block, leaving the main config clean', async () => {
    writeSshConfig('Host inconly\n    HostName 7.7.7.7\n', 'sub');
    const mainPath = writeSshConfig('Include sub\n');
    const { upsertHost } = await import('../src/ssh-config/writer.js');
    expect(() =>
      upsertHost({ alias: 'inconly', params: [{ key: 'HostName', value: '8.8.8.8' }], wssh: {} }),
    ).toThrow();
    expect(fs.readFileSync(mainPath, 'utf8')).not.toMatch(/Host inconly/);
  });

  it('replace-import skips the Include-only collision without crashing or duplicating', async () => {
    writeSshConfig('Host inconly\n    HostName 7.7.7.7\n', 'sub');
    const mainPath = writeSshConfig('Include sub\n');
    const { servers } = await import('../src/store/servers.store.js');
    expect(() =>
      servers.replaceAll([
        {
          kind: 'server',
          id: 'inconly',
          name: 'inconly',
          hostMode: 'sshconfig',
          host: '8.8.8.8',
          user: 'x',
          sshPort: 22,
          auth: 'agent',
          keyPath: null,
        } as never,
      ]),
    ).not.toThrow();
    const occurrences = (fs.readFileSync(mainPath, 'utf8').match(/Host inconly/g) ?? []).length;
    expect(occurrences).toBe(0);
  });
});
