import { describe, it, expect, beforeEach, vi } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, stripAnsi } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('utils/net — port probes', () => {
  it('detects a bound port as busy and finds a free one above it', async () => {
    const { isPortFree, findFreePort } = await import('../src/utils/net.js');
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as net.AddressInfo).port;

    expect(await isPortFree(port)).toBe(false);
    const free = await findFreePort(port + 1, 200);
    expect(free).not.toBeNull();
    expect(free).toBeGreaterThan(port);
    expect(await isPortFree(free as number)).toBe(true);

    await new Promise<void>((r) => srv.close(() => r()));
  });

  it('rejects invalid ports', async () => {
    const { isPortFree } = await import('../src/utils/net.js');
    expect(await isPortFree(0)).toBe(false);
    expect(await isPortFree(70_000)).toBe(false);
    expect(await isPortFree(-1)).toBe(false);
  });
});

describe('tunnel clone', () => {
  const baseTunnel = {
    kind: 'tunnel' as const,
    type: 'local' as const,
    localPort: 0,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    host: '10.0.0.5',
    user: 'root',
    sshPort: 22,
    auth: 'agent' as const,
    keyPath: null,
    secretId: 'secret-1',
    hostMode: 'manual' as const,
    sshHost: '',
    openBrowser: true,
    description: 'web',
    tags: ['prod'],
  };

  it('clones under an explicit name, copying fields and dropping the vault secret', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'web', localPort: 18080 });

    await cloneTunnelFlow('web', 'web-staging');
    const clone = tunnels.findByName('web-staging');

    expect(clone).toBeTruthy();
    expect(clone?.type).toBe('local');
    expect(clone?.remotePort).toBe(80);
    expect(clone?.host).toBe('10.0.0.5');
    expect(clone?.tags).toEqual(['prod']);
    expect(clone?.secretId).toBeNull(); // never shares a vault blob
  });

  it('auto-names the copy when no name is given', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const { cloneTunnelFlow } = await import('../src/commands/tunnels.js');
    tunnels.create({ ...baseTunnel, name: 'db', localPort: 15432 });

    await cloneTunnelFlow('db');
    expect(tunnels.findByName('db-copy')).toBeTruthy();
  });
});

describe('server duplicate', () => {
  it('duplicates a server under a new alias', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { duplicateServerFlow } = await import('../src/commands/servers.js');
    servers.create({
      name: 'prod',
      host: '10.0.0.1',
      user: 'deploy',
      sshPort: 2222,
      auth: 'agent',
      keyPath: null,
      secretId: null,
      proxyJump: 'bastion',
      kind: 'server',
      description: 'prod box',
      tags: ['eu'],
    });

    await duplicateServerFlow('prod', 'staging');
    const dup = servers.findByName('staging');

    expect(dup).toBeTruthy();
    expect(dup?.host).toBe('10.0.0.1');
    expect(dup?.user).toBe('deploy');
    expect(dup?.sshPort).toBe(2222);
    expect(dup?.tags).toEqual(['eu']);
    expect(dup?.proxyJump).toBe('bastion'); // bastion route is carried over (#7)
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

describe('tunnel logs', () => {
  it('tailLines returns the last N lines (trailing newline ignored)', async () => {
    const { tailLines } = await import('../src/commands/tunnels.js');
    expect(tailLines('a\nb\nc\n', 2)).toEqual(['b', 'c']);
    expect(tailLines('a\nb\nc', 2)).toEqual(['b', 'c']);
    expect(tailLines('', 5)).toEqual([]);
    expect(tailLines('x\ny\nz', 0)).toEqual(['x', 'y', 'z']);
  });

  it('tails a live session log and reports not-found / no-sessions', async () => {
    const { sessions } = await import('../src/store/sessions.store.js');
    const { tunnelLogsFlow } = await import('../src/commands/tunnels.js');

    // no sessions → 0 (warn)
    expect(await tunnelLogsFlow()).toBe(0);

    const logFile = path.join(os.tmpdir(), `wssh-test-log-${process.pid}.log`);
    fs.writeFileSync(logFile, 'line1\nline2\nline3\n');
    sessions.add({
      tunnelId: 't1',
      name: 'mytun',
      pid: process.pid, // alive → not reaped
      store: 'main',
      forward: '8080→127.0.0.1:80',
      target: 'root@h',
      logFile,
    });

    const out: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    });
    const code = await tunnelLogsFlow('mytun', { tail: 2 });
    spy.mockRestore();

    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('line2');
    expect(text).toContain('line3');
    expect(text).not.toContain('line1'); // tail 2 dropped the first line

    expect(await tunnelLogsFlow('does-not-exist')).toBe(1);
    fs.unlinkSync(logFile);
  });
});

describe('ssh key audit', () => {
  it('keyIssues classifies weakness/hygiene flags', async () => {
    const { keyIssues } = await import('../src/ssh/keys.js');
    expect(keyIssues({ type: 'RSA', bits: 1024, hasPub: true }, true, false)).toEqual(['weak-rsa']);
    expect(keyIssues({ type: 'RSA', bits: 4096, hasPub: true }, false, false)).toEqual([
      'unencrypted',
    ]);
    expect(keyIssues({ type: 'ED25519', bits: 256, hasPub: false }, true, true)).toEqual([
      'no-pub',
      'orphan',
    ]);
    // strong, encrypted, has pub, referenced → clean; unknown encryption ignored
    expect(keyIssues({ type: 'ED25519', bits: 256, hasPub: true }, null, false)).toEqual([]);
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
});

describe('ProxyJump visualization', () => {
  it('renders a bastion chain in a server detail box', async () => {
    const { detailBox } = await import('../src/ui/format.js');
    const server = {
      kind: 'server' as const,
      id: 'p',
      name: 'p',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      lastUsedAt: null,
      useCount: 0,
      hostMode: 'sshconfig' as const,
      sshHost: 'p',
      host: '10.0.0.9',
      user: 'root',
      sshPort: 22,
      auth: 'agent' as const,
      keyPath: null,
      secretId: null,
      manageable: true,
      proxyJump: 'bastion1,bastion2',
    };
    const out = stripAnsi(detailBox(server));
    expect(out).toContain('bastion1');
    expect(out).toContain('bastion2');
    expect(out).toContain('10.0.0.9');
    expect(out).toContain('→');
  });
});
