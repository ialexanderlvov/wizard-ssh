/** Unified quick-connect: pick (or name-resolve) across servers (= ~/.ssh/config
 *  hosts) and tunnels, then connect appropriately. */

import type { Server, Tunnel } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { filterEntities } from '../search/index.js';
import * as ui from '../ui/index.js';
import { ts } from '../utils/time.js';
import { connectServer } from './servers.js';
import { connectTunnel } from './tunnels.js';
import { tr } from '../i18n/index.js';

type ConnectItem = ui.ConnectItem;

const nameOf = (i: ConnectItem): string => (i.kind === 'entity' ? i.entity.name : i.host.alias);
const recentOf = (i: ConnectItem): number => (i.kind === 'entity' ? ts(i.entity.lastUsedAt) : 0);

const QC_SORTS: ReadonlyArray<ui.ListSort<ConnectItem>> = [
  {
    label: tr.connect.sortRecent,
    compare: (a, b) => recentOf(b) - recentOf(a) || nameOf(a).localeCompare(nameOf(b)),
  },
  { label: tr.connect.sortName, compare: (a, b) => nameOf(a).localeCompare(nameOf(b)) },
];

function allConnectItems(): ConnectItem[] {
  // Servers ARE ~/.ssh/config hosts, so this single list already covers config.
  return [
    ...servers.sorted('recent').map((e): ConnectItem => ({ kind: 'entity', entity: e })),
    ...tunnels.sorted('recent').map((e): ConnectItem => ({ kind: 'entity', entity: e })),
  ];
}

type ConnectOpts = { tmux?: string | boolean; mosh?: boolean };

async function dispatch(i: ConnectItem, opts: ConnectOpts = {}): Promise<number> {
  if (i.kind === 'config') return connectServer(servers.findById(i.host.alias) as Server, opts);
  const e = i.entity;
  // tmux only applies to an interactive shell (server), not a tunnel.
  return e.kind === 'tunnel' ? connectTunnel(e as Tunnel) : connectServer(e as Server, opts);
}

/** Interactive picker across everything, then connect. */
export async function quickConnect(): Promise<number> {
  const items = allConnectItems();
  if (!items.length) {
    ui.printWarn(tr.connect.nothingYet);
    return 0;
  }
  ui.ensureInteractive(tr.connect.ensureQuickConnect);
  const res = await ui.pickFromList<ConnectItem>({
    message: tr.connect.pickMessage,
    items,
    render: ui.connectRowRenderer(items),
    search: ui.connectSearch,
    sorts: QC_SORTS,
    pageSize: 14,
  });
  return res === ui.BACK ? 0 : dispatch(res);
}

/** Resolve a name across all lists, then connect (used by `wssh connect <name>`). */
export async function quickConnectByName(name?: string, opts: ConnectOpts = {}): Promise<number> {
  if (!name) return quickConnect();

  const server = servers.findByName(name);
  if (server) return connectServer(server, opts);
  const tunnel = tunnels.findByName(name);
  if (tunnel) return connectTunnel(tunnel);

  // fuzzy fallback across servers (= config hosts) and tunnels
  const hits: ConnectItem[] = [
    ...filterEntities(servers.all(), name).map((e): ConnectItem => ({ kind: 'entity', entity: e })),
    ...filterEntities(tunnels.all(), name).map((e): ConnectItem => ({ kind: 'entity', entity: e })),
  ];
  if (hits.length === 0) {
    ui.printError(tr.connect.notFound(name));
    return 1;
  }
  if (hits.length === 1) return dispatch(hits[0]!, opts);

  ui.ensureInteractive(tr.connect.ensurePickConnect);
  const res = await ui.pickFromList<ConnectItem>({
    message: tr.connect.multipleMatches(name),
    items: hits,
    render: ui.connectRowRenderer(hits),
    search: ui.connectSearch,
    sorts: QC_SORTS,
  });
  return res === ui.BACK ? 0 : dispatch(res, opts);
}
