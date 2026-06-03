/** Unified, emoji-free single-line renderers + sort presets for the list prompt.
 *  Everything that shows a list of servers/tunnels/config-hosts uses these so
 *  the rows look identical everywhere. */

import type { Entity, Server, SshConfigHost, Tunnel } from '../core/types.js';
import { chalk } from './theme.js';
import { relativeTime, ts } from '../utils/time.js';
import { targetSummary, forwardSummary } from './format.js';
import type { ListSort } from './list-prompt.js';

const colWidth = (names: string[], max = 28): number =>
  Math.min(max, Math.max(8, ...names.map((n) => n.length)));

const pad = (s: string, w: number): string =>
  s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);

const kindOrForward = (e: Entity): string =>
  e.kind === 'tunnel' ? forwardSummary(e as Tunnel) : 'shell';

/** Build a renderer that column-aligns names across the given entities. */
export function entityRowRenderer(items: readonly Entity[]): (e: Entity) => string {
  const w = colWidth(items.map((e) => e.name));
  return (e) => {
    const name = chalk.bold(pad(e.name, w));
    const target =
      e.hostMode === 'sshconfig' ? chalk.magenta(targetSummary(e)) : chalk.cyan(targetSummary(e));
    const mid = chalk.gray(kindOrForward(e));
    const used = chalk.dim(relativeTime(e.lastUsedAt));
    const desc = e.description ? chalk.dim('  ' + e.description) : '';
    return `${name}  ${target}  ${chalk.dim('·')} ${mid}  ${chalk.dim('·')} ${used}${desc}`;
  };
}

export const ENTITY_SORTS: ReadonlyArray<ListSort<Entity>> = [
  {
    label: 'недавние',
    compare: (a, b) => ts(b.lastUsedAt) - ts(a.lastUsedAt) || a.name.localeCompare(b.name),
  },
  { label: 'имя', compare: (a, b) => a.name.localeCompare(b.name) },
  {
    label: 'подключения',
    compare: (a, b) => (b.useCount || 0) - (a.useCount || 0) || a.name.localeCompare(b.name),
  },
];

export const entitySearch = (e: Entity): string =>
  [e.name, e.description, e.host, e.sshHost, e.user, ...e.tags].filter(Boolean).join(' ');

/** Config-host rows. */
export function configRowRenderer(items: readonly SshConfigHost[]): (h: SshConfigHost) => string {
  const w = colWidth(items.map((h) => h.alias));
  return (h) => {
    const meta = [h.user && `${h.user}@`, h.hostName, h.port && `:${h.port}`]
      .filter(Boolean)
      .join('');
    return `${chalk.bold(pad(h.alias, w))}  ${chalk.dim(meta || '—')}`;
  };
}

export const CONFIG_SORTS: ReadonlyArray<ListSort<SshConfigHost>> = [
  { label: 'имя', compare: (a, b) => a.alias.localeCompare(b.alias) },
  {
    label: 'хост',
    compare: (a, b) => a.hostName.localeCompare(b.hostName) || a.alias.localeCompare(b.alias),
  },
];

export const configSearch = (h: SshConfigHost): string => `${h.alias} ${h.hostName} ${h.user}`;

/** Unified quick-connect item (server / tunnel / config-host). */
export type ConnectItem =
  | { kind: 'entity'; entity: Server | Tunnel }
  | { kind: 'config'; host: SshConfigHost };

export function connectRowRenderer(items: readonly ConnectItem[]): (i: ConnectItem) => string {
  const names = items.map((i) => (i.kind === 'entity' ? i.entity.name : i.host.alias));
  const w = colWidth(names);
  return (i) => {
    if (i.kind === 'config') {
      const h = i.host;
      const meta = [h.user && `${h.user}@`, h.hostName].filter(Boolean).join('');
      return `${chalk.bold(pad(h.alias, w))}  ${chalk.dim(meta || '—')}  ${chalk.dim('· config')}`;
    }
    const e = i.entity;
    const target =
      e.hostMode === 'sshconfig' ? chalk.magenta(targetSummary(e)) : chalk.cyan(targetSummary(e));
    const kind =
      e.kind === 'tunnel' ? chalk.gray(forwardSummary(e as Tunnel)) : chalk.gray('shell');
    return `${chalk.bold(pad(e.name, w))}  ${target}  ${chalk.dim('·')} ${kind}  ${chalk.dim('· ' + relativeTime(e.lastUsedAt))}`;
  };
}

export const connectSearch = (i: ConnectItem): string =>
  i.kind === 'entity' ? entitySearch(i.entity) : configSearch(i.host);
