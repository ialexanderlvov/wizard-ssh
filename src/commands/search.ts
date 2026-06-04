/** Unified search across servers (= ~/.ssh/config hosts) and tunnels, with
 *  quick-connect. */

import type { Server, Tunnel } from '../core/types.js';
import { tr } from '../i18n/index.js';
import { searchEverything } from '../search/index.js';
import * as ui from '../ui/index.js';
import { renderEntityTable } from '../ui/tables.js';
import { connectServer } from './servers.js';
import { connectTunnel } from './tunnels.js';

export async function searchFlow(query?: string, opts: { json?: boolean } = {}): Promise<void> {
  let q = query;
  if (!q) {
    if (opts.json) {
      ui.printError(tr.search.jsonNeedsQuery);
      process.exitCode = 1;
      return;
    }
    ui.ensureInteractive(tr.search.ensureLabel);
    q = await ui.text({ message: tr.search.prompt });
  }
  if (!q.trim()) return;

  const res = searchEverything(q.trim());
  if (opts.json) {
    console.log(JSON.stringify({ servers: res.servers, tunnels: res.tunnels }, null, 2));
    return;
  }
  if (!res.total) {
    ui.printWarn(tr.search.notFound(q.trim()));
    return;
  }

  if (res.servers.length) {
    ui.printSection('🖥', tr.search.serversSection(res.servers.length));
    console.log(renderEntityTable(res.servers));
  }
  if (res.tunnels.length) {
    ui.printSection('🚇', tr.search.tunnelsSection(res.tunnels.length));
    console.log(renderEntityTable(res.tunnels));
  }

  if (!ui.isInteractive()) return;

  const items: ui.ConnectItem[] = [
    ...res.servers.map((e): ui.ConnectItem => ({ kind: 'entity', entity: e })),
    ...res.tunnels.map((e): ui.ConnectItem => ({ kind: 'entity', entity: e })),
  ];
  const picked = await ui.pickFromList<ui.ConnectItem>({
    message: tr.search.connectPrompt,
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
