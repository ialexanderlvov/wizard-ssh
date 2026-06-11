/** `wssh tunnel autostart` flows: install/remove/list boot-time units for
 *  background tunnels (launchd on macOS, systemd user units on Linux). */

import {
  autostartSupported,
  installAutostart,
  uninstallAutostart,
  listAutostart,
  type AutostartEntry,
} from '../ssh/autostart.js';
import { tunnels } from '../store/tunnels.store.js';
import { isLinux } from '../utils/platform.js';
import { tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { resolveEntity } from './helpers.js';
import { tr } from '../i18n/index.js';

export async function autostartAddFlow(name?: string): Promise<number> {
  if (!autostartSupported()) {
    ui.printError(tr.tunnels.autostartUnsupported);
    return 1;
  }
  const tunnel = await resolveEntity(tunnels, name, tr.tunnels.autostartPickAdd);
  if (!tunnel) return 0;
  if (tunnel.auth === 'password') {
    // The unit runs bare ssh with no TTY and no sshpass lifecycle — same rule
    // as background tunnels.
    ui.printError(tr.tunnels.bgNoPassword);
    return 1;
  }
  // At boot there is no unlocked ssh-agent in the unit's environment, so an
  // agent-auth tunnel will only come up after the agent holds the key.
  if (tunnel.auth === 'agent') ui.printWarn(tr.tunnels.autostartAgentCaveat);

  const res = installAutostart(tunnel);
  if (!res.ok) {
    ui.printError(tr.tunnels.autostartFailed(res.detail?.trim() || tr.common.dash));
    return 1;
  }
  ui.printOk(tr.tunnels.autostartInstalled(tunnel.name));
  ui.printInfo(tr.tunnels.autostartUnitFile(tilde(res.file)));
  ui.printInfo(
    isLinux
      ? tr.tunnels.autostartLogsSystemd(tunnel.id)
      : tr.tunnels.autostartLogsLaunchd(tunnel.id),
  );
  ui.printInfo(tr.tunnels.autostartEditNote);
  return 0;
}

export async function autostartRemoveFlow(name?: string): Promise<number> {
  if (!autostartSupported()) {
    ui.printError(tr.tunnels.autostartUnsupported);
    return 1;
  }
  const entries = listAutostart();
  if (!entries.length) {
    ui.printWarn(tr.tunnels.autostartNone);
    return 0;
  }
  let id: string | null = null;
  if (name) {
    const tunnel = tunnels.findByName(name);
    id = tunnel && entries.some((e) => e.id === tunnel.id) ? tunnel.id : null;
    if (!id) {
      ui.printError(tr.tunnels.autostartNotFound(name));
      return 1;
    }
  } else {
    ui.ensureInteractive(tr.tunnels.autostartEnsure);
    const picked = await ui.pickFromList<AutostartEntry>({
      message: tr.tunnels.autostartPickRemove,
      items: entries,
      render: (e) => renderEntry(e),
      search: (e) => `${tunnels.findById(e.id)?.name ?? ''} ${e.id}`,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    id = picked.id;
  }
  const res = uninstallAutostart(id);
  if (res.ok) ui.printOk(tr.tunnels.autostartRemoved);
  else ui.printWarn(tr.tunnels.autostartNothingRemoved);
  return 0;
}

function renderEntry(e: AutostartEntry): string {
  const tunnel = tunnels.findById(e.id);
  const dot =
    e.active === null ? ui.chalk.dim('●') : e.active ? ui.chalk.green('●') : ui.chalk.red('●');
  const label = tunnel
    ? ui.chalk.bold(tunnel.name)
    : ui.chalk.dim(tr.tunnels.autostartOrphan(e.id));
  return `${dot} ${label}  ${ui.chalk.dim(tilde(e.file))}`;
}

export function autostartListFlow(opts: { json?: boolean } = {}): void {
  if (!autostartSupported()) {
    if (opts.json) console.log('[]');
    else ui.printError(tr.tunnels.autostartUnsupported);
    return;
  }
  const entries = listAutostart();
  if (opts.json) {
    console.log(
      JSON.stringify(
        entries.map((e) => ({ ...e, name: tunnels.findById(e.id)?.name ?? null })),
        null,
        2,
      ),
    );
    return;
  }
  if (!entries.length) {
    ui.printWarn(tr.tunnels.autostartNone);
    return;
  }
  ui.printSection('🚀', tr.tunnels.autostartSection(entries.length));
  for (const e of entries) console.log('  ' + renderEntry(e));
}
