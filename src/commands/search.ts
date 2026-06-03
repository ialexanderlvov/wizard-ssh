/** Unified search across servers (= ~/.ssh/config hosts) and tunnels, with
 *  quick-connect. */

import type { Server, Tunnel } from '../core/types.js';
import { searchEverything } from '../search/index.js';
import * as ui from '../ui/index.js';
import { renderEntityTable } from '../ui/tables.js';
import { connectServer } from './servers.js';
import { connectTunnel } from './tunnels.js';

export async function searchFlow(query?: string): Promise<void> {
  let q = query;
  if (!q) {
    ui.ensureInteractive('Поиск');
    q = await ui.text({ message: 'Поиск по серверам и туннелям' });
  }
  if (!q.trim()) return;

  const res = searchEverything(q.trim());
  if (!res.total) {
    ui.printWarn(`Ничего не найдено по «${q.trim()}».`);
    return;
  }

  if (res.servers.length) {
    ui.printSection('🖥', `Серверы (${res.servers.length})`);
    console.log(renderEntityTable(res.servers));
  }
  if (res.tunnels.length) {
    ui.printSection('🚇', `Туннели (${res.tunnels.length})`);
    console.log(renderEntityTable(res.tunnels));
  }

  if (!ui.isInteractive()) return;

  const items: ui.ConnectItem[] = [
    ...res.servers.map((e): ui.ConnectItem => ({ kind: 'entity', entity: e })),
    ...res.tunnels.map((e): ui.ConnectItem => ({ kind: 'entity', entity: e })),
  ];
  const picked = await ui.pickFromList<ui.ConnectItem>({
    message: 'Подключиться (Esc — просто посмотреть)',
    items,
    render: ui.connectRowRenderer(items),
    search: ui.connectSearch,
    pageSize: 15,
  });
  if (picked === ui.BACK) return;
  if (picked.kind === 'config') return; // not produced any more
  if (picked.entity.kind === 'tunnel') {
    await connectTunnel(picked.entity as Tunnel);
  } else {
    await connectServer(picked.entity as Server);
  }
}
