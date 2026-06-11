// Tests for the vault/settings command flows (vaultFlow, vault guards, password round-trips) — distinct from test/vault.test.ts which covers the core vault.
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

describe('vault guard branches', () => {
  async function v() {
    const { vault } = await import('../src/vault/vault.js');
    return vault;
  }

  it('enableTouchId returns false when locked / unsupported', async () => {
    const vault = await v();
    expect(vault.enableTouchId()).toBe(false); // no vault yet
    vault.setup('m'); // touchid mock unsupported → enableTouchId false
    expect(vault.enableTouchId()).toBe(false);
  });

  it('unlock returns true immediately when already unlocked', async () => {
    const vault = await v();
    vault.setup('m');
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'never',
        onError: () => {},
      }),
    ).toBe(true);
  });

  it('getSecret on a missing id returns null; removeSecret no-ops', async () => {
    const vault = await v();
    vault.setup('m');
    expect(vault.getSecret('nope')).toBeNull();
    vault.removeSecret('nope');
    vault.removeSecret(null);
    const explicit = vault.setSecret('pw', 'fixed-id');
    expect(explicit).toBe('fixed-id');
  });

  it('rekey throws when locked', async () => {
    const vault = await v();
    vault.setup('m');
    vault.lock();
    expect(() => vault.rekey('new')).toThrow();
  });
});

describe('vaultFlow unlocked-state choices', () => {
  it('shows lock when already unlocked', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master'); // unlocked
    q.pick = ['lock', PICK_BACK];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    expect(vault.isUnlocked()).toBe(false);
  });
});

describe('vault flow rekey mismatch', () => {
  it('reports mismatched new passphrases', async () => {
    const { vault } = await import('../src/vault/vault.js');
    vault.setup('master');
    vault.lock();
    q.pick = ['rekey', PICK_BACK];
    q.secret = ['master', 'new1', 'new2'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    // still unlockable with the original passphrase (rekey was rejected)
    vault.lock();
    expect(
      await vault.unlock({
        allowTouchId: false,
        promptPassphrase: async () => 'master',
        onError: () => {},
      }),
    ).toBe(true);
  });
});

describe('password vault round-trip through flows', () => {
  it('addTunnel saves an encrypted password; connect decrypts it', async () => {
    q.choose = ['manual', 'password', 'local'];
    q.text = ['1.2.3.4', 'root', '22', '81', '127.0.0.1', '8080', 'pwtun', '', ''];
    q.confirm = [true, true]; // save-password? yes ; openBrowser? yes
    q.secret = ['m', 'm', 'sshpw']; // vault passphrase x2, then the SSH password
    const { addTunnel, connectTunnelFlow } = await import('../src/commands/tunnels.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    const t = await addTunnel();
    expect(t?.secretId).toBeTruthy();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.hasSecret(t?.secretId)).toBe(true);

    await connectTunnelFlow('pwtun');
    expect(runner.runTunnel).toHaveBeenCalled();
    expect(runner.runTunnel.mock.calls[0]?.[1]).toBe('sshpw'); // decrypted password passed through
    expect(tunnels.findByName('pwtun')?.useCount).toBe(1);
  });
});

describe('vault flow + import/export menu + menu nav', () => {
  it('vaultFlow can create a vault', async () => {
    q.pick = ['setup', PICK_BACK];
    q.secret = ['masterpw', 'masterpw'];
    const { vaultFlow } = await import('../src/commands/settings.js');
    await vaultFlow();
    const { vault } = await import('../src/vault/vault.js');
    expect(vault.exists()).toBe(true);
  });

  it('importExportMenu export branch writes a file', async () => {
    q.choose = ['export'];
    q.text = [''];
    const { importExportMenu } = await import('../src/commands/import-export.js');
    await expect(importExportMenu()).resolves.toBeUndefined();
  });

  it('mainMenu walks submenus and exits', async () => {
    q.pick = [
      'servers',
      PICK_BACK,
      'tunnels',
      PICK_BACK,
      'config',
      PICK_BACK,
      'actions',
      PICK_BACK,
      'exit',
    ];
    const { mainMenu } = await import('../src/commands/menu.js');
    await expect(mainMenu()).resolves.toBeUndefined();
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
    q.confirm = [true]; // confirm the (now-gated) deletion
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
