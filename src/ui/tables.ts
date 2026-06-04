/** Pretty tables for list views. */

import Table from 'cli-table3';
import type { Entity, SshConfigHost, Tunnel } from '../core/types.js';
import type { FleetStatus } from '../ssh/features.js';
import type { KeyInfo } from '../ssh/keys.js';
import type { TunnelSession } from '../store/sessions.store.js';
import { chalk, TYPE_BADGE } from './theme.js';
import { targetSummary, forwardSummary } from './format.js';
import { relativeTime } from '../utils/time.js';
import { tilde } from '../utils/strings.js';

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

export function renderStatusTable(rows: FleetStatus[]): string {
  const table = new Table({
    head: ['', 'Имя', 'Тип', 'Адрес', 'Состояние', 'Задержка'].map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  for (const r of rows) {
    const up = r.result.open;
    table.push([
      up ? chalk.green('●') : chalk.red('○'),
      chalk.bold.white(r.name),
      r.kind === 'tunnel' ? chalk.gray('туннель') : chalk.gray('сервер'),
      chalk.dim(`${r.result.host}:${r.result.port}`),
      up ? chalk.green('доступен') : chalk.red('недоступен'),
      up ? chalk.yellow(`${r.result.ms} мс`) : chalk.dim('—'),
    ]);
  }
  return table.toString();
}

export function renderKeysTable(keys: KeyInfo[]): string {
  const table = new Table({
    head: ['#', 'Файл', 'Тип', 'Биты', 'Отпечаток', 'Комментарий', '.pub'].map((h) =>
      chalk.cyan.bold(h),
    ),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  keys.forEach((k, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      chalk.white(tilde(k.path)),
      chalk.magenta(k.type),
      k.bits ? chalk.dim(String(k.bits)) : chalk.dim('—'),
      k.fingerprint ? chalk.dim(k.fingerprint) : chalk.dim('—'),
      k.comment ? chalk.dim(k.comment) : chalk.dim('—'),
      k.hasPub ? chalk.green('есть') : chalk.red('нет'),
    ]);
  });
  return table.toString();
}

export function renderSessionsTable(rows: TunnelSession[]): string {
  const table = new Table({
    head: ['', 'Туннель', 'Проброс', 'Цель', 'PID', 'Запущен'].map((h) => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    chars: ROUND,
  });
  for (const s of rows) {
    table.push([
      chalk.green('●'),
      chalk.bold.white(s.name) + (s.store === 'temp' ? chalk.dim(' (врем.)') : ''),
      chalk.gray(s.forward),
      chalk.dim(s.target),
      chalk.yellow(String(s.pid)),
      relativeTime(s.startedAt),
    ]);
  }
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
