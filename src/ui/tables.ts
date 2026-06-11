/** Pretty tables for list views. */

import Table from 'cli-table3';
import type { Entity, SshConfigHost, Tunnel } from '../core/types.js';
import type { FleetStatus } from '../ssh/features.js';
import type { KeyInfo } from '../ssh/keys.js';
import type { TunnelSession } from '../store/sessions.store.js';
import { chalk, TYPE_BADGE } from './theme.js';
import { targetSummary, forwardSummary } from './format.js';
import { relativeTime } from '../utils/time.js';
import { tilde, stripControl } from '../utils/strings.js';
import { tr } from '../i18n/index.js';

const ROUND = {
  top: '─',
  'top-mid': '┬',
  'top-left': '╭',
  'top-right': '╮',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '╰',
  'bottom-right': '╯',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
};

export function renderEntityTable(items: Entity[]): string {
  const table = new Table({
    head: tr.ui.table.entityHead.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  items.forEach((e, i) => {
    const kind =
      e.kind === 'tunnel'
        ? (TYPE_BADGE[(e as Tunnel).type] ?? '') + ' ' + chalk.gray(forwardSummary(e as Tunnel))
        : chalk.gray(tr.ui.table.shell);
    table.push([
      chalk.dim(String(i + 1)),
      chalk.bold.white(e.name) + (e.description ? '\n' + chalk.dim(e.description) : ''),
      e.hostMode === 'sshconfig' ? chalk.magenta(targetSummary(e)) : chalk.white(targetSummary(e)),
      kind,
      relativeTime(e.lastUsedAt),
      chalk.yellow(String(e.useCount || 0)),
      e.tags.length ? chalk.dim(e.tags.join(', ')) : chalk.dim('—'),
    ]);
  });
  return table.toString();
}

export function renderStatusTable(rows: FleetStatus[]): string {
  const table = new Table({
    head: tr.ui.table.statusHead.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  for (const r of rows) {
    const up = r.result.open;
    table.push([
      up ? chalk.green('●') : chalk.red('○'),
      chalk.bold.white(r.name),
      r.kind === 'tunnel' ? chalk.gray(tr.common.tunnel) : chalk.gray(tr.common.server),
      chalk.dim(`${r.result.host}:${r.result.port}`),
      up ? chalk.green(tr.ui.table.up) : chalk.red(tr.ui.table.down),
      up ? chalk.yellow(tr.ui.table.ms(r.result.ms)) : chalk.dim(tr.common.dash),
    ]);
  }
  return table.toString();
}

export function renderKeysTable(keys: KeyInfo[]): string {
  const table = new Table({
    head: tr.ui.table.keysHead.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  keys.forEach((k, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      chalk.white(tilde(k.path)),
      chalk.magenta(k.type),
      k.bits ? chalk.dim(String(k.bits)) : chalk.dim(tr.common.dash),
      k.fingerprint ? chalk.dim(k.fingerprint) : chalk.dim(tr.common.dash),
      k.comment ? chalk.dim(k.comment) : chalk.dim(tr.common.dash),
      k.hasPub ? chalk.green(tr.common.present) : chalk.red(tr.common.absent),
    ]);
  });
  return table.toString();
}

export function renderSessionsTable(
  rows: Array<{ session: TunnelSession; listening: boolean | null }>,
): string {
  const table = new Table({
    head: tr.ui.table.sessionsHead.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  for (const { session: s, listening } of rows) {
    // Sanitize the human/display fields: a hand-edited sessions.json could embed
    // terminal escapes in name/forward/target (the same sanitize-on-display
    // standard the config parser and log viewer follow).
    table.push([
      // red = the ssh process is alive but the local forward is not listening
      listening === false ? chalk.red('●') : chalk.green('●'),
      chalk.bold.white(stripControl(s.name)) +
        (s.store === 'temp' ? chalk.dim(tr.ui.table.temp) : ''),
      chalk.gray(stripControl(s.forward)),
      chalk.dim(stripControl(s.target)),
      chalk.yellow(String(s.pid)),
      relativeTime(s.startedAt),
    ]);
  }
  return table.toString();
}

export function renderConfigHostsTable(hosts: SshConfigHost[]): string {
  const table = new Table({
    head: tr.ui.table.configHead.map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  hosts.forEach((h, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      chalk.magenta(h.alias),
      h.hostName || chalk.dim(tr.common.dash),
      h.user || chalk.dim(tr.common.dash),
      h.port || chalk.dim(tr.common.dash),
      h.identityFile ? chalk.dim(h.identityFile) : chalk.dim(tr.common.dash),
    ]);
  });
  return table.toString();
}
