/** Unified quick-connect: pick (or name-resolve) across servers, tunnels and
 *  ~/.ssh/config aliases, then connect appropriately. */

import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { filterConfigHosts, filterEntities } from '../search/index.js';
import * as sshConfig from '../ssh-config/index.js';
import * as ui from '../ui/index.js';
import { configHostLine, entityLine } from '../ui/format.js';
import { connectServer } from './servers.js';
import { connectTunnel } from './tunnels.js';
import { connectConfigHostFlow } from './config.js';

/** Interactive fuzzy picker across everything, then connect. */
export async function quickConnect(): Promise<number> {
  const allServers = servers.sorted('recent');
  const allTunnels = tunnels.sorted('recent');
  const hosts = sshConfig.listHosts();
  if (!allServers.length && !allTunnels.length && !hosts.length) {
    ui.printWarn(
      'Пока ничего нет. Добавьте сервер или туннель (wssh server add / wssh tunnel add).',
    );
    return 0;
  }
  ui.ensureInteractive('Быстрое подключение');
  const pick = await ui.searchChoose<string>({
    message: '🔌 К чему подключаемся (печатай для поиска)',
    source: (term) => [
      ...filterEntities(allServers, term).map((s) => ({ name: entityLine(s), value: `s:${s.id}` })),
      ...filterEntities(allTunnels, term).map((t) => ({ name: entityLine(t), value: `t:${t.id}` })),
      ...filterConfigHosts(hosts, term).map((h) => ({
        name: '🗂  ' + configHostLine(h),
        value: `c:${h.alias}`,
      })),
    ],
  });
  return dispatch(pick);
}

async function dispatch(tagged: string): Promise<number> {
  const kind = tagged.slice(0, 1);
  const ref = tagged.slice(2);
  if (kind === 's') {
    const s = servers.findById(ref);
    if (s) return connectServer(s);
  } else if (kind === 't') {
    const t = tunnels.findById(ref);
    if (t) return connectTunnel(t);
  } else if (kind === 'c') {
    return connectConfigHostFlow(ref);
  }
  return 0;
}

/** Resolve a name across all lists, then connect (used by `wssh connect <name>`). */
export async function quickConnectByName(name?: string): Promise<number> {
  if (!name) return quickConnect();

  const server = servers.findByName(name);
  if (server) return connectServer(server);
  const tunnel = tunnels.findByName(name);
  if (tunnel) return connectTunnel(tunnel);
  const host = sshConfig.getHost(name);
  if (host) return connectConfigHostFlow(host.alias);

  // fuzzy fallback
  const s = filterEntities(servers.all(), name);
  const t = filterEntities(tunnels.all(), name);
  const c = filterConfigHosts(sshConfig.listHosts(), name);
  const total = s.length + t.length + c.length;
  if (total === 1) {
    if (s[0]) return connectServer(s[0]);
    if (t[0]) return connectTunnel(t[0]);
    if (c[0]) return connectConfigHostFlow(c[0].alias);
  }
  if (total === 0) {
    ui.printError(`«${name}» не найдено среди серверов, туннелей и ~/.ssh/config.`);
    return 1;
  }
  // several matches → interactive picker over the matches
  ui.ensureInteractive('Выбор подключения');
  const pick = await ui.choose<string>({
    message: `Несколько совпадений по «${name}»`,
    choices: [
      ...s.map((x) => ({ name: entityLine(x), value: `s:${x.id}` })),
      ...t.map((x) => ({ name: entityLine(x), value: `t:${x.id}` })),
      ...c.map((x) => ({ name: '🗂  ' + configHostLine(x), value: `c:${x.alias}` })),
    ],
  });
  return dispatch(pick);
}
