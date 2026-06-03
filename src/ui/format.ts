/** Human-readable summaries of servers, tunnels and config hosts. */

import boxen from 'boxen';
import type { ConnectionTarget, Entity, SshConfigHost, Tunnel } from '../core/types.js';
import { chalk, accent, TYPE_BADGE } from './theme.js';
import { relativeTime, absoluteTime } from '../utils/time.js';
import { tilde } from '../utils/strings.js';

export function targetSummary(t: ConnectionTarget): string {
  // Config-backed servers carry a resolved host — show it; otherwise (a tunnel
  // that only references an alias) fall back to the alias itself.
  if (t.hostMode === 'sshconfig' && !t.host) return `@${t.sshHost}`;
  const port = t.sshPort && Number(t.sshPort) !== 22 ? `:${t.sshPort}` : '';
  return `${t.user || 'root'}@${t.host || t.sshHost}${port}`;
}

export function forwardSummary(t: Tunnel): string {
  if (t.type === 'dynamic') return `:${t.localPort} SOCKS`;
  if (t.type === 'remote') return `${t.remotePort}→${t.remoteHost || 'localhost'}:${t.localPort}`;
  return `${t.localPort}→${t.remoteHost || '127.0.0.1'}:${t.remotePort}`;
}

const authBadge = (t: ConnectionTarget): string => {
  if (t.auth === 'password') return chalk.dim(t.secretId ? '🔒 saved' : '🔑 password');
  if (t.keyPath) return chalk.dim('🗝 key');
  if (t.hostMode === 'sshconfig') return chalk.dim('config');
  return chalk.dim('🤝 agent');
};

const kindBadge = (e: Entity): string =>
  e.kind === 'tunnel'
    ? (TYPE_BADGE[(e as Tunnel).type] ?? '') + ' ' + chalk.gray(forwardSummary(e as Tunnel))
    : chalk.gray('shell');

/** Compact two-line entry for choice lists. */
export function entityLine(e: Entity): string {
  const icon = e.kind === 'tunnel' ? '🚇' : '🖥';
  const name = chalk.bold.white(e.name);
  const desc = e.description ? chalk.dim(' — ' + e.description) : '';
  const tags = e.tags.length ? ' ' + chalk.dim('#' + e.tags.join(' #')) : '';
  const used = chalk.dim(`· ${relativeTime(e.lastUsedAt)}`);
  const target =
    e.hostMode === 'sshconfig' ? chalk.magenta(targetSummary(e)) : chalk.cyan(targetSummary(e));
  return `${icon} ${name}${desc}${tags}\n     ${chalk.dim('↳')} ${target} ${chalk.dim('·')} ${kindBadge(e)} ${used}`;
}

export function detailBox(e: Entity): string {
  const rows: string[] = [];
  const head = e.kind === 'tunnel' ? '🚇 Туннель' : '🖥 Сервер';
  rows.push(
    chalk.dim(head + '  ') +
      chalk.bold.white(e.name) +
      (e.description ? chalk.dim('  — ' + e.description) : ''),
  );
  rows.push('');

  if (e.hostMode === 'sshconfig' && !e.host) {
    rows.push(chalk.dim('Хост       ') + chalk.magenta('~/.ssh/config → ' + e.sshHost));
  } else {
    rows.push(chalk.dim('Хост       ') + chalk.white(`${e.user || 'root'}@${e.host}`));
    if (e.sshPort && Number(e.sshPort) !== 22)
      rows.push(chalk.dim('SSH-порт   ') + chalk.white(String(e.sshPort)));
    const authLabel =
      e.auth === 'password'
        ? 'пароль'
        : e.keyPath
          ? 'ключ'
          : e.hostMode === 'sshconfig'
            ? 'config'
            : 'agent';
    rows.push(
      chalk.dim('Авторизация ') +
        chalk.white(authLabel) +
        (e.keyPath ? chalk.dim(`  (${tilde(e.keyPath)})`) : '') +
        (e.auth === 'password'
          ? chalk.dim(e.secretId ? '  (пароль сохранён)' : '  (спросим при подключении)')
          : ''),
    );
    if (e.kind === 'server' && e.hostMode === 'sshconfig')
      rows.push(chalk.dim('Источник   ') + chalk.magenta('~/.ssh/config → ' + e.sshHost));
  }

  if (e.kind === 'tunnel') {
    const t = e as Tunnel;
    rows.push(
      chalk.dim('Проброс    ') + (TYPE_BADGE[t.type] ?? '') + ' ' + chalk.gray(forwardSummary(t)),
    );
    if (t.type === 'local') {
      rows.push(
        chalk.dim('Открыть    ') +
          accent(`http://localhost:${t.localPort}`) +
          (t.openBrowser ? chalk.dim('  (авто)') : ''),
      );
    }
  }

  if (e.tags.length)
    rows.push(chalk.dim('Теги       ') + chalk.cyan(e.tags.map((x) => '#' + x).join(' ')));
  rows.push('');
  rows.push(
    chalk.dim(
      `создан ${absoluteTime(e.createdAt)} · изменён ${absoluteTime(e.updatedAt)} · ` +
        `использован ${relativeTime(e.lastUsedAt)} · ${e.useCount}×`,
    ),
  );

  return boxen(rows.join('\n'), { padding: 1, borderStyle: 'round', borderColor: 'cyan' });
}

export const authSummary = authBadge;

export function configHostLine(h: SshConfigHost): string {
  const meta = [h.user && `${h.user}@`, h.hostName, h.port && `:${h.port}`]
    .filter(Boolean)
    .join('');
  return `${chalk.magenta(h.alias)}${meta ? chalk.dim('  → ' + meta) : ''}`;
}
