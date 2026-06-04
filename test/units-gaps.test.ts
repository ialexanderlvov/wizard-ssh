import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, stripAnsi } from './helpers.js';
import { isValidHostOrIp } from '../src/utils/validators.js';
import { authSummary } from '../src/ui/format.js';
import type { ConnectionTarget } from '../src/core/types.js';

const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};
const noTouch = () => ({
  isSupported: () => false,
  authenticate: () => false,
  storeKey: () => false,
  loadKey: () => null,
  deleteKey: () => {},
});

describe('validators: IPv6', () => {
  it('accepts IPv6 literals', () => {
    expect(isValidHostOrIp('fe80::1')).toBe(true);
    expect(isValidHostOrIp('::1')).toBe(true);
    expect(isValidHostOrIp('not a host!')).toBe(false);
  });
  it('rejects structurally invalid IPv6 (multiple :: / dangling colon)', () => {
    expect(isValidHostOrIp('1::2::3')).toBe(false);
    expect(isValidHostOrIp('1:2:')).toBe(false);
  });
});

describe('validators: IPv4 leading zeros', () => {
  it('rejects octal-ambiguous leading-zero octets', () => {
    expect(isValidHostOrIp('010.0.0.1')).toBe(false);
    expect(isValidHostOrIp('1.2.3.04')).toBe(false);
    expect(isValidHostOrIp('10.0.0.1')).toBe(true);
    expect(isValidHostOrIp('0.0.0.0')).toBe(true);
  });
});

describe('ui/format authSummary', () => {
  const base: ConnectionTarget = {
    hostMode: 'manual',
    sshHost: '',
    host: 'h',
    user: 'u',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
  };
  it('renders every auth variant', () => {
    expect(stripAnsi(authSummary({ ...base, auth: 'agent' }))).toContain('agent');
    expect(stripAnsi(authSummary({ ...base, auth: 'key', keyPath: '/k' }))).toContain('key');
    expect(stripAnsi(authSummary({ ...base, auth: 'password', secretId: 's' }))).toContain('saved');
    expect(stripAnsi(authSummary({ ...base, auth: 'password' }))).toContain('password');
    expect(stripAnsi(authSummary({ ...base, hostMode: 'sshconfig', sshHost: 'a' }))).toContain(
      'config',
    );
  });
});

describe('ssh/features resolveEndpoint (ssh -G)', () => {
  it('follows ssh -G for config hosts', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/utils/exec.js', async (orig) => {
      const a = await orig<typeof import('../src/utils/exec.js')>();
      return {
        ...a,
        capture: () => ({ status: 0, stdout: 'hostname 5.5.5.5\nport 2222\n', stderr: '' }),
      };
    });
    const { resolveEndpoint } = await import('../src/ssh/features.js');
    expect(
      resolveEndpoint({
        hostMode: 'sshconfig',
        sshHost: 'x',
        host: '',
        user: '',
        sshPort: 22,
        auth: 'agent',
        keyPath: null,
        secretId: null,
      }),
    ).toEqual({ host: '5.5.5.5', port: 2222 });
  });

  it('falls back to the alias when ssh -G fails', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/utils/exec.js', async (orig) => {
      const a = await orig<typeof import('../src/utils/exec.js')>();
      return { ...a, capture: () => ({ status: 1, stdout: '', stderr: '' }) };
    });
    const { resolveEndpoint } = await import('../src/ssh/features.js');
    expect(
      resolveEndpoint({
        hostMode: 'sshconfig',
        sshHost: 'h',
        host: '',
        user: '',
        sshPort: 22,
        auth: 'agent',
        keyPath: null,
        secretId: null,
      }),
    ).toEqual({ host: 'h', port: 22 });
  });
});

describe('ssh-config parser extras', () => {
  it('handles Match blocks + exposes mainBlocks', async () => {
    vi.resetModules();
    freshHome();
    writeConfig('# c\n\nMatch host *\n    ForwardAgent yes\n\nHost real\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toContain('real');
    expect(cfg.mainBlocks().some((b) => b.aliases.includes('real'))).toBe(true);
  });

  it('ignores Include globs that match nothing', async () => {
    vi.resetModules();
    freshHome();
    writeConfig('Include /no/such/dir/*\nHost x\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toEqual(['x']);
  });
});

describe('migration without legacy settings', () => {
  it('imports tunnels only', async () => {
    vi.resetModules();
    freshHome();
    const dir = path.join(os.homedir(), '.ssh-tunnel-manager');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tunnels.json'),
      JSON.stringify({
        tunnels: [{ name: 't', host: '1.1.1.1', type: 'local', localPort: 1, remotePort: 1 }],
      }),
    );
    const { runMigration } = await import('../src/store/migrate.js');
    expect(runMigration()).toBe(1);
  });
});

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

describe('messages: figlet fallback', () => {
  it('printBanner survives a figlet failure', async () => {
    vi.resetModules();
    vi.doMock('figlet', () => ({
      default: {
        textSync: () => {
          throw new Error('no font');
        },
      },
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { printBanner } = await import('../src/ui/messages.js');
    expect(() => printBanner()).not.toThrow();
  });
});

describe('platform openInBrowser per-OS', () => {
  it('uses cmd on Windows and xdg-open on Linux', async () => {
    for (const [plat, expected] of [
      ['win32', 'cmd'],
      ['linux', 'xdg-open'],
    ] as const) {
      vi.resetModules();
      const spawn = vi.fn(() => ({ unref: () => {} }));
      vi.doMock('node:child_process', async (orig) => {
        const a = await orig<typeof import('node:child_process')>();
        return { ...a, spawn };
      });
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: plat, configurable: true });
      try {
        const { openInBrowser } = await import('../src/utils/platform.js');
        openInBrowser('http://x');
        expect(spawn.mock.calls[0]?.[0]).toBe(expected);
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true });
      }
    }
  });
});

describe('vault corruption handling', () => {
  it('getSecret returns null and rekey throws on a tampered blob', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { vault } = await import('../src/vault/vault.js');
    const { FILES } = await import('../src/core/paths.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const f = JSON.parse(fs.readFileSync(FILES.vault, 'utf8'));
    f.secrets[id].data = Buffer.from('garbage-bytes').toString('base64');
    fs.writeFileSync(FILES.vault, JSON.stringify(f));

    vi.resetModules();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { vault: v2 } = await import('../src/vault/vault.js');
    await v2.unlock({ allowTouchId: false, promptPassphrase: async () => 'm', onError: () => {} });
    expect(v2.getSecret(id)).toBeNull();
    expect(() => v2.rekey('new')).toThrow();
  });

  it('unlock returns false for a malformed vault file', async () => {
    vi.resetModules();
    freshHome();
    vi.doMock('../src/vault/touchid.js', noTouch);
    const { ensureDataDir, FILES } = await import('../src/core/paths.js');
    ensureDataDir();
    fs.writeFileSync(FILES.vault, JSON.stringify({ version: 1 })); // no check / kdf
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'x',
        onError: () => {},
      }),
    ).toBe(false);
  });
});
