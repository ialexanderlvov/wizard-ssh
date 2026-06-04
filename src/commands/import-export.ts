/** Backup / restore all lists (servers, tunnels, settings, encrypted vault). */

import fs from 'node:fs';
import path from 'node:path';
import type { Server, Settings, Tunnel } from '../core/types.js';
import { DATA_DIR, FILES } from '../core/paths.js';
import { readJson, writeJson } from '../store/json-file.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { settings } from '../store/settings.store.js';
import { isVaultFileShape } from '../vault/vault.js';
import {
  isSafeKeyPath,
  isValidForwardHost,
  isValidHostOrIp,
  isValidName,
  isValidSshAlias,
  isValidUser,
} from '../utils/validators.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

/** An imported file is untrusted input. A server/tunnel record flows straight
 *  into ~/.ssh/config (host/user/keyPath/alias) and the ssh argv (remoteHost),
 *  so reject any record whose fields could inject a directive before it is ever
 *  written. (formatBlock guards too, but this surfaces a clean count instead of
 *  aborting the whole import on the first bad record.) */
function serverIsSafe(s: Partial<Server>): boolean {
  if (!isValidSshAlias(String(s.name ?? s.sshHost ?? ''))) return false;
  if (s.host && !isValidHostOrIp(String(s.host))) return false;
  if (s.user && !isValidUser(String(s.user))) return false;
  if (s.keyPath && !isSafeKeyPath(String(s.keyPath))) return false;
  return true;
}

function tunnelIsSafe(t: Partial<Tunnel>): boolean {
  if (!isValidName(String(t.name ?? ''))) return false;
  if (t.hostMode === 'sshconfig') {
    if (!isValidSshAlias(String(t.sshHost ?? ''))) return false;
  } else if (t.host && !isValidHostOrIp(String(t.host))) {
    return false;
  }
  if (t.user && !isValidUser(String(t.user))) return false;
  if (t.keyPath && !isSafeKeyPath(String(t.keyPath))) return false;
  if (t.remoteHost && !isValidForwardHost(String(t.remoteHost))) return false;
  return true;
}

interface Bundle {
  app: 'wizard-ssh';
  version: 1;
  exportedAt: string;
  servers: Server[];
  tunnels: Tunnel[];
  settings: Settings;
  /** encrypted vault.json contents (safe — passwords stay encrypted) */
  vault?: unknown;
}

export function exportData(file?: string): string {
  const target = file
    ? path.resolve(file)
    : path.join(DATA_DIR, `wizard-ssh-export-${Date.now()}.json`);
  const bundle: Bundle = {
    app: 'wizard-ssh',
    version: 1,
    exportedAt: new Date().toISOString(),
    servers: servers.all(),
    tunnels: tunnels.all(),
    settings: settings.get(),
  };
  if (fs.existsSync(FILES.vault)) {
    bundle.vault = readJson<unknown>(FILES.vault, null).data;
  }
  writeJson(target, bundle);
  ui.printOk(tr.importExport.exportedTo(target));
  ui.printInfo(
    tr.importExport.exportSummary(bundle.servers.length, bundle.tunnels.length, !!bundle.vault),
  );
  return target;
}

export async function importData(file: string, opts: { replace?: boolean } = {}): Promise<void> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    ui.printError(tr.importExport.fileNotFound(abs));
    process.exitCode = 1;
    return;
  }
  const { data } = readJson<Partial<Bundle>>(abs, {});
  if (data.app !== 'wizard-ssh' || !Array.isArray(data.servers)) {
    ui.printError(tr.importExport.notExportFile);
    process.exitCode = 1;
    return;
  }

  let replace = opts.replace ?? false;
  if (!opts.replace && ui.isInteractive()) {
    replace = await ui.choose<boolean>({
      message: tr.importExport.howToImport,
      choices: [
        { name: tr.importExport.choiceAdd, value: false },
        // Servers live in ~/.ssh/config (shared, source of truth) so they are
        // merged/updated, not wiped; only the tunnels list is truly replaced.
        { name: tr.importExport.choiceReplace, value: true },
      ],
    });
  }

  const rawServers = data.servers ?? [];
  const rawTunnels = data.tunnels ?? [];
  const importedServers = rawServers.filter(serverIsSafe);
  const importedTunnels = rawTunnels.filter(tunnelIsSafe);
  const skipped =
    rawServers.length - importedServers.length + (rawTunnels.length - importedTunnels.length);
  if (skipped > 0) ui.printWarn(tr.importExport.skippedRecords(skipped));

  if (replace) {
    servers.replaceAll(importedServers);
    tunnels.replaceAll(importedTunnels);
  } else {
    for (const s of importedServers) {
      let name = s.name;
      let i = 2;
      while (servers.nameExists(name)) name = `${s.name}-${i++}`;
      servers.create({ ...s, name });
    }
    for (const t of importedTunnels) {
      let name = t.name;
      let i = 2;
      while (tunnels.nameExists(name)) name = `${t.name}-${i++}`;
      tunnels.create({ ...t, name });
    }
  }

  if (data.settings) settings.update(data.settings);

  // Restore the encrypted vault only when there is none locally (never clobber).
  // The bundle is untrusted: validate the vault's shape AND KDF bounds before
  // persisting, so a hostile export can't write a vault.json that crashes,
  // OOMs, or permanently locks out the next unlock.
  if (data.vault && !fs.existsSync(FILES.vault)) {
    if (isVaultFileShape(data.vault)) {
      writeJson(FILES.vault, data.vault);
      ui.printInfo(tr.importExport.vaultRestored);
    } else {
      ui.printWarn(tr.importExport.vaultBadFormat);
    }
  } else if (data.vault) {
    ui.printWarn(tr.importExport.vaultExists);
  }

  ui.printOk(
    tr.importExport.importDone(
      replace ? tr.importExport.importModeReplace : tr.importExport.importModeAdd,
      importedServers.length,
      importedTunnels.length,
    ),
  );
}

export async function importExportMenu(): Promise<void> {
  ui.ensureInteractive(tr.importExport.ensureInteractive);
  const action = await ui.choose<string>({
    message: tr.importExport.menuTitle,
    choices: [
      { name: tr.importExport.choiceExport, value: 'export' },
      { name: tr.importExport.choiceImport, value: 'import' },
      { name: tr.importExport.choiceBack, value: 'back' },
    ],
  });
  if (action === 'back') return;
  if (action === 'export') {
    const file = await ui.text({ message: tr.importExport.exportPathPrompt, default: '' });
    exportData(file.trim() || undefined);
  } else {
    const file = await ui.text({
      message: tr.importExport.importPathPrompt,
      validate: (v) => v.trim().length > 0 || tr.importExport.specifyPath,
    });
    await importData(file.trim());
  }
}
