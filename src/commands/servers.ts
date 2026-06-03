/** Server CRUD + connect flows. Reused by commander and the interactive menu. */

import type { Server, SortKey } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { vault } from '../vault/vault.js';
import * as sshConfig from '../ssh-config/index.js';
import { runInteractive } from '../ssh/runner.js';
import * as ui from '../ui/index.js';
import { detailBox } from '../ui/format.js';
import { renderEntityTable } from '../ui/tables.js';
import { isValidName, isValidSshAlias } from '../utils/validators.js';
import { parseTags, slugify, tilde } from '../utils/strings.js';
import { askConnectionTarget, askMeta } from './wizard.js';
import { handlePasswordSecret, pickEntity, resolveEntity, resolvePassword } from './helpers.js';

/** Connect an interactive shell to a server. Returns the ssh exit code. */
export async function connectServer(server: Server): Promise<number> {
  console.log('\n' + detailBox(server));
  const password = await resolvePassword(server);
  servers.touch(server.id);
  return runInteractive(server, password);
}

export async function connectServerFlow(name?: string): Promise<number> {
  const server = await resolveEntity(servers, name, '🖥 Выберите сервер');
  if (!server) return 0;
  return connectServer(server);
}

/** Offer to mirror a manual server into ~/.ssh/config. */
async function offerLink(server: Server): Promise<void> {
  if (server.hostMode === 'sshconfig') return;
  const link = await ui.confirm({
    message: '🔗 Записать этот сервер в ~/.ssh/config?',
    default: false,
  });
  if (!link) return;
  const alias = (
    await ui.text({
      message: '🔗 Алиас в ~/.ssh/config',
      default: slugify(server.name),
      validate: (v) => isValidSshAlias(v) || 'Только буквы, цифры, . _ -',
    })
  ).trim();
  const params = [
    { key: 'HostName', value: server.host },
    { key: 'User', value: server.user },
    ...(server.sshPort && server.sshPort !== 22
      ? [{ key: 'Port', value: String(server.sshPort) }]
      : []),
    ...(server.auth === 'key' && server.keyPath
      ? [{ key: 'IdentityFile', value: tilde(server.keyPath) }]
      : []),
  ];
  const { backup, created } = sshConfig.upsertHost({ alias, params });
  servers.update(server.id, { linkedSshHost: alias });
  ui.printOk(`${created ? 'Добавлено' : 'Обновлено'} в ~/.ssh/config: ${alias}.`);
  if (backup) ui.printInfo(`Бэкап конфига: ${backup}`);
}

export async function addServer(seed: Partial<Server> = {}): Promise<Server | null> {
  ui.ensureInteractive('Добавление сервера');
  ui.printSection('➕', 'Новый сервер');
  const target = await askConnectionTarget(seed);
  const secretId = await handlePasswordSecret(target, null);
  const suggested = slugify(
    seed.name || (target.hostMode === 'sshconfig' ? target.sshHost : target.host),
  );
  const meta = await askMeta(seed, (n) => servers.nameExists(n), suggested);
  const server = servers.create({
    ...target,
    secretId,
    ...meta,
    kind: 'server',
    linkedSshHost: null,
  });
  ui.printOk(`Сервер «${server.name}» сохранён.`);
  await offerLink(servers.findById(server.id) as Server);
  console.log(detailBox(servers.findById(server.id) as Server));
  return server;
}

export async function editServer(name?: string): Promise<void> {
  ui.ensureInteractive('Редактирование');
  const server = await resolveEntity(servers, name, '✏️ Выберите сервер');
  if (!server) return;

  let working: Server = { ...server };
  let dirty = false;

  for (;;) {
    ui.printSection('✏️', `Сервер: ${working.name}`);
    console.log(detailBox(working) + '\n');

    const field = await ui.choose<string>({
      message: dirty ? 'Что меняем? • есть несохранённые правки' : 'Что меняем?',
      choices: [
        { name: `🏷 Имя          ${working.name}`, value: 'name' },
        { name: `📝 Описание     ${working.description || '—'}`, value: 'description' },
        { name: `#️⃣ Теги         ${working.tags.join(', ') || '—'}`, value: 'tags' },
        { name: '🌐 Подключение / авторизация', value: 'connection' },
        { name: '🔗 Запись в ~/.ssh/config', value: 'link' },
        { name: '💾 Сохранить и выйти', value: '__save__' },
        { name: '↩ Выйти без сохранения', value: '__cancel__' },
      ],
    });

    if (field === '__save__') {
      if (dirty) {
        servers.update(server.id, working);
        ui.printOk('Изменения сохранены.');
      } else ui.printInfo('Изменений не было.');
      return;
    }
    if (field === '__cancel__') {
      if (dirty && !(await ui.confirm({ message: 'Выйти без сохранения?', default: false })))
        continue;
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
              : servers.nameExists(v.trim(), server.id)
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
      const secretId = await handlePasswordSecret(target, working.secretId);
      working = { ...working, ...target, secretId };
      dirty = true;
    } else if (field === 'link') {
      await offerLink(working);
      working = servers.findById(server.id) as Server;
    }
  }
}

export async function removeServerFlow(name?: string): Promise<void> {
  ui.ensureInteractive('Удаление');
  if (name) {
    const server = await resolveEntity(servers, name, '🗑 Выберите сервер');
    if (!server) return;
    if (await ui.confirm({ message: `Удалить «${server.name}»?`, default: false })) {
      removeServerById(server);
      ui.printOk(`«${server.name}» удалён.`);
    } else ui.printInfo('Отменено.');
    return;
  }
  const list = servers.sorted('name');
  if (!list.length) {
    ui.printWarn('Список серверов пуст.');
    return;
  }
  const ids = await ui.multiChoose<string>({
    message: 'Отметьте серверы для удаления (пробел — отметить, Enter — подтвердить)',
    choices: list.map((s) => ({
      name: `${s.name} — ${s.hostMode === 'sshconfig' ? '@' + s.sshHost : s.user + '@' + s.host}`,
      value: s.id,
    })),
  });
  if (!ids.length) {
    ui.printInfo('Ничего не выбрано.');
    return;
  }
  if (await ui.confirm({ message: `Удалить ${ids.length}?`, default: false })) {
    ids.forEach((id) => {
      const s = servers.findById(id);
      if (s) removeServerById(s);
    });
    ui.printOk(`Удалено: ${ids.length}.`);
  } else ui.printInfo('Отменено.');
}

function removeServerById(server: Server): void {
  // best-effort secret cleanup (deleting a blob needs no unlock)
  if (server.secretId) vault.removeSecret(server.secretId);
  servers.remove(server.id);
}

export function listServers(opts: { sort?: SortKey; reverse?: boolean; json?: boolean }): Server[] {
  const sortKey = opts.sort ?? 'recent';
  const list = servers.sorted(sortKey, opts.reverse);
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return list;
  }
  if (!list.length) {
    ui.printWarn('Серверов пока нет. Добавьте: ' + 'wssh server add');
    return list;
  }
  ui.printSection(
    '🖥',
    `Серверы (${list.length}) · сортировка: ${sortKey}${opts.reverse ? ' ↑' : ' ↓'}`,
  );
  console.log(renderEntityTable(list));
  return list;
}

export { pickEntity };
