import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, PICK_BACK, promptMock } from './helpers.js';

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

const runner = {
  runInteractive: vi.fn(async () => 0),
  runTunnel: vi.fn(async () => 0),
  runSshInherit: vi.fn(async () => 0),
  runProgram: vi.fn(async () => 0),
  // pid = this test process (alive) so the recorded session survives the
  // liveness reap in transferSessions.list().
  startTransferDetached: vi.fn(() => ({ pid: process.pid, logFile: '/tmp/wssh-t.log' })),
};
const feat = {
  healthOpen: false,
  copyId: vi.fn(async () => 0),
  transfer: vi.fn(async () => 0),
  runCommand: vi.fn(async () => 0),
};
const touch = { supported: false };

function setupMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  // Force the reveal flow down its print fallback (and never touch the real
  // system clipboard) by making copyToClipboard report no clipboard tool.
  vi.doMock('../src/utils/platform.js', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/platform.js')>(
      '../src/utils/platform.js',
    );
    return { ...actual, copyToClipboard: () => null };
  });
  vi.doMock('../src/ssh/runner.js', () => ({ ...runner, preflight: () => null }));
  vi.doMock('../src/ssh/features.js', () => ({
    healthCheck: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
    copyId: feat.copyId,
    runCommand: feat.runCommand,
    transfer: feat.transfer,
    transferArgv: () => ({ program: 'scp', args: [] }),
    resolveEndpoint: () => ({ host: 'h', port: 22 }),
    checkTcp: async () => ({ host: 'h', port: 22, open: feat.healthOpen, ms: 1 }),
  }));
  let stored: string | null = null;
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => touch.supported,
    authenticate: () => true,
    storeKey: (k: string) => {
      stored = k;
      return true;
    },
    loadKey: () => stored,
    deleteKey: () => {
      stored = null;
    },
  }));
}

const writeConfig = (c: string): void => {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), c);
};

beforeEach(() => {
  vi.resetModules();
  freshHome();
  resetQ();
  feat.healthOpen = false;
  touch.supported = false;
  [
    runner.runInteractive,
    runner.runTunnel,
    runner.runSshInherit,
    runner.runProgram,
    runner.startTransferDetached,
    feat.copyId,
    feat.transfer,
    feat.runCommand,
  ].forEach((m) => m.mockClear());
  feat.copyId.mockImplementation(async () => 0);
  feat.transfer.mockImplementation(async () => 0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setupMocks();
});

describe('actions branches', () => {
  it('checkFlow resolves a tunnel by name', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tnl', type: 'local', localPort: 8181, remotePort: 81, kind: 'tunnel' });
    const { checkFlow } = await import('../src/commands/actions.js');
    feat.healthOpen = true;
    expect(await checkFlow('tnl')).toBe(0);
  });

  it('copyIdFlow lets you pick a discovered key', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    const key = path.join(ssh, 'id_ed25519');
    fs.writeFileSync(key, '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n');
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = [key];
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(0);
    expect(feat.copyId).toHaveBeenCalledWith(expect.anything(), key, undefined);
  });

  it('copyIdFlow reports a failure', async () => {
    feat.copyId.mockRejectedValueOnce?.(new Error('boom'));
    feat.copyId.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { copyIdFlow } = await import('../src/commands/actions.js');
    expect(await copyIdFlow('box')).toBe(1);
  });

  it('runFlow prompts for a command when none is given', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.text = ['uptime -p'];
    const { runFlow } = await import('../src/commands/actions.js');
    expect(await runFlow('box', [])).toBe(0);
    expect(feat.runCommand).toHaveBeenCalled();
  });

  it('transferFlow reports a failure', async () => {
    feat.transfer.mockImplementationOnce(async () => {
      throw new Error('nope');
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['download'];
    q.text = ['./a', '/b'];
    q.confirm = [false];
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(1);
  });

  it('transferFlow via rsync picks the tool and rsync options', async () => {
    vi.doMock('../src/utils/exec.js', async (o) => {
      const a = await o<typeof import('../src/utils/exec.js')>();
      return { ...a, commandExists: () => true }; // rsync available
    });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    q.choose = ['rsync', 'upload'];
    q.text = ['./a', '/b'];
    q.confirm = [true, false, false]; // compress, delete, dry-run
    const { transferFlow } = await import('../src/commands/actions.js');
    expect(await transferFlow('box')).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', compress: true, archive: true }),
      undefined,
    );
  });

  it('transferFlow runs fully from CLI flags (no prompts)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('box', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      recursive: true,
    });
    expect(code).toBe(0);
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tool: 'scp',
        direction: 'upload',
        localPath: './a',
        remotePath: '/b',
        recursive: true,
      }),
      undefined,
    );
  });

  it('transferFlow errors when scripted and a required field is missing', async () => {
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ nonInteractive: true }); // reset by vi.resetModules in beforeEach
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    await expect(transferFlow('box', { local: './a', remote: '/b' })).rejects.toThrow();
  });

  it('transferFlow applies saved transfer defaults when flags are omitted', async () => {
    const { settings } = await import('../src/store/settings.store.js');
    settings.update({
      transfer: { tool: 'rsync', recursive: false, compress: true, delete: true },
    });
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ nonInteractive: true });
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    await transferFlow('box', { direction: 'upload', local: './a', remote: '/b' }); // no tool/compress/delete
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', compress: true, delete: true }),
      undefined,
    );
  });

  it('transferFlow --bg starts a detached transfer and records a session', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', auth: 'agent', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('box', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      bg: true,
    });
    expect(code).toBe(0);
    expect(runner.startTransferDetached).toHaveBeenCalled();
    expect(feat.transfer).not.toHaveBeenCalled(); // backgrounded, not run in foreground
    const { FILES } = await import('../src/core/paths.js');
    const data = JSON.parse(fs.readFileSync(FILES.transferSessions, 'utf8'));
    expect(data.sessions.some((s: { name: string }) => s.name === 'box')).toBe(true);
  });

  it('transferFlow --bg refuses password auth (no detached process)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'pw', host: '1.2.3.4', auth: 'password', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    const code = await transferFlow('pw', {
      tool: 'scp',
      direction: 'upload',
      local: './a',
      remote: '/b',
      bg: true,
    });
    expect(code).toBe(1);
    expect(runner.startTransferDetached).not.toHaveBeenCalled();
  });

  it('transferFlow under --yes accepts toggle defaults (no forced --delete / --dry-run)', async () => {
    const { setRuntime } = await import('../src/ui/runtime.js');
    setRuntime({ assumeYes: true }); // --yes, but session is still "interactive"
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'box', host: '1.2.3.4', kind: 'server' });
    const { transferFlow } = await import('../src/commands/actions.js');
    // rsync via flag (skips picker); no toggle flags → must fall to defaults, NOT "yes"
    await transferFlow('box', { tool: 'rsync', direction: 'upload', local: './a', remote: '/b' });
    expect(feat.transfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tool: 'rsync', delete: false, dryRun: false }),
      undefined,
    );
  });
});

describe('connect branches', () => {
  it('resolves by name to a tunnel and a config alias', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    tunnels.create({ name: 'tunx', type: 'local', localPort: 1, remotePort: 1, kind: 'tunnel' });
    writeConfig('Host cfgx\n    HostName 9.9.9.9\n');
    const { quickConnectByName } = await import('../src/commands/connect.js');
    expect(await quickConnectByName('tunx')).toBe(0);
    expect(runner.runTunnel).toHaveBeenCalled();
    expect(await quickConnectByName('cfgx')).toBe(0);
  });

  it('fuzzy single match connects; multi match prompts', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'web-alpha', host: '1.1.1.1', kind: 'server' });
    servers.create({ name: 'web-beta', host: '2.2.2.2', kind: 'server' });
    const { quickConnectByName } = await import('../src/commands/connect.js');
    // multiple "web" matches → picker
    q.pick = ['web-alpha'];
    expect(await quickConnectByName('web')).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });

  it('quickConnect dispatches to a tunnel pick', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'qt',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    void t;
    q.pick = ['qt'];
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
    expect(runner.runTunnel).toHaveBeenCalled();
  });

  it('quickConnect dispatches to a config host pick', async () => {
    writeConfig('Host qc\n    HostName 9.9.9.9\n');
    q.pick = ['qc'];
    const { quickConnect } = await import('../src/commands/connect.js');
    expect(await quickConnect()).toBe(0);
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});

describe('helpers branches', () => {
  it('handlePasswordSecret defers clearing a secret to commit when auth leaves password', async () => {
    // build a vault + secret
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const { handlePasswordSecret, commitSecretChange } = await import('../src/commands/helpers.js');
    const out = await handlePasswordSecret(
      {
        hostMode: 'manual',
        sshHost: '',
        host: 'h',
        user: 'u',
        sshPort: 22,
        auth: 'agent',
        keyPath: null,
        secretId: id,
      },
      id,
    );
    expect(out).toBeNull();
    // The old blob is NOT removed yet — doing so before the edit commits would
    // dangle the secretId on cancel. Removal happens only at commit time.
    expect(vault.hasSecret(id)).toBe(true);
    commitSecretChange(id, out);
    expect(vault.hasSecret(id)).toBe(false);
  });

  it('handlePasswordSecret with save=false defers dropping the previous secret to commit', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    q.confirm = [false]; // do not save
    const { handlePasswordSecret, commitSecretChange } = await import('../src/commands/helpers.js');
    const out = await handlePasswordSecret(
      {
        hostMode: 'manual',
        sshHost: '',
        host: 'h',
        user: 'u',
        sshPort: 22,
        auth: 'password',
        keyPath: null,
        secretId: id,
      },
      id,
    );
    expect(out).toBeNull();
    expect(vault.hasSecret(id)).toBe(true); // preserved until commit
    commitSecretChange(id, out);
    expect(vault.hasSecret(id)).toBe(false);
  });

  it('rollbackSecretChange discards a pending blob but keeps the original (cancel safety)', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const original = vault.setSecret('old');
    const pending = vault.setSecret('new');
    const { rollbackSecretChange } = await import('../src/commands/helpers.js');
    rollbackSecretChange(original, pending);
    expect(vault.hasSecret(pending)).toBe(false); // pending blob discarded
    expect(vault.hasSecret(original)).toBe(true); // original left intact
  });

  it('resolvePassword falls back to a prompt when the saved secret is gone', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m'); // vault exists but has no secret with this id
    q.secret = ['typed-pw'];
    const { resolvePassword } = await import('../src/commands/helpers.js');
    const pw = await resolvePassword({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 22,
      auth: 'password',
      keyPath: null,
      secretId: 'ghost',
    });
    expect(pw).toBe('typed-pw');
  });

  it('resolvePassword returns the decrypted secret from an unlocked vault', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('stored-pw');
    const { resolvePassword } = await import('../src/commands/helpers.js');
    const pw = await resolvePassword({
      hostMode: 'manual',
      sshHost: '',
      host: 'h',
      user: 'u',
      sshPort: 22,
      auth: 'password',
      keyPath: null,
      secretId: id,
    });
    expect(pw).toBe('stored-pw');
  });

  it('ensureVaultSetup enables Touch ID when supported', async () => {
    touch.supported = true;
    q.secret = ['master', 'master'];
    q.confirm = [true]; // enable Touch ID?
    const { ensureVaultSetup } = await import('../src/commands/helpers.js');
    expect(await ensureVaultSetup()).toBe(true);
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
    expect(vault.isTouchIdEnabled()).toBe(true);
  });
});

describe('search → connect to tunnel / config host', () => {
  it('connects to a tunnel result', async () => {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'web-tun',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    void t;
    q.pick = ['web-tun'];
    const { searchFlow } = await import('../src/commands/search.js');
    await searchFlow('web');
    expect(runner.runTunnel).toHaveBeenCalled();
  });

  it('connects to a config-host result', async () => {
    writeConfig('Host web-cfg\n    HostName 9.9.9.9\n');
    q.pick = ['web-cfg'];
    const { searchFlow } = await import('../src/commands/search.js');
    await searchFlow('web');
    expect(runner.runInteractive).toHaveBeenCalled();
  });
});

describe('server edit/remove edge cases', () => {
  async function seedAndImport() {
    // New addServer flow: alias first (text), then askServerConnection
    // (host/user/port text + auth choose), then annotations (desc/tags text).
    // No hostMode question, no link step, no password confirm for agent auth.
    q.choose = ['agent']; // auth only
    q.text = ['srv', '1.1.1.1', 'root', '22', '', '']; // alias, host, user, port, desc, tags
    const { addServer, editServer, removeServerFlow, listServers } =
      await import('../src/commands/servers.js');
    const { servers } = await import('../src/store/servers.store.js');
    await addServer();
    return { editServer, removeServerFlow, listServers, servers };
  }

  it('editServer changes name + tags then saves', async () => {
    const { editServer, servers } = await seedAndImport();
    q.choose = ['name', 'tags', '__save__'];
    q.text = ['srv2', 'a, b'];
    await editServer('srv');
    expect(servers.findByName('srv2')?.tags).toEqual(['a', 'b']);
  });

  it('editServer cancel with unsaved edits asks for confirmation', async () => {
    const { editServer, servers } = await seedAndImport();
    q.choose = ['description', '__cancel__'];
    q.text = ['changed'];
    q.confirm = [true]; // yes, discard
    await editServer('srv');
    expect(servers.findByName('srv')?.description).toBe('');
  });

  it('removeServerFlow with empty selection does nothing', async () => {
    const { removeServerFlow, servers } = await seedAndImport();
    q.multi = [[]];
    await removeServerFlow();
    expect(servers.all()).toHaveLength(1);
  });

  it('removeServerFlow by name, declined', async () => {
    const { removeServerFlow, servers } = await seedAndImport();
    q.confirm = [false];
    await removeServerFlow('srv');
    expect(servers.findByName('srv')).toBeTruthy();
  });

  it('listServers json + empty', async () => {
    const { listServers } = await import('../src/commands/servers.js');
    expect(listServers({})).toEqual([]); // empty warn
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 's', host: '1.1.1.1', kind: 'server' });
    expect(listServers({ json: true, sort: 'name' })).toHaveLength(1);
  });
});

describe('tunnel edit/remove edge cases', () => {
  async function seed() {
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'tn',
      type: 'local',
      localPort: 8181,
      remotePort: 81,
      kind: 'tunnel',
    });
    return { tunnels, t };
  }

  it('editTunnel name/description/tags/browser then saves', async () => {
    const { tunnels } = await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['name', 'description', 'tags', 'browser', '__save__'];
    q.text = ['tn2', 'desc', 'x, y'];
    await editTunnel('tn');
    const t = tunnels.findByName('tn2');
    expect(t?.description).toBe('desc');
    expect(t?.tags).toEqual(['x', 'y']);
    expect(t?.openBrowser).toBe(false); // toggled from true
  });

  it('editTunnel save with no changes', async () => {
    await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['__save__'];
    await editTunnel('tn');
  });

  it('editTunnel connection branch', async () => {
    const { tunnels } = await seed();
    const { editTunnel } = await import('../src/commands/tunnels.js');
    q.choose = ['connection', 'manual', 'agent', '__save__'];
    q.text = ['9.9.9.9', 'newu', '22'];
    await editTunnel('tn');
    expect(tunnels.findByName('tn')?.host).toBe('9.9.9.9');
  });

  it('removeTunnelFlow empty selection + declined-by-name', async () => {
    const { tunnels } = await seed();
    const { removeTunnelFlow } = await import('../src/commands/tunnels.js');
    q.multi = [[]];
    await removeTunnelFlow();
    expect(tunnels.all()).toHaveLength(1);
    q.confirm = [false];
    await removeTunnelFlow('tn');
    expect(tunnels.findByName('tn')).toBeTruthy();
  });
});

describe('vault management flow', () => {
  it('unlock / lock / rekey / touch-id enable+disable', async () => {
    touch.supported = true;
    // create vault first
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master');
    vault.lock();

    q.pick = ['unlock', 'enableTouch', 'disableTouch', 'rekey', 'lock', PICK_BACK];
    q.secret = ['master', 'newmaster', 'newmaster'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    expect(vault.isUnlocked()).toBe(false); // ended with lock
  });

  it('with Touch ID on, unlock offers a choice — the passphrase still works', async () => {
    touch.supported = true;
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master', { enableTouchId: true }); // Touch ID enabled on the vault
    vault.lock();
    q.choose = ['passphrase']; // pick passphrase instead of Touch ID
    q.secret = ['master'];
    const { unlockVault } = await import('../src/commands/helpers.js');
    expect(await unlockVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('with Touch ID on, choosing Touch ID unlocks without a passphrase', async () => {
    touch.supported = true;
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master', { enableTouchId: true });
    vault.lock();
    q.choose = ['touchid']; // authenticate() + the stored key unlock it
    const { unlockVault } = await import('../src/commands/helpers.js');
    expect(await unlockVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });
});

describe('redesign: new flows (#6 vault delete/reset, #9 quick tunnel)', () => {
  it('createAndRaiseTunnel: pick a config host, define forward, save and raise', async () => {
    writeConfig('Host qchost\n    HostName 9.9.9.9\n');
    q.pick = ['qchost'];
    q.choose = ['local'];
    // askForward(local): remotePort, remoteHost, localPort + openBrowser confirm;
    // askMeta: name, description, tags
    q.text = ['8080', '127.0.0.1', '8080', 'qctun', '', ''];
    q.confirm = [false];
    const { createAndRaiseTunnel } = await import('../src/commands/tunnels.js');
    expect(await createAndRaiseTunnel()).toBe(0);
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.findByName('qctun');
    expect(t?.type).toBe('local');
    expect(t?.hostMode).toBe('sshconfig');
    expect(runner.runTunnel).toHaveBeenCalled();
  });

  it('createAndRaiseTunnel warns when ~/.ssh/config has no hosts', async () => {
    const { createAndRaiseTunnel } = await import('../src/commands/tunnels.js');
    expect(await createAndRaiseTunnel()).toBe(0);
    expect(runner.runTunnel).not.toHaveBeenCalled();
  });

  it('raiseTemporaryTunnel: saves to the temp list (separate file) and raises it', async () => {
    // askConnectionTarget(manual) + askForward(local) + askMeta(name/desc/tags)
    q.choose = ['manual', 'agent', 'local'];
    q.text = ['9.9.9.9', 'root', '22', '8080', '127.0.0.1', '8080', 'tmp1', '', ''];
    q.confirm = [false]; // openBrowser
    const { raiseTemporaryTunnel } = await import('../src/commands/tunnels.js');
    expect(await raiseTemporaryTunnel()).toBe(0);
    expect(runner.runTunnel).toHaveBeenCalled();
    const { tunnels, tempTunnels } = await import('../src/store/tunnels.store.js');
    expect(tempTunnels.all()).toHaveLength(1); // persisted to the temp list
    expect(tempTunnels.findByName('tmp1')?.host).toBe('9.9.9.9');
    expect(tunnels.all()).toHaveLength(0); // main tunnels list untouched
  });

  it('vaultFlow surfaces «Показать пароль» even with no secrets (reports none)', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m'); // vault exists, 0 secrets
    const logSpy = vi.spyOn(console, 'log');
    q.pick = ['revealSecret', PICK_BACK];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    // the row was selectable (so it appeared) and reported there's nothing saved
    const saidNone = logSpy.mock.calls
      .flat()
      .some((a) => typeof a === 'string' && a.includes('Нет сохранённых паролей'));
    expect(saidNone).toBe(true);
  });

  it('vaultFlow reveals a saved password on confirm (and keeps it)', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('s3cr3t');
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.create({ name: 'revbox', host: '1.1.1.1', kind: 'server' });
    servers.update(s.id, { secretId: id });
    const logSpy = vi.spyOn(console, 'log');
    q.pick = ['revealSecret', 'revbox', PICK_BACK];
    q.confirm = [true]; // yes, show it on screen
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    const printed = logSpy.mock.calls
      .flat()
      .some((a) => typeof a === 'string' && a.includes('s3cr3t'));
    expect(printed).toBe(true);
    expect(vault.getSecret(id)).toBe('s3cr3t'); // reveal does not remove it
  });

  it('vaultFlow deletes a saved password but keeps the server', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const { servers } = await import('../src/store/servers.store.js');
    const s = servers.create({ name: 'mybox', host: '1.1.1.1', kind: 'server' });
    servers.update(s.id, { secretId: id });
    q.pick = ['deleteSecret', 'mybox', PICK_BACK];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    expect(vault.hasSecret(id)).toBe(false);
    expect(servers.findByName('mybox')).toBeTruthy();
    expect(servers.findByName('mybox')?.secretId).toBeNull();
  });

  it('vaultFlow reset wipes the vault; entities keep their data', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('m');
    const id = vault.setSecret('pw');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = tunnels.create({
      name: 'rt',
      type: 'local',
      localPort: 1,
      remotePort: 1,
      kind: 'tunnel',
    });
    tunnels.update(t.id, { secretId: id });
    q.pick = ['reset', PICK_BACK];
    q.confirm = [true]; // confirm the destructive reset
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    expect(vault.exists()).toBe(false);
    expect(tunnels.findByName('rt')).toBeTruthy();
    expect(tunnels.findByName('rt')?.secretId).toBeNull();
  });
});

describe('import/export menu import branch', () => {
  it('imports from a chosen file', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    servers.create({ name: 'x', host: '1.1.1.1', kind: 'server' });
    const { exportData, importExportMenu } = await import('../src/commands/import-export.js');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'b.json');
    exportData(file);
    q.choose = ['import'];
    q.text = [file];
    await expect(importExportMenu()).resolves.toBeUndefined();
  });
});
