/** `wssh info` — a compact summary of the environment, data location, available
 *  tooling and inventory. Read-only and unlock-free (vault secret count is read
 *  straight from vault.json, never decrypted). */

import os from 'node:os';
import { APP_NAME, APP_VERSION } from '../core/constants.js';
import { DATA_DIR, FILES } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { readJson } from '../store/json-file.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { sessions } from '../store/sessions.store.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import { listKeys } from '../ssh/keys.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

/** Secret count without unlocking: count the encrypted blobs in vault.json. */
function vaultSecretCount(): number {
  if (!vault.exists()) return 0;
  const { data } = readJson<{ secrets?: Record<string, unknown> }>(FILES.vault, {});
  return data?.secrets ? Object.keys(data.secrets).length : 0;
}

function sshVersion(): string {
  const res = capture('ssh', ['-V']);
  return (res.stderr || res.stdout || '').trim();
}

export interface InfoData {
  app: string;
  version: string;
  node: string;
  platform: string;
  dataDir: string;
  ssh: string;
  tools: Record<string, boolean>;
  counts: { servers: number; tunnels: number; tempTunnels: number; keys: number; sessions: number };
  vault: { exists: boolean; secrets: number; touchId: boolean };
}

function collect(): InfoData {
  const tool = (n: string): boolean => commandExists(n);
  return {
    app: APP_NAME,
    version: APP_VERSION,
    node: process.version,
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    dataDir: DATA_DIR,
    ssh: sshVersion(),
    tools: {
      ssh: tool('ssh'),
      scp: tool('scp'),
      rsync: tool('rsync'),
      'ssh-keygen': tool('ssh-keygen'),
      'ssh-copy-id': tool('ssh-copy-id'),
      sshpass: tool('sshpass'),
    },
    counts: {
      servers: servers.all().length,
      tunnels: tunnels.all().length,
      tempTunnels: tempTunnels.all().length,
      keys: listKeys().length,
      sessions: sessions.list().length,
    },
    vault: {
      exists: vault.exists(),
      secrets: vaultSecretCount(),
      touchId: vault.isTouchIdEnabled(),
    },
  };
}

export function info(opts: { json?: boolean } = {}): void {
  const d = collect();
  if (opts.json) {
    console.log(JSON.stringify(d, null, 2));
    return;
  }
  const s = settings.get();
  const yes = (b: boolean): string =>
    b ? ui.chalk.green(tr.common.yes) : ui.chalk.dim(tr.common.no);
  const row = (k: string, v: string): void => console.log(`  ${ui.chalk.dim(k.padEnd(16))} ${v}`);

  ui.printSection('ℹ️', `${d.app} ${d.version}`);
  row('Node', d.node);
  row(tr.info.rowPlatform, d.platform);
  row(tr.info.rowData, d.dataDir);
  if (d.ssh) row('OpenSSH', d.ssh);
  row(
    tr.info.rowTools,
    Object.entries(d.tools)
      .map(([n, ok]) => (ok ? ui.chalk.green(n) : ui.chalk.dim(n)))
      .join(' '),
  );
  row(
    tr.info.rowInventory,
    tr.info.inventory(
      d.counts.servers,
      d.counts.tunnels,
      d.counts.tempTunnels,
      d.counts.keys,
      d.counts.sessions,
    ),
  );
  row(
    tr.info.rowVault,
    d.vault.exists
      ? tr.info.vaultSecrets(d.vault.secrets, yes(d.vault.touchId))
      : tr.info.vaultNone,
  );
  row(tr.info.rowAutoReconnect, yes(s.tunnelAutoReconnect));
}
