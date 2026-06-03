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

type ConnectItem = ui.ConnectItem;

const nameOf = (i: ConnectItem): string => (i.kind === 'entity' ? i.entity.name : i.host.alias);
const recentOf = (i: ConnectItem): number => (i.kind === 'entity' ? ts(i.entity.lastUsedAt) : 0);

const QC_SORTS: ReadonlyArray<ui.ListSort<ConnectItem>> = [
  {
    label: 'недавние',
    compare: (a, b) => recentOf(b) - recentOf(a) || nameOf(a).localeCompare(nameOf(b)),
  },
  { label: 'имя', compare: (a, b) => nameOf(a).localeCompare(nameOf(b)) },
];

function allConnectItems(): ConnectItem[] {
  // Servers ARE ~/.ssh/config hosts, so this single list already covers config.
  return [
    ...servers.sorted('recent').map((e): ConnectItem => ({ kind: 'entity', entity: e })),
    ...tunnels.sorted('recent').map((e): ConnectItem => ({ kind: 'entity', entity: e })),
  ];
}

async function dispatch(i: ConnectItem): Promise<number> {
  if (i.kind === 'config') return connectServer(servers.findById(i.host.alias) as Server);
  const e = i.entity;
  return e.kind === 'tunnel' ? connectTunnel(e as Tunnel) : connectServer(e as Server);
}

/** Interactive picker across everything, then connect. */
export async function quickConnect(): Promise<number> {
  const items = allConnectItems();
  if (!items.length) {
    ui.printWarn('Пока ничего нет. Добавьте сервер или туннель.');
    return 0;
  }
  ui.ensureInteractive('Быстрое подключение');
  const res = await ui.pickFromList<ConnectItem>({
    message: 'К чему подключаемся',
    items,
    render: ui.connectRowRenderer(items),
    search: ui.connectSearch,
    sorts: QC_SORTS,
    pageSize: 14,
  });
  return res === ui.BACK ? 0 : dispatch(res);
}

/** Resolve a name across all lists, then connect (used by `wssh connect <name>`). */
export async function quickConnectByName(name?: string): Promise<number> {
  if (!name) return quickConnect();

  const server = servers.findByName(name);
  if (server) return connectServer(server);
  const tunnel = tunnels.findByName(name);
  if (tunnel) return connectTunnel(tunnel);

  // fuzzy fallback across servers (= config hosts) and tunnels
  const hits: ConnectItem[] = [
    ...filterEntities(servers.all(), name).map((e): ConnectItem => ({ kind: 'entity', entity: e })),
    ...filterEntities(tunnels.all(), name).map((e): ConnectItem => ({ kind: 'entity', entity: e })),
  ];
  if (hits.length === 0) {
    ui.printError(`«${name}» не найдено среди серверов и туннелей.`);
    return 1;
  }
  if (hits.length === 1) return dispatch(hits[0]!);

  ui.ensureInteractive('Выбор подключения');
  const res = await ui.pickFromList<ConnectItem>({
    message: `Несколько совпадений по «${name}»`,
    items: hits,
    render: ui.connectRowRenderer(hits),
    search: ui.connectSearch,
    sorts: QC_SORTS,
  });
  return res === ui.BACK ? 0 : dispatch(res);
}
