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
import { tr } from '../i18n/index.js';

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
  const server = await resolveEntity(servers, name, tr.servers.selectServer);
  if (!server) return 0;
  return connectServer(server, opts);
}

export async function addServer(seed: Partial<Server> = {}): Promise<Server | null> {
  ui.ensureInteractive(tr.servers.addEnsure);
  ui.printSection('➕', tr.servers.addSection);
  const alias = (
    await ui.text({
      message: tr.servers.namePrompt,
      default: seed.name,
      validate: (v) =>
        !isValidSshAlias(v.trim())
          ? tr.servers.nameInvalid
          : servers.nameExists(v.trim())
            ? tr.servers.nameExists
            : true,
    })
  ).trim();
  const target = await askServerConnection(seed);
  const secretId = await handlePasswordSecret(target, null);
  try {
    const ann = await askAnnotations(seed);
    const server = servers.create({ name: alias, ...target, secretId, ...ann, kind: 'server' });
    ui.printOk(tr.servers.serverSaved(server.name));
    console.log(detailBox(server));
    return server;
  } catch (e) {
    rollbackSecretChange(null, secretId); // abort after saving a password → no orphan blob
    throw e;
  }
}

export async function editServer(name?: string): Promise<void> {
  ui.ensureInteractive(tr.servers.editEnsure);
  const server = await resolveEntity(servers, name, tr.servers.editSelectServer);
  if (!server) return;
  if (!server.manageable) {
    ui.printWarn(tr.servers.editNotManageable(server.name));
    return;
  }

  let working: Server = { ...server };
  const originalSecretId = server.secretId;
  let dirty = false;

  for (;;) {
    ui.printSection('✏️', tr.servers.editSection(working.name));
    console.log(detailBox(working) + '\n');

    const field = await ui.choose<string>({
      message: dirty ? tr.servers.editWhatDirty : tr.servers.editWhat,
      choices: [
        { name: tr.servers.fieldName(working.name), value: 'name' },
        {
          name: tr.servers.fieldDescription(working.description || tr.common.dash),
          value: 'description',
        },
        { name: tr.servers.fieldTags(working.tags.join(', ') || tr.common.dash), value: 'tags' },
        { name: tr.servers.fieldConnection, value: 'connection' },
        { name: tr.servers.actionSave, value: '__save__' },
        { name: tr.servers.actionCancel, value: '__cancel__' },
      ],
    });

    if (field === '__save__') {
      if (dirty) {
        servers.update(server.id, working);
        commitSecretChange(originalSecretId, working.secretId); // drop the replaced blob
        ui.printOk(tr.servers.changesSaved);
      } else ui.printInfo(tr.servers.noChanges);
      return;
    }
    if (field === '__cancel__') {
      if (dirty && !(await ui.confirm({ message: tr.servers.confirmExitUnsaved, default: false })))
        continue;
      rollbackSecretChange(originalSecretId, working.secretId); // discard any pending blob
      ui.printInfo(tr.common.cancelled);
      return;
    }
    if (field === 'name') {
      working.name = (
        await ui.text({
          message: tr.servers.newAlias,
          default: working.name,
          validate: (v) =>
            !isValidSshAlias(v.trim())
              ? tr.servers.aliasInvalid
              : servers.nameExists(v.trim(), server.id)
                ? tr.servers.aliasTaken
                : true,
        })
      ).trim();
      dirty = true;
    } else if (field === 'description') {
      working.description = await ui.text({
        message: tr.servers.descriptionPrompt,
        default: working.description,
      });
      dirty = true;
    } else if (field === 'tags') {
      working.tags = parseTags(
        await ui.text({ message: tr.servers.tagsPrompt, default: working.tags.join(', ') }),
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
  ui.ensureInteractive(tr.servers.removeEnsure);
  if (name) {
    const server = await resolveEntity(servers, name, tr.servers.removeSelectServer);
    if (!server) return;
    if (!server.manageable) {
      ui.printWarn(tr.servers.removeNotManageable(server.name));
      return;
    }
    if (await ui.confirm({ message: tr.servers.confirmRemoveOne(server.name), default: false })) {
      removeServerById(server);
      ui.printOk(tr.servers.serverRemoved(server.name));
    } else ui.printInfo(tr.common.cancelled);
    return;
  }
  const list = servers.sorted('name').filter((s) => s.manageable);
  if (!list.length) {
    ui.printWarn(tr.servers.noRemovable);
    return;
  }
  const ids = await ui.multiChoose<string>({
    message: tr.servers.removeMultiPrompt,
    choices: list.map((s) => ({ name: `${s.name} — ${targetSummary(s)}`, value: s.id })),
  });
  if (!ids.length) {
    ui.printInfo(tr.servers.noneSelected);
    return;
  }
  if (await ui.confirm({ message: tr.servers.confirmRemoveMany(ids.length), default: false })) {
    ids.forEach((id) => {
      const s = servers.findById(id);
      if (s) removeServerById(s);
    });
    ui.printOk(tr.servers.removedMany(ids.length));
  } else ui.printInfo(tr.common.cancelled);
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
    ui.printWarn(tr.servers.emptyList);
    return list;
  }
  ui.printSection('🖥', tr.servers.listSection(list.length, sortKey, opts.reverse ? ' ↑' : ' ↓'));
  console.log(renderEntityTable(list));
  return list;
}

export { pickEntity };
