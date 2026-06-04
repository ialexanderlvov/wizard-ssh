/** Human-readable summaries of servers, tunnels and config hosts. */

import boxen from 'boxen';
import type { ConnectionTarget, Entity, Server, SshConfigHost, Tunnel } from '../core/types.js';
import { chalk, accent, TYPE_BADGE } from './theme.js';
import { relativeTime, absoluteTime } from '../utils/time.js';
import { tilde } from '../utils/strings.js';
import { tr } from '../i18n/index.js';

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
  const d = tr.ui.detail;
  const head = e.kind === 'tunnel' ? d.tunnel : d.server;
  rows.push(
    chalk.dim(head + '  ') +
      chalk.bold.white(e.name) +
      (e.description ? chalk.dim('  — ' + e.description) : ''),
  );
  rows.push('');

  if (e.hostMode === 'sshconfig' && !e.host) {
    rows.push(chalk.dim(d.host) + chalk.magenta(d.configArrow + e.sshHost));
  } else {
    rows.push(chalk.dim(d.host) + chalk.white(`${e.user || 'root'}@${e.host}`));
    if (e.sshPort && Number(e.sshPort) !== 22)
      rows.push(chalk.dim(d.sshPort) + chalk.white(String(e.sshPort)));
    const authLabel =
      e.auth === 'password'
        ? d.authPassword
        : e.keyPath
          ? d.authKey
          : e.hostMode === 'sshconfig'
            ? d.authConfig
            : d.authAgent;
    rows.push(
      chalk.dim(d.auth) +
        chalk.white(authLabel) +
        (e.keyPath ? chalk.dim(`  (${tilde(e.keyPath)})`) : '') +
        (e.auth === 'password' ? chalk.dim(e.secretId ? d.passwordSaved : d.passwordAsk) : ''),
    );
    if (e.kind === 'server' && e.hostMode === 'sshconfig')
      rows.push(chalk.dim(d.source) + chalk.magenta(d.configArrow + e.sshHost));
  }

  // ProxyJump chain (bastion route) — "you → bastion → … → target".
  if (e.kind === 'server' && (e as Server).proxyJump) {
    const hops = (e as Server)
      .proxyJump!.split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) {
      const target = e.host || e.sshHost;
      const chain = [
        chalk.dim(d.jumpYou),
        ...hops.map((h) => chalk.cyan(h)),
        chalk.white(target),
      ].join(chalk.dim(' → '));
      rows.push(chalk.dim(d.jump) + chain);
    }
  }

  if (e.kind === 'tunnel') {
    const t = e as Tunnel;
    rows.push(
      chalk.dim(d.forward) + (TYPE_BADGE[t.type] ?? '') + ' ' + chalk.gray(forwardSummary(t)),
    );
    if (t.type === 'local') {
      rows.push(
        chalk.dim(d.open) +
          accent(`http://localhost:${t.localPort}`) +
          (t.openBrowser ? chalk.dim(d.auto) : ''),
      );
    }
  }

  if (e.tags.length)
    rows.push(chalk.dim(d.tags) + chalk.cyan(e.tags.map((x) => '#' + x).join(' ')));
  rows.push('');
  rows.push(
    chalk.dim(
      d.footer(
        absoluteTime(e.createdAt),
        absoluteTime(e.updatedAt),
        relativeTime(e.lastUsedAt),
        e.useCount,
      ),
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
