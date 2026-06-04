/** Server CRUD + connect flows. A server is a Host in ~/.ssh/config (its name is
 *  the alias); app-only extras live in the `#wssh {...}` comment. */

import type { Server, SortKey } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { vault } from '../vault/vault.js';
import { runInteractive } from '../ssh/runner.js';
import * as ui from '../ui/index.js';
import { detailBox, targetSummary } from '../ui/format.js';
import { renderEntityTable } from '../ui/tables.js';
import { isValidSshAlias } from '../utils/validators.js';
import { parseTags } from '../utils/strings.js';
import { askAnnotations, askServerConnection } from './wizard.js';
import {
  commitSecretChange,
  handlePasswordSecret,
  pickEntity,
  resolveEntity,
  resolvePassword,
  rollbackSecretChange,
} from './helpers.js';

/** Connect an interactive shell to a server. Returns the ssh exit code. */
export async function connectServer(
  server: Server,
  opts: { tmux?: string | boolean } = {},
): Promise<number> {
  console.log('\n' + detailBox(server));
  const password = await resolvePassword(server);
  servers.touch(server.id);
  return runInteractive(server, password, opts);
}

export async function connectServerFlow(
  name?: string,
  opts: { tmux?: string | boolean } = {},
): Promise<number> {
  const server = await resolveEntity(servers, name, '🖥 Выберите сервер');
  if (!server) return 0;
  return connectServer(server, opts);
}

export async function addServer(seed: Partial<Server> = {}): Promise<Server | null> {
  ui.ensureInteractive('Добавление сервера');
  ui.printSection('➕', 'Новый сервер (Host в ~/.ssh/config)');
  const alias = (
    await ui.text({
      message: '🔗 Имя сервера (= алиас в ~/.ssh/config)',
      default: seed.name,
      validate: (v) =>
        !isValidSshAlias(v.trim())
          ? 'Только буквы, цифры, точка, дефис, подчёркивание (без пробелов)'
          : servers.nameExists(v.trim())
            ? 'Такой хост уже есть в ~/.ssh/config'
            : true,
    })
  ).trim();
  const target = await askServerConnection(seed);
  const secretId = await handlePasswordSecret(target, null);
  try {
    const ann = await askAnnotations(seed);
    const server = servers.create({ name: alias, ...target, secretId, ...ann, kind: 'server' });
    ui.printOk(`Сервер «${server.name}» сохранён в ~/.ssh/config.`);
    console.log(detailBox(server));
    return server;
  } catch (e) {
    rollbackSecretChange(null, secretId); // abort after saving a password → no orphan blob
    throw e;
  }
}

export async function editServer(name?: string): Promise<void> {
  ui.ensureInteractive('Редактирование');
  const server = await resolveEntity(servers, name, '✏️ Выберите сервер');
  if (!server) return;
  if (!server.manageable) {
    ui.printWarn(
      `«${server.name}» задан мульти-алиасным блоком / Include / Match — авто-редактирование не поддерживается. Подключаться можно.`,
    );
    return;
  }

  let working: Server = { ...server };
  const originalSecretId = server.secretId;
  let dirty = false;

  for (;;) {
    ui.printSection('✏️', `Сервер: ${working.name}`);
    console.log(detailBox(working) + '\n');

    const field = await ui.choose<string>({
      message: dirty ? 'Что меняем? • есть несохранённые правки' : 'Что меняем?',
      choices: [
        { name: `Имя          ${working.name}`, value: 'name' },
        { name: `Описание     ${working.description || '—'}`, value: 'description' },
        { name: `Теги         ${working.tags.join(', ') || '—'}`, value: 'tags' },
        { name: 'Подключение / авторизация', value: 'connection' },
        { name: 'Сохранить и выйти', value: '__save__' },
        { name: 'Выйти без сохранения', value: '__cancel__' },
      ],
    });

    if (field === '__save__') {
      if (dirty) {
        servers.update(server.id, working);
        commitSecretChange(originalSecretId, working.secretId); // drop the replaced blob
        ui.printOk('Изменения сохранены в ~/.ssh/config.');
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
          message: 'Новый алиас',
          default: working.name,
          validate: (v) =>
            !isValidSshAlias(v.trim())
              ? 'Только буквы, цифры, точка, дефис, подчёркивание'
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
      const target = await askServerConnection(working);
      const prevPending = working.secretId;
      const secretId = await handlePasswordSecret(target, prevPending);
      // a repeated connection edit may have minted a blob earlier this session;
      // drop that superseded *pending* one (never the committed original).
      if (prevPending && prevPending !== originalSecretId && prevPending !== secretId)
        rollbackSecretChange(originalSecretId, prevPending);
      working = { ...working, ...target, secretId };
      dirty = true;
    }
  }
}

export async function removeServerFlow(name?: string): Promise<void> {
  ui.ensureInteractive('Удаление');
  if (name) {
    const server = await resolveEntity(servers, name, '🗑 Выберите сервер');
    if (!server) return;
    if (!server.manageable) {
      ui.printWarn(
        `«${server.name}» нельзя удалить автоматически (мульти-алиас / Include / Match).`,
      );
      return;
    }
    if (
      await ui.confirm({ message: `Удалить «${server.name}» из ~/.ssh/config?`, default: false })
    ) {
      removeServerById(server);
      ui.printOk(`«${server.name}» удалён.`);
    } else ui.printInfo('Отменено.');
    return;
  }
  const list = servers.sorted('name').filter((s) => s.manageable);
  if (!list.length) {
    ui.printWarn('Нет серверов, доступных для удаления.');
    return;
  }
  const ids = await ui.multiChoose<string>({
    message: 'Отметьте серверы для удаления (пробел — отметить, Enter — подтвердить)',
    choices: list.map((s) => ({ name: `${s.name} — ${targetSummary(s)}`, value: s.id })),
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
