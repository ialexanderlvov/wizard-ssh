import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

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

function resetQ(): void {
  q.text = [];
  q.choose = [];
  q.confirm = [];
  q.secret = [];
  q.multi = [];
  q.search = [];
  q.pick = [];
}

function mockPrompts(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
}

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  // keep flow output quiet
  vi.spyOn(console, 'log').mockImplementation(() => {});
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

describe('server flows', () => {
  it('addServer (manual, agent, no link) persists', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['1.2.3.4', 'root', '22', 'mybox', '', 'prod'];
    q.confirm = [false]; // offerLink → no
    mockPrompts();
    const { addServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    const created = await addServer();
    expect(created?.name).toBe('mybox');
    expect(servers.findByName('mybox')?.host).toBe('1.2.3.4');
    expect(servers.findByName('mybox')?.tags).toEqual(['prod']);
  });

  it('addServer with link writes to ~/.ssh/config', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['5.5.5.5', 'ada', '22', 'linked', '', '', 'linked-alias'];
    q.confirm = [true]; // offerLink → yes
    mockPrompts();
    const { addServer } = await import('../src/commands/servers.js');
    await addServer();
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('linked-alias')?.hostName).toBe('5.5.5.5');
  });

  it('editServer changes description and saves', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['1.1.1.1', 'root', '22', 'edit-me', '', ''];
    q.confirm = [false];
    mockPrompts();
    const { addServer, editServer } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();

    // edit: pick "description", type new value, then "save"
    q.choose = ['description', '__save__'];
    q.text = ['updated desc'];
    await editServer('edit-me');
    expect(servers.findByName('edit-me')?.description).toBe('updated desc');
  });

  it('removeServerFlow with name + confirm', async () => {
    q.choose = ['manual', 'agent'];
    q.text = ['1.1.1.1', 'root', '22', 'doomed', '', ''];
    q.confirm = [false];
    mockPrompts();
    const { addServer, removeServerFlow } = await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    q.confirm = [true]; // confirm delete
    await removeServerFlow('doomed');
    expect(servers.findByName('doomed')).toBeNull();
  });
});

describe('tunnel + config + settings + menu flows', () => {
  it('addTunnel (local) persists', async () => {
    q.choose = ['manual', 'agent', 'local'];
    q.text = ['1.2.3.4', 'root', '22', '81', '127.0.0.1', '8181', 'npm', '', ''];
    q.confirm = [true]; // openBrowser
    mockPrompts();
    const { addTunnel } = await import('../src/commands/tunnels.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = await addTunnel();
    expect(t?.name).toBe('npm');
    expect(tunnels.findByName('npm')?.localPort).toBe(8181);
  });

  it('addConfigHost writes a block', async () => {
    q.text = ['newcfg', '1.2.3.4', 'ada', '2222', '', ''];
    mockPrompts();
    const { addConfigHost } = await import('../src/commands/config.js');
    const cfg = await import('../src/ssh-config/index.js');
    await addConfigHost();
    expect(cfg.getHost('newcfg')?.hostName).toBe('1.2.3.4');
    expect(cfg.getHost('newcfg')?.port).toBe('2222');
  });

  it('settingsFlow updates defaults', async () => {
    // settingsFlow is now a loop menu: pick a row → edit that one setting → loop;
    // BACK exits. Text/choose/confirm queues line up with the pick order below.
    q.pick = [
      'defaultUser',
      'defaultSshPort',
      'defaultRemoteHost',
      'defaultAuth',
      'defaultSort',
      'openBrowser',
      PICK_BACK,
    ];
    q.text = ['admin', '2200', '127.0.0.5'];
    q.choose = ['key', 'name']; // defaultAuth, defaultSort
    q.confirm = [false]; // openBrowser
    mockPrompts();
    const { settingsFlow } = await import('../src/commands/settings.js');
    const { settings } = await import('../src/store/settings.store.js');
    await settingsFlow();
    expect(settings.get().defaultUser).toBe('admin');
    expect(settings.get().defaultSshPort).toBe(2200);
    expect(settings.get().defaultRemoteHost).toBe('127.0.0.5');
    expect(settings.get().defaultAuth).toBe('key');
    expect(settings.get().defaultSort).toBe('name');
    expect(settings.get().openBrowser).toBe(false);
  });

  it('mainMenu exits cleanly', async () => {
    q.pick = ['exit'];
    mockPrompts();
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
  });
});
