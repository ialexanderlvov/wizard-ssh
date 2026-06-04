/** Security regression tests for the ssh_config-injection / argv-injection
 *  hardening: a CR/LF in any field must never become an extra config directive,
 *  and a leading-dash destination must never be parsed by ssh as an option. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

const INJECT = 'root\n    ProxyCommand /bin/sh -c "id > /tmp/WSSH_PWNED"';
const readConfig = (): string => {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
  } catch {
    return '';
  }
};

beforeEach(() => {
  vi.resetModules();
  freshHome();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('ssh_config directive injection is blocked at the writer', () => {
  it('upsertHost throws on a CR/LF in a param value', async () => {
    const { upsertHost } = await import('../src/ssh-config/writer.js');
    expect(() =>
      upsertHost({
        alias: 'victim',
        params: [{ key: 'User', value: INJECT }],
        wssh: {},
      }),
    ).toThrow();
    expect(readConfig()).not.toMatch(/ProxyCommand/);
  });

  it('upsertHost throws on a CR/LF in the alias', async () => {
    const { upsertHost } = await import('../src/ssh-config/writer.js');
    expect(() => upsertHost({ alias: 'good\nHost evil', params: [], wssh: {} })).toThrow();
  });

  it('servers.create with a newline-laden user does not pollute ~/.ssh/config', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    expect(() =>
      servers.create({ name: 'box', host: '1.2.3.4', user: INJECT, kind: 'server' }),
    ).toThrow();
    expect(readConfig()).not.toMatch(/ProxyCommand/);
  });
});

describe('non-interactive flags reject injection payloads', () => {
  it('addServerNonInteractive rejects a --user with a newline', async () => {
    const { addServerNonInteractive } = await import('../src/commands/noninteractive.js');
    expect(() => addServerNonInteractive('box', { host: '1.2.3.4', user: INJECT })).toThrow();
  });

  it('addTunnelNonInteractive rejects a --remote-host with a newline', async () => {
    const { addTunnelNonInteractive } = await import('../src/commands/noninteractive.js');
    expect(() =>
      addTunnelNonInteractive({
        host: '1.2.3.4',
        local: '8080',
        remotePort: '80',
        remoteHost: '127.0.0.1\n    ProxyCommand x',
      }),
    ).toThrow();
  });
});

describe('import drops unsafe records instead of writing them', () => {
  it('a malicious server in an import bundle is skipped', async () => {
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
          sshHost: '',
          host: '5.6.7.8',
          user: 'deploy',
          sshPort: 22,
          auth: 'agent',
          keyPath: null,
          secretId: null,
        },
        { kind: 'server', name: 'evil', host: INJECT, user: 'x', hostMode: 'sshconfig' },
      ],
      tunnels: [],
      settings: {},
    };
    const file = path.join(os.homedir(), 'bundle.json');
    fs.writeFileSync(file, JSON.stringify(bundle));
    await importData(file, { replace: false });

    const { servers } = await import('../src/store/servers.store.js');
    const names = servers.all().map((s) => s.name);
    expect(names).toContain('ok-host');
    expect(names).not.toContain('evil');
    expect(readConfig()).not.toMatch(/ProxyCommand/);
  });
});

describe('ssh argv is guarded against option-injection', () => {
  it('buildTunnelArgs puts -- before a leading-dash destination', async () => {
    const { buildTunnelArgs } = await import('../src/ssh/args.js');
    const args = buildTunnelArgs({
      hostMode: 'sshconfig',
      sshHost: '-oProxyCommand=evil',
      type: 'local',
      localPort: 8080,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    } as never);
    expect(args).toContain('--');
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('-oProxyCommand=evil'));
    expect(args[args.length - 1]).toBe('-oProxyCommand=evil');
  });

  it('forwardFlags brackets a colon-bearing remoteHost so it cannot shift fields', async () => {
    const { forwardFlags } = await import('../src/ssh/args.js');
    const spec = forwardFlags({
      type: 'local',
      localPort: 8080,
      remoteHost: '::1',
      remotePort: 443,
    } as never);
    expect(spec).toEqual(['-L', '8080:[::1]:443']);
  });
});
