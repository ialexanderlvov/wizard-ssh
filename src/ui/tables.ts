/** Pretty tables for list views. */

import Table from 'cli-table3';
import type { Entity, SshConfigHost, Tunnel } from '../core/types.js';
import { chalk, TYPE_BADGE } from './theme.js';
import { targetSummary, forwardSummary } from './format.js';
import { relativeTime } from '../utils/time.js';

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
    head: ['#', 'Имя', 'Цель', 'Тип', 'Использован', 'Раз', 'Теги'].map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  items.forEach((e, i) => {
    const kind =
      e.kind === 'tunnel'
        ? (TYPE_BADGE[(e as Tunnel).type] ?? '') + ' ' + chalk.gray(forwardSummary(e as Tunnel))
        : chalk.gray('shell');
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

export function renderConfigHostsTable(hosts: SshConfigHost[]): string {
  const table = new Table({
    head: ['#', 'Alias', 'HostName', 'User', 'Port', 'IdentityFile'].map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  hosts.forEach((h, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      chalk.magenta(h.alias),
      h.hostName || chalk.dim('—'),
      h.user || chalk.dim('—'),
      h.port || chalk.dim('—'),
      h.identityFile ? chalk.dim(h.identityFile) : chalk.dim('—'),
    ]);
  });
  return table.toString();
}
