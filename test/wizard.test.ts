/** commands/wizard prompt blocks, defaults and pickers. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';
import type { Tunnel } from '../src/core/types.js';

// Scripted answers consumed (FIFO) by the mocked prompt wrappers.
const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
  pick: [] as unknown[],
};
const resetQ = (): void => (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));

function setupMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}

function mockPrompts(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
}

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('wizard prompt blocks', () => {
  it('askConnectionTarget — manual + agent', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['1.2.3.4', 'deploy', '2222'];
    mockPrompts();
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t).toMatchObject({
      hostMode: 'manual',
      host: '1.2.3.4',
      user: 'deploy',
      sshPort: 2222,
      auth: 'agent',
    });
  });

  it('askConnectionTarget — manual + key (pickKey finds a key)', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    const keyPath = path.join(sshDir, 'id_test');
    fs.writeFileSync(keyPath, '-----BEGIN OPENSSH PRIVATE KEY-----\nzzzz\n');
    q.choose = ['manual', 'key', keyPath];
    q.text = ['10.0.0.1', 'root', '22'];
    mockPrompts();
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t.auth).toBe('key');
    expect(t.keyPath).toBe(keyPath);
  });

  it('askConnectionTarget — ssh-config alias', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'config'), 'Host homelab\n    HostName 9.9.9.9\n');
    q.choose = ['sshconfig'];
    q.search = ['homelab'];
    mockPrompts();
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t).toMatchObject({ hostMode: 'sshconfig', sshHost: 'homelab', auth: 'agent' });
  });

  it('askForward — local, remote, dynamic', async () => {
    mockPrompts();
    const { askForward } = await import('../src/commands/wizard.js');

    q.choose = ['local'];
    q.text = ['81', '127.0.0.1', '8181'];
    q.confirm = [true];
    expect(await askForward({})).toMatchObject({
      type: 'local',
      remotePort: 81,
      localPort: 8181,
      openBrowser: true,
    });

    q.choose = ['remote'];
    q.text = ['9000', 'localhost', '3000'];
    expect(await askForward({})).toMatchObject({
      type: 'remote',
      remotePort: 9000,
      localPort: 3000,
    });

    q.choose = ['dynamic'];
    q.text = ['1080'];
    expect(await askForward({})).toMatchObject({
      type: 'dynamic',
      localPort: 1080,
      remotePort: null,
    });
  });

  it('askMeta parses tags and trims name', async () => {
    q.text = ['  My Box ', 'a description', 'prod, db'];
    mockPrompts();
    const { askMeta } = await import('../src/commands/wizard.js');
    const m = await askMeta({}, () => false, 'suggested');
    expect(m).toEqual({ name: 'My Box', description: 'a description', tags: ['prod', 'db'] });
  });
});

describe('wizard: defaults (left side of ?? / ||)', () => {
  it('askConnectionTarget with manual defaults', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['9.9.9.9', 'deploy', '2222'];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({
      hostMode: 'manual',
      host: '1.1.1.1',
      user: 'olduser',
      sshPort: 22,
      auth: 'agent',
      keyPath: '/k',
      secretId: 'sec',
      sshHost: '',
    });
    expect(t.secretId).toBe('sec'); // preserved
  });

  it('askForward local/remote/dynamic with defaults supplied', async () => {
    const { askForward } = await import('../src/commands/wizard.js');
    const def: Partial<Tunnel> = {
      type: 'local',
      remotePort: 81,
      remoteHost: '10.0.0.1',
      localPort: 8080,
      openBrowser: false,
    };

    q.choose = ['local'];
    q.text = ['81', '10.0.0.1', '8080'];
    q.confirm = [false];
    expect((await askForward(def)).remoteHost).toBe('10.0.0.1');

    q.choose = ['remote'];
    q.text = ['9000', 'srv', '3000'];
    expect((await askForward({ ...def, type: 'remote', remotePort: 9000 })).type).toBe('remote');

    q.choose = ['dynamic'];
    q.text = ['1080'];
    expect((await askForward({ ...def, type: 'dynamic', localPort: 1080 })).type).toBe('dynamic');
  });

  it('askForward fills empty remoteHost defaults', async () => {
    const { askForward } = await import('../src/commands/wizard.js');
    q.choose = ['local'];
    q.text = ['81', '', '']; // empty remoteHost/localPort → fallbacks
    q.confirm = [true];
    const fwd = await askForward({});
    expect(fwd.remoteHost).toBe('127.0.0.1');
  });

  it('askMeta with provided defaults', async () => {
    q.text = ['kept-name', 'kept-desc', 'a,b'];
    const { askMeta } = await import('../src/commands/wizard.js');
    const m = await askMeta({ name: 'old', description: 'd', tags: ['x'] }, () => false);
    expect(m.name).toBe('kept-name');
  });
});

describe('wizard pickers', () => {
  it('pickSshAlias falls back to manual input when no config', async () => {
    q.choose = ['sshconfig'];
    q.text = ['myalias'];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t.sshHost).toBe('myalias');
  });

  it('pickKey supports manual path entry', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    const key = path.join(ssh, 'mykey');
    fs.writeFileSync(key, '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    fs.rmSync(key); // ensure not auto-discovered, force the manual branch
    fs.writeFileSync(key, 'private'); // exists for the validate()
    q.choose = ['manual', 'key', '__manual__'];
    q.text = ['1.2.3.4', 'root', '22', key];
    const { askConnectionTarget } = await import('../src/commands/wizard.js');
    const t = await askConnectionTarget({});
    expect(t.keyPath).toBe(key);
  });
});
