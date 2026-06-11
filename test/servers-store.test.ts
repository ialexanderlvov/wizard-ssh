import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from '../src/core/types.js';
import { freshHome } from './helpers.js';

const cfgPath = (): string => path.join(os.homedir(), '.ssh', 'config');
const readCfg = (): string => {
  try {
    return fs.readFileSync(cfgPath(), 'utf8');
  } catch {
    return '';
  }
};
const writeCfg = (c: string): void => {
  fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true });
  fs.writeFileSync(cfgPath(), c);
};

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('config-backed servers facade', () => {
  it('create writes a Host block + #wssh and reads back', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.create({
      name: 'web',
      host: '1.2.3.4',
      user: 'root',
      sshPort: 2222,
      auth: 'agent',
      description: 'prod',
      tags: ['p'],
      kind: 'server',
    });
    expect(s.hostMode).toBe('sshconfig');
    expect(s.id).toBe('web');
    expect(s.name).toBe('web');
    expect(s.host).toBe('1.2.3.4');
    expect(s.sshPort).toBe(2222);
    expect(s.manageable).toBe(true);

    const text = readCfg();
    expect(text).toContain('Host web');
    expect(text).toContain('HostName 1.2.3.4');
    expect(text).toContain('Port 2222');
    expect(text).toContain('#wssh ');

    expect(servers.findByName('WEB')?.description).toBe('prod'); // case-insensitive
    expect(servers.findById('web')?.tags).toEqual(['p']);
  });

  it('password → #wssh auth+secret; key → IdentityFile (auth inferred as key)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({
      name: 'pw',
      host: '1.1.1.1',
      auth: 'password',
      secretId: 'sec1',
      kind: 'server',
    });
    const a = servers.findById('pw');
    expect(a?.auth).toBe('password');
    expect(a?.secretId).toBe('sec1');

    servers.create({
      name: 'kb',
      host: '2.2.2.2',
      auth: 'key',
      keyPath: '/home/me/.ssh/id_ed25519',
      kind: 'server',
    });
    const b = servers.findById('kb');
    expect(b?.keyPath).toBe('/home/me/.ssh/id_ed25519');
    expect(b?.auth).toBe('key'); // inferred from the IdentityFile directive
    expect(readCfg()).toContain('IdentityFile /home/me/.ssh/id_ed25519');
  });

  it('preserves IdentityFile (key auth) and extra directives across a metadata edit', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    writeCfg('Host kb\n  HostName 1.1.1.1\n  IdentityFile ~/.ssh/id_kb\n  ProxyJump bastion\n');
    expect(servers.findById('kb')?.auth).toBe('key'); // inferred from IdentityFile
    expect(servers.findById('kb')?.keyPath).toBe('~/.ssh/id_kb');
    servers.update('kb', { description: 'note' });
    const text = readCfg();
    expect(text).toContain('IdentityFile ~/.ssh/id_kb'); // NOT dropped
    expect(text).toContain('ProxyJump bastion'); // non-standard directive kept
    expect(servers.findById('kb')?.keyPath).toBe('~/.ssh/id_kb');
    expect(servers.findById('kb')?.description).toBe('note');
  });

  it('update rewrites connection + metadata; rename moves the alias and its stats', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { usage } = await import('../src/store/usage.store.js');
    servers.create({ name: 'box', host: '1.1.1.1', user: 'root', kind: 'server' });
    servers.touch('box');
    servers.touch('box');
    expect(servers.findById('box')?.useCount).toBe(2);

    servers.update('box', { host: '9.9.9.9', description: 'edited' });
    expect(servers.findById('box')?.host).toBe('9.9.9.9');
    expect(servers.findById('box')?.description).toBe('edited');

    servers.update('box', { name: 'box2' });
    expect(servers.findById('box')).toBeNull();
    expect(servers.findById('box2')?.host).toBe('9.9.9.9');
    expect(servers.findById('box2')?.useCount).toBe(2); // usage carried over
    expect(usage.get('box').useCount).toBe(0);
  });

  it('remove deletes the block + usage; a multi-alias host is not manageable/removable', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    writeCfg('Host a b\n  HostName 8.8.8.8\nHost solo\n  HostName 1.1.1.1\n');
    expect(servers.findById('a')?.manageable).toBe(false);
    expect(servers.remove('a')).toBe(false); // multi-alias → not managed
    expect(servers.remove('solo')).toBe(true);
    expect(servers.findById('solo')).toBeNull();
    expect(readCfg()).toContain('Host a b');
  });

  it('sorted("uses") uses usage.json; all() lists every config host', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'aaa', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'bbb', host: '2.2.2.2', kind: 'server' });
    servers.touch('bbb');
    expect(servers.sorted('uses')[0]?.name).toBe('bbb');
    expect(
      servers
        .all()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['aaa', 'bbb']);
    expect(servers.nameExists('aaa')).toBe(true);
    expect(servers.nameExists('aaa', 'aaa')).toBe(false); // excluding itself
  });

  it('replaceAll upserts imported servers without wiping others', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'keep', host: '1.1.1.1', kind: 'server' });
    const imported: Server = {
      kind: 'server',
      id: 'imp',
      name: 'imp',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      lastUsedAt: null,
      useCount: 5,
      hostMode: 'sshconfig',
      sshHost: '',
      host: '3.3.3.3',
      user: 'u',
      sshPort: 22,
      auth: 'agent',
      keyPath: null,
      secretId: null,
      manageable: true,
    };
    servers.replaceAll([imported]);
    expect(servers.findById('keep')).toBeTruthy(); // not wiped
    expect(servers.findById('imp')?.host).toBe('3.3.3.3');
    expect(servers.findById('imp')?.useCount).toBe(5);
  });
});
