/** Unified search across servers, tunnels and ~/.ssh/config, with quick-connect. */

import { searchEverything } from '../search/index.js';
import * as ui from '../ui/index.js';
import { configHostLine, entityLine } from '../ui/format.js';
import { renderConfigHostsTable, renderEntityTable } from '../ui/tables.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { connectServer } from './servers.js';
import { connectTunnel } from './tunnels.js';
import { connectConfigHostFlow } from './config.js';

export async function searchFlow(query?: string): Promise<void> {
  let q = query;
  if (!q) {
    ui.ensureInteractive('Поиск');
    q = await ui.text({ message: '🔍 Поиск по серверам, туннелям и ~/.ssh/config' });
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
  if (res.configHosts.length) {
    ui.printSection('🗂', `~/.ssh/config (${res.configHosts.length})`);
    console.log(renderConfigHostsTable(res.configHosts));
  }

  if (!ui.isInteractive()) return;
  if (
    !(await ui.confirm({
      message: 'Подключиться к одному из найденных?',
      default: res.total === 1,
    }))
  )
    return;

  const choices = [
    ...res.servers.map((s) => ({ name: entityLine(s), value: `s:${s.id}` })),
    ...res.tunnels.map((t) => ({ name: entityLine(t), value: `t:${t.id}` })),
    ...res.configHosts.map((h) => ({ name: '🗂  ' + configHostLine(h), value: `c:${h.alias}` })),
  ];
  const pick = await ui.choose<string>({ message: 'Куда подключаемся', choices, pageSize: 15 });
  const [kind, ref] = [pick.slice(0, 1), pick.slice(2)];
  if (kind === 's') {
    const s = servers.findById(ref);
    if (s) await connectServer(s);
  } else if (kind === 't') {
    const t = tunnels.findById(ref);
    if (t) await connectTunnel(t);
  } else if (kind === 'c') {
    await connectConfigHostFlow(ref);
  }
}
