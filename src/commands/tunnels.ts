/** Tunnel CRUD + connect flows. Mirrors servers.ts, with forward config. */

import type { SortKey, SshConfigHost, Tunnel } from '../core/types.js';
import type { EntityCollection } from '../store/collection.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { sessions } from '../store/sessions.store.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import * as sshConfig from '../ssh-config/index.js';
import { runTunnel, startTunnelDetached, preflight } from '../ssh/runner.js';
import { isWindows } from '../utils/platform.js';
import * as ui from '../ui/index.js';
import { detailBox, forwardSummary, targetSummary } from '../ui/format.js';
import { renderEntityTable, renderSessionsTable } from '../ui/tables.js';
import { isValidName } from '../utils/validators.js';
import { parseTags, slugify, tilde } from '../utils/strings.js';
import { askConnectionTarget, askForward, askMeta } from './wizard.js';
import {
  commitSecretChange,
  handlePasswordSecret,
  resolveEntity,
  resolvePassword,
  rollbackSecretChange,
} from './helpers.js';

/** Tunnels live in one of two collections: the main list or the temporary one. */
type TunnelStore = EntityCollection<Tunnel>;

const storeKind = (store: TunnelStore): 'main' | 'temp' =>
  store === tempTunnels ? 'temp' : 'main';

export async function connectTunnel(tunnel: Tunnel, store: TunnelStore = tunnels): Promise<number> {
  console.log('\n' + detailBox(tunnel));
  const password = await resolvePassword(tunnel);
  store.touch(tunnel.id);
  return runTunnel(tunnel, password, { autoReconnect: settings.get().tunnelAutoReconnect });
}

// ---------- background sessions ----------

/** Start a tunnel detached in the background and register the session. Only
 *  agent/key tunnels qualify (password tunnels need a foreground sshpass). */
export async function tunnelUpFlow(name?: string, store: TunnelStore = tunnels): Promise<number> {
  const tunnel = await resolveEntity(store, name, '🚇 Какой туннель поднять в фоне?');
  if (!tunnel) return 0;

  if (tunnel.auth === 'password') {
    ui.printError(
      'Фоновый режим не поддерживает парольную авторизацию (нужен интерактивный sshpass). ' +
        'Используйте ключ/agent или поднимите туннель на переднем плане.',
    );
    return 1;
  }
  const existing = sessions.find(tunnel.id);
  if (existing) {
    ui.printWarn(`«${tunnel.name}» уже запущен в фоне (pid ${existing.pid}).`);
    return 0;
  }
  const err = preflight(tunnel, {
    forwardPorts: { local: tunnel.localPort, remote: tunnel.remotePort, type: tunnel.type },
  });
  if (err) {
    ui.printError(err);
    return 1;
  }
  if (isWindows) ui.printWarn('Фоновые туннели на Windows работают нестабильно.');

  const { pid, logFile } = startTunnelDetached(tunnel);
  if (pid <= 0) {
    ui.printError('Не удалось запустить фоновый процесс.');
    return 1;
  }
  store.touch(tunnel.id);
  sessions.add({
    tunnelId: tunnel.id,
    name: tunnel.name,
    pid,
    store: storeKind(store),
    forward: forwardSummary(tunnel),
    target: targetSummary(tunnel),
    logFile,
  });
  ui.printOk(`Туннель «${tunnel.name}» поднят в фоне (pid ${pid}).`);
  ui.printInfo(`Лог: ${tilde(logFile)} · остановить: wssh tunnel down ${tunnel.name}`);
  return 0;
}

export function listSessions(opts: { json?: boolean } = {}): void {
  const live = sessions.list();
  if (opts.json) {
    console.log(JSON.stringify(live, null, 2));
    return;
  }
  if (!live.length) {
    ui.printWarn('Нет фоновых туннелей. Поднять: wssh tunnel start <имя>');
    return;
  }
  ui.printSection('🟢', `Фоновые туннели (${live.length})`);
  console.log(renderSessionsTable(live));
}

/** Stop a background tunnel (by name) or all of them. */
export async function tunnelDownFlow(name?: string, opts: { all?: boolean } = {}): Promise<number> {
  const live = sessions.list();
  if (!live.length) {
    ui.printWarn('Нет фоновых туннелей.');
    return 0;
  }
  let toStop = live;
  if (!opts.all) {
    const target = name
      ? live.find((s) => s.name.toLowerCase() === name.toLowerCase())
      : await (async () => {
          ui.ensureInteractive('Остановка туннеля');
          const picked = await ui.pickFromList({
            message: '🛑 Какой фоновый туннель остановить?',
            items: live,
            render: (s) => `${ui.chalk.bold(s.name)}  ${ui.chalk.dim(s.forward)}  pid ${s.pid}`,
            search: (s) => s.name,
            pageSize: 14,
          });
          return picked === ui.BACK ? null : picked;
        })();
    if (!target) {
      if (name) ui.printError(`Фоновый туннель «${name}» не найден.`);
      return name ? 1 : 0;
    }
    toStop = [target];
  } else if (!(await ui.confirm({ message: `Остановить все (${live.length})?`, default: false }))) {
    ui.printInfo('Отменено.');
    return 0;
  }

  let stopped = 0;
  for (const s of toStop) {
    try {
      process.kill(s.pid, 'SIGTERM');
      stopped++;
    } catch {
      /* already gone */
    }
    sessions.remove(s.tunnelId);
  }
  ui.printOk(`Остановлено: ${stopped}.`);
  return 0;
}

export async function connectTunnelFlow(
  name?: string,
  store: TunnelStore = tunnels,
): Promise<number> {
  const tunnel = await resolveEntity(store, name, '🚇 Выберите туннель');
  if (!tunnel) return 0;
  return connectTunnel(tunnel, store);
}

/** #9 — pick a ~/.ssh/config host, define the forward, save and raise it now. */
export async function createAndRaiseTunnel(): Promise<number> {
  ui.ensureInteractive('Быстрый туннель');
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn('В ~/.ssh/config нет хостов.');
    return 0;
  }
  const host = await ui.pickFromList<SshConfigHost>({
    message: 'Хост из ~/.ssh/config для туннеля',
    items: hosts,
    render: ui.configRowRenderer(hosts),
    search: ui.configSearch,
    sorts: ui.CONFIG_SORTS,
    pageSize: 14,
  });
  if (host === ui.BACK) return 0;

  const fwd = await askForward({});
  const meta = await askMeta(
    {},
    (n) => tunnels.nameExists(n),
    slugify(`${host.alias}-${fwd.localPort}`),
  );
  const tunnel = tunnels.create({
    hostMode: 'sshconfig',
    sshHost: host.alias,
    host: '',
    user: '',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    ...fwd,
    ...meta,
    kind: 'tunnel',
  });
  ui.printOk(`Туннель «${tunnel.name}» создан.`);
  return connectTunnel(tunnel);
}

/** Create + raise a tunnel to ANY host — including one not in ~/.ssh/config.
 *  Saved to its OWN list (temp-tunnels.json), kept apart from the main tunnels. */
export async function raiseTemporaryTunnel(): Promise<number> {
  ui.ensureInteractive('Временный туннель');
  ui.printSection('🚇', 'Временный туннель (на любой хост)');
  const target = await askConnectionTarget({});
  const secretId = await handlePasswordSecret(target, null);
  try {
    const fwd = await askForward({});
    const suggested = slugify(
      `${target.hostMode === 'sshconfig' ? target.sshHost : target.host}-${fwd.localPort}`,
    );
    const meta = await askMeta({}, (n) => tempTunnels.nameExists(n), suggested);
    const tunnel = tempTunnels.create({ ...target, secretId, ...fwd, ...meta, kind: 'tunnel' });
    ui.printOk(`Временный туннель «${tunnel.name}» сохранён (отдельный список).`);
    return connectTunnel(tunnel, tempTunnels);
  } catch (e) {
    rollbackSecretChange(null, secretId); // abort after saving a password → no orphan blob
    throw e;
  }
}

export async function addTunnel(seed: Partial<Tunnel> = {}): Promise<Tunnel | null> {
  ui.ensureInteractive('Добавление туннеля');
  ui.printSection('➕', 'Новый туннель');
  const target = await askConnectionTarget(seed);
  const secretId = await handlePasswordSecret(target, null);
  try {
    const fwd = await askForward(seed);
    const suggested = slugify(
      seed.name || (target.hostMode === 'sshconfig' ? target.sshHost : target.host),
    );
    const meta = await askMeta(seed, (n) => tunnels.nameExists(n), suggested);
    const tunnel = tunnels.create({ ...target, secretId, ...fwd, ...meta, kind: 'tunnel' });
    ui.printOk(`Туннель «${tunnel.name}» сохранён.`);
    console.log(detailBox(tunnel));
    return tunnel;
  } catch (e) {
    rollbackSecretChange(null, secretId); // abort after saving a password → no orphan blob
    throw e;
  }
}

export async function editTunnel(name?: string, store: TunnelStore = tunnels): Promise<void> {
  ui.ensureInteractive('Редактирование');
  const tunnel = await resolveEntity(store, name, '✏️ Выберите туннель');
  if (!tunnel) return;

  let working: Tunnel = { ...tunnel };
  const originalSecretId = tunnel.secretId;
  let dirty = false;

  for (;;) {
    ui.printSection('✏️', `Туннель: ${working.name}`);
    console.log(detailBox(working) + '\n');

    const choices = [
      { name: `Имя          ${working.name}`, value: 'name' },
      { name: `Описание     ${working.description || '—'}`, value: 'description' },
      { name: `Теги         ${working.tags.join(', ') || '—'}`, value: 'tags' },
      { name: 'Подключение / авторизация', value: 'connection' },
      { name: `Проброс      ${forwardSummary(working)}`, value: 'forward' },
      ...(working.type === 'local'
        ? [{ name: `Авто-браузер ${working.openBrowser ? 'вкл' : 'выкл'}`, value: 'browser' }]
        : []),
      { name: 'Сохранить и выйти', value: '__save__' },
      { name: 'Выйти без сохранения', value: '__cancel__' },
    ];
    const field = await ui.choose<string>({
      message: dirty ? 'Что меняем? • есть несохранённые правки' : 'Что меняем?',
      choices,
    });

    if (field === '__save__') {
      if (dirty) {
        store.update(tunnel.id, working);
        commitSecretChange(originalSecretId, working.secretId); // drop the replaced blob
        ui.printOk('Изменения сохранены.');
      } else ui.printInfo('Изменений не было.');
      return;
    }
    if (field === '__cancel__') {
      if (dirty && !(await ui.confirm({ message: 'Выйти без сохранения?', default: false })))
        continue;
      rollbackSecretChange(originalSecretId, working.secretId); // discard any pending blob
      ui.printInfo('Отменено.');
      return;
    }
    if (field === 'name') {
      working.name = (
        await ui.text({
          message: 'Новое имя',
          default: working.name,
          validate: (v) =>
            !isValidName(v.trim())
              ? 'Некорректное имя'
              : store.nameExists(v.trim(), tunnel.id)
                ? 'Имя занято'
                : true,
        })
      ).trim();
      dirty = true;
    } else if (field === 'description') {
      working.description = await ui.text({ message: 'Описание', default: working.description });
      dirty = true;
    } else if (field === 'tags') {
      working.tags = parseTags(
        await ui.text({ message: 'Теги через запятую', default: working.tags.join(', ') }),
      );
      dirty = true;
    } else if (field === 'connection') {
      const target = await askConnectionTarget(working);
      const prevPending = working.secretId;
      const secretId = await handlePasswordSecret(target, prevPending);
      // drop a superseded *pending* blob from an earlier edit this session.
      if (prevPending && prevPending !== originalSecretId && prevPending !== secretId)
        rollbackSecretChange(originalSecretId, prevPending);
      working = { ...working, ...target, secretId };
      dirty = true;
    } else if (field === 'forward') {
      const fwd = await askForward(working);
      working = { ...working, ...fwd };
      dirty = true;
    } else if (field === 'browser') {
      working.openBrowser = !working.openBrowser;
      dirty = true;
    }
  }
}

export async function removeTunnelFlow(name?: string, store: TunnelStore = tunnels): Promise<void> {
  ui.ensureInteractive('Удаление');
  if (name) {
    const tunnel = await resolveEntity(store, name, '🗑 Выберите туннель');
    if (!tunnel) return;
    if (await ui.confirm({ message: `Удалить «${tunnel.name}»?`, default: false })) {
      removeTunnelById(tunnel, store);
      ui.printOk(`«${tunnel.name}» удалён.`);
    } else ui.printInfo('Отменено.');
    return;
  }
  const list = store.sorted('name');
  if (!list.length) {
    ui.printWarn('Список туннелей пуст.');
    return;
  }
  const ids = await ui.multiChoose<string>({
    message: 'Отметьте туннели для удаления (пробел — отметить, Enter — подтвердить)',
    choices: list.map((t) => ({ name: `${t.name} — ${forwardSummary(t)}`, value: t.id })),
  });
  if (!ids.length) {
    ui.printInfo('Ничего не выбрано.');
    return;
  }
  if (await ui.confirm({ message: `Удалить ${ids.length}?`, default: false })) {
    ids.forEach((id) => {
      const t = store.findById(id);
      if (t) removeTunnelById(t, store);
    });
    ui.printOk(`Удалено: ${ids.length}.`);
  } else ui.printInfo('Отменено.');
}

function removeTunnelById(tunnel: Tunnel, store: TunnelStore): void {
  if (tunnel.secretId) vault.removeSecret(tunnel.secretId);
  store.remove(tunnel.id);
}

export function listTunnels(opts: { sort?: SortKey; reverse?: boolean; json?: boolean }): Tunnel[] {
  const sortKey = opts.sort ?? 'recent';
  const list = tunnels.sorted(sortKey, opts.reverse);
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return list;
  }
  if (!list.length) {
    ui.printWarn('Туннелей пока нет. Добавьте: wssh tunnel add');
    return list;
  }
  ui.printSection(
    '🚇',
    `Туннели (${list.length}) · сортировка: ${sortKey}${opts.reverse ? ' ↑' : ' ↓'}`,
  );
  console.log(renderEntityTable(list));
  return list;
}
