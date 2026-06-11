// Tests for src/ssh/args — argv builders, destinations, mosh args and shell-quoting.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';
import {
  assertSafeDestination,
  buildConnectArgs,
  buildRunArgs,
  buildTunnelArgs,
  destination,
  forwardFlags,
  targetOptions,
} from '../src/ssh/args.js';
import { transferArgv } from '../src/ssh/features.js';
import { formatBlock } from '../src/ssh-config/writer.js';
import { splitTokens } from '../src/ssh-config/parser.js';
import type { ConnectionTarget, Server, Tunnel } from '../src/core/types.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

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

const manual = (o: Partial<ConnectionTarget> = {}): ConnectionTarget => ({
  hostMode: 'manual',
  sshHost: '',
  host: '203.0.113.7',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  ...o,
});

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

describe('args extras', () => {
  it('destination shapes', () => {
    expect(destination(manual({ user: 'deploy', host: 'h' }))).toBe('deploy@h');
    expect(destination(manual({ hostMode: 'sshconfig', sshHost: 'alias' }))).toBe('alias');
  });

  it('targetOptions omits -p for ssh-config hosts but keeps robustness opts', () => {
    const a = targetOptions(manual({ hostMode: 'sshconfig', sshHost: 'x' }));
    expect(a).not.toContain('-p');
    expect(a.join(' ')).toContain('ConnectTimeout=15');
  });

  it('targetOptions adds -p only for non-default ports', () => {
    expect(targetOptions(manual({ sshPort: 22 }))).not.toContain('-p');
    expect(targetOptions(manual({ sshPort: 2222 }))).toContain('2222');
  });

  it('buildRunArgs puts -- before the destination, then the command', () => {
    const a = buildRunArgs(manual({ user: 'deploy', host: 'h' }), ['uptime', '-p']);
    expect(a.slice(-4)).toEqual(['--', 'deploy@h', 'uptime', '-p']);
  });

  it('a leading-dash destination is guarded by -- (no ssh option injection)', () => {
    const a = buildRunArgs(manual({ hostMode: 'sshconfig', sshHost: '-oProxyCommand=evil' }), [
      'id',
    ]);
    expect(a).toContain('--');
    expect(a.indexOf('--')).toBeLessThan(a.indexOf('-oProxyCommand=evil'));
  });

  it('forwardFlags remote defaults localhost', () => {
    const t = { type: 'remote', remotePort: 9000, remoteHost: '', localPort: 3000 } as Tunnel;
    expect(forwardFlags(t)).toEqual(['-R', '9000:localhost:3000']);
  });

  it('key auth pins the identity with IdentitiesOnly=yes right after -i', () => {
    const a = targetOptions(manual({ auth: 'key', keyPath: '/home/me/.ssh/id_ed25519' }));
    const i = a.indexOf('-i');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(a[i + 1]).toBe('/home/me/.ssh/id_ed25519');
    expect(a[i + 2]).toBe('-o');
    expect(a[i + 3]).toBe('IdentitiesOnly=yes');
  });

  it('agent and password auth never add IdentitiesOnly', () => {
    expect(targetOptions(manual({ auth: 'agent' })).join(' ')).not.toContain('IdentitiesOnly');
    expect(targetOptions(manual({ auth: 'password' })).join(' ')).not.toContain('IdentitiesOnly');
  });
});

describe('shell-quoting of transport strings (injection fix #1-3)', () => {
  it('shQuote/shJoin neutralize metacharacters and spaces', async () => {
    const { shQuote, shJoin } = await import('../src/utils/shell.js');
    expect(shQuote('plain')).toBe("'plain'");
    expect(shQuote('/k;touch /tmp/x')).toBe("'/k;touch /tmp/x'");
    expect(shQuote("a'b")).toBe("'a'\\''b'"); // embedded single quote escaped
    expect(shJoin(['ssh', '-i', '/My Keys/id_rsa'])).toBe("'ssh' '-i' '/My Keys/id_rsa'");
  });

  it('buildMoshArgs single-quotes a malicious/space key path so it cannot break out', async () => {
    const { buildMoshArgs } = await import('../src/ssh/args.js');
    const evil = buildMoshArgs({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 22,
      auth: 'key',
      keyPath: '/k;touch /tmp/pwned',
      secretId: null,
    });
    // the whole dangerous path is one single-quoted token → no shell break-out,
    // no word-splitting, no ssh-option injection.
    expect(evil[1]).toContain("'/k;touch /tmp/pwned'");

    const spaced = buildMoshArgs({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 2222,
      auth: 'key',
      keyPath: '/home/u/My Keys/id_rsa',
      secretId: null,
    });
    expect(spaced[1]).toContain("'/home/u/My Keys/id_rsa'");
    expect(spaced[1]).toContain("'-p' '2222'");
  });
});

describe('mosh args', () => {
  it('builds the mosh argv from a manual host and a config alias', async () => {
    const { buildMoshArgs } = await import('../src/ssh/args.js');

    const manual = buildMoshArgs({
      hostMode: 'manual',
      sshHost: '',
      host: '1.2.3.4',
      user: 'deploy',
      sshPort: 2222,
      auth: 'key',
      keyPath: '/tmp/id_key',
      secretId: null,
    });
    expect(manual[0]).toBe('--ssh');
    expect(manual[1]).toContain("'-p' '2222'"); // tokens are shell-quoted (#1-3)
    expect(manual[1]).toContain("'-i' '/tmp/id_key'");
    expect(manual[manual.length - 1]).toBe('deploy@1.2.3.4'); // destination is a separate argv

    const alias = buildMoshArgs({
      hostMode: 'sshconfig',
      sshHost: 'prod',
      host: '',
      user: '',
      sshPort: 22,
      auth: 'agent',
      keyPath: null,
      secretId: null,
    });
    expect(alias[alias.length - 1]).toBe('prod');
  });

  it('refuses a leading-dash destination (no mosh option injection)', async () => {
    const { buildMoshArgs } = await import('../src/ssh/args.js');
    expect(() =>
      buildMoshArgs({
        hostMode: 'sshconfig',
        sshHost: '-oProxyCommand=evil',
        host: '',
        user: '',
        sshPort: 22,
        auth: 'agent',
        keyPath: null,
        secretId: null,
      }),
    ).toThrow();
  });
});

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
