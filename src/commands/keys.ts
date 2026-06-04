/** SSH key management: list / inspect / generate / copy public key / install on
 *  a server / delete. Deleting a key first reports who references it (servers and
 *  tunnels whose IdentityFile / key path points at it) so nothing breaks silently. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PromptAbortError } from '../core/errors.js';
import type { Entity, Server } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import {
  type KeyInfo,
  type KeyType,
  listKeys,
  generateKey,
  deleteKey,
  defaultKeyComment,
  publicKeyText,
  keyFingerprint,
  pubPathFor,
  isSkKeyType,
} from '../ssh/keys.js';
import { copyId } from '../ssh/features.js';
import { commandExists } from '../utils/exec.js';
import { copyToClipboard } from '../utils/platform.js';
import { expandHome, tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { renderKeysTable } from '../ui/tables.js';
import { targetSummary } from '../ui/format.js';
import { resolveEntity, resolvePassword } from './helpers.js';

export interface KeyReference {
  kind: 'сервер' | 'туннель' | 'врем. туннель';
  name: string;
}

/** Every saved server/tunnel whose key path points at `keyPath`. */
export function keyReferences(keyPath: string): KeyReference[] {
  const target = expandHome(keyPath);
  const refs: KeyReference[] = [];
  const match = (e: Entity): boolean => Boolean(e.keyPath && expandHome(e.keyPath) === target);
  for (const s of servers.all()) if (match(s)) refs.push({ kind: 'сервер', name: s.name });
  for (const t of tunnels.all()) if (match(t)) refs.push({ kind: 'туннель', name: t.name });
  for (const t of tempTunnels.all())
    if (match(t)) refs.push({ kind: 'врем. туннель', name: t.name });
  return refs;
}

export function listKeysCommand(opts: { json?: boolean } = {}): KeyInfo[] {
  const keys = listKeys();
  if (opts.json) {
    console.log(
      JSON.stringify(
        keys.map((k) => ({ ...k, references: keyReferences(k.path).length })),
        null,
        2,
      ),
    );
    return keys;
  }
  if (!commandExists('ssh-keygen')) ui.printWarn('ssh-keygen не найден — отпечатки недоступны.');
  if (!keys.length) {
    ui.printWarn('В ~/.ssh не найдено приватных ключей. Создайте: wssh keys gen');
    return keys;
  }
  ui.printSection('🗝', `SSH-ключи (${keys.length})`);
  console.log(renderKeysTable(keys));
  return keys;
}

function showPublicKey(key: KeyInfo): void {
  const text = publicKeyText(key.path);
  if (!text) {
    ui.printWarn(`Публичный ключ не найден: ${tilde(key.pubPath)}`);
    return;
  }
  ui.printSection('📄', `Публичный ключ — ${tilde(key.path)}`);
  console.log(ui.chalk.green(text));
}

function copyPublicKey(key: KeyInfo): void {
  const text = publicKeyText(key.path);
  if (!text) {
    ui.printWarn(`Публичный ключ не найден: ${tilde(key.pubPath)}`);
    return;
  }
  const tool = copyToClipboard(text);
  if (tool) ui.printOk(`Публичный ключ скопирован в буфер обмена (${tool}).`);
  else {
    ui.printWarn('Не нашёл утилиту буфера обмена. Вот ключ:');
    console.log(ui.chalk.green(text));
  }
}

/** Install a specific key on a chosen server via ssh-copy-id. */
async function installKeyOnServer(key: KeyInfo): Promise<void> {
  const server = await resolveEntity(servers, undefined, '📋 На какой сервер установить ключ?');
  if (!server) return;
  const pubKey = fs.existsSync(key.pubPath) ? key.pubPath : key.path;
  const password = await resolvePassword(server as Server);
  ui.printSection('📋', `ssh-copy-id ${tilde(key.path)} → ${targetSummary(server)}`);
  try {
    const code = await copyId(server as Server, pubKey, password);
    if (code === 0) ui.printOk('Ключ установлен.');
    else ui.printError(`ssh-copy-id завершился с кодом ${code}.`);
  } catch (e) {
    ui.printError((e as Error).message);
  }
}

/** Generate a new key pair (interactive). Returns the created private-key path. */
export async function generateKeyFlow(): Promise<string | null> {
  ui.ensureInteractive('Генерация ключа');
  if (!commandExists('ssh-keygen')) {
    ui.printError('ssh-keygen не найден в PATH.');
    return null;
  }
  ui.printSection('✨', 'Новый SSH-ключ');
  const type = await ui.choose<KeyType>({
    message: '🔐 Тип ключа',
    choices: [
      { name: 'ed25519 — современный, короткий (рекомендуется)', value: 'ed25519' },
      { name: 'rsa — максимальная совместимость (4096 бит)', value: 'rsa' },
      { name: 'ecdsa', value: 'ecdsa' },
      {
        name: 'ed25519-sk — на аппаратном ключе (FIDO2/U2F)',
        value: 'ed25519-sk',
        description: 'нужен подключённый аппаратный ключ (касание/PIN)',
      },
      {
        name: 'ecdsa-sk — на аппаратном ключе (FIDO2/U2F)',
        value: 'ecdsa-sk',
        description: 'нужен подключённый аппаратный ключ (касание/PIN)',
      },
    ],
    default: 'ed25519',
  });
  if (isSkKeyType(type)) {
    ui.printInfo(
      'Для -sk нужен подключённый аппаратный ключ (FIDO2/U2F). ssh-keygen попросит касание/PIN.',
    );
  }
  const sshDir = path.join(os.homedir(), '.ssh');
  // ssh convention names sk keys with an underscore: id_ed25519_sk
  const suggested = path.join(sshDir, `id_${type.replace('-sk', '_sk')}`);
  const keyPath = expandHome(
    (
      await ui.text({
        message: '📁 Путь к файлу ключа',
        default: tilde(suggested),
        validate: (v) => v.trim().length > 0 || 'Укажите путь',
      })
    ).trim(),
  );
  if (fs.existsSync(keyPath)) {
    const refs = keyReferences(keyPath);
    const note = refs.length ? ` На него ссылаются: ${refs.map((r) => r.name).join(', ')}.` : '';
    if (
      !(await ui.confirm({
        message: `Файл ${tilde(keyPath)} уже существует — перезаписать?${note}`,
        default: false,
      }))
    ) {
      ui.printInfo('Отменено.');
      return null;
    }
    deleteKey(keyPath); // ssh-keygen would otherwise prompt; remove first
  }
  const comment = (
    await ui.text({ message: '🏷 Комментарий', default: defaultKeyComment() })
  ).trim();
  const withPassphrase = await ui.confirm({
    message: '🔒 Защитить ключ парольной фразой?',
    default: false,
  });

  try {
    const code = await generateKey({ path: keyPath, type, comment, withPassphrase });
    if (code !== 0) {
      ui.printError(`ssh-keygen завершился с кодом ${code}.`);
      return null;
    }
  } catch (e) {
    ui.printError((e as Error).message);
    return null;
  }
  const fp = keyFingerprint(keyPath);
  ui.printOk(`Ключ создан: ${tilde(keyPath)}${fp ? `  ${fp.hash}` : ''}`);
  if (
    await ui.confirm({ message: 'Установить ключ на сервер сейчас (ssh-copy-id)?', default: false })
  )
    await installKeyOnServer({
      path: keyPath,
      pubPath: pubPathFor(keyPath),
      hasPub: fs.existsSync(pubPathFor(keyPath)),
      type: fp?.type ?? type,
      bits: fp?.bits ?? 0,
      fingerprint: fp?.hash ?? '',
      comment,
    });
  return keyPath;
}

/** Delete a key — but first surface who references it. */
export async function deleteKeyFlow(key: KeyInfo): Promise<void> {
  const refs = keyReferences(key.path);
  ui.printSection('🗑', `Удаление ключа — ${tilde(key.path)}`);
  if (refs.length) {
    ui.printWarn(`На этот ключ ссылаются ${refs.length}:`);
    for (const r of refs) console.log(`   ${ui.chalk.dim(r.kind)}  ${ui.chalk.bold(r.name)}`);
    ui.printWarn('Файл будет удалён, но ссылки останутся — подключения по нему сломаются.');
  } else {
    ui.printInfo('На этот ключ не ссылается ни один сервер/туннель.');
  }
  const removesPub = fs.existsSync(key.pubPath);
  if (
    !(await ui.confirm({
      message: `Удалить файл${removesPub ? ' (и .pub)' : ''} ${tilde(key.path)}?`,
      default: false,
    }))
  ) {
    ui.printInfo('Отменено.');
    return;
  }
  const { removed } = deleteKey(key.path);
  if (removed.length) ui.printOk(`Удалено: ${removed.map(tilde).join(', ')}.`);
  else ui.printWarn('Нечего удалять (файл не найден).');
}

/** Resolve a key by path for the CLI, or pick one interactively. */
async function resolveKey(keyPath?: string): Promise<KeyInfo | null> {
  const keys = listKeys();
  if (keyPath) {
    const want = expandHome(keyPath);
    const hit = keys.find((k) => k.path === want || tilde(k.path) === keyPath);
    if (hit) return hit;
    ui.printError(`Ключ не найден: ${keyPath}`);
    return null;
  }
  if (!keys.length) {
    ui.printWarn('В ~/.ssh не найдено приватных ключей.');
    return null;
  }
  ui.ensureInteractive('Выбор ключа');
  const picked = await ui.pickFromList<KeyInfo>({
    message: '🗝 Выберите ключ',
    items: keys,
    render: (k) => {
      const refs = keyReferences(k.path).length;
      return (
        `${ui.chalk.bold(tilde(k.path))}  ${ui.chalk.magenta(k.type)}` +
        `  ${ui.chalk.dim(k.fingerprint || '—')}` +
        (refs ? ui.chalk.cyan(`  · ${refs} ссыл.`) : '')
      );
    },
    search: (k) => `${k.path} ${k.type} ${k.comment}`,
    pageSize: 14,
  });
  return picked === ui.BACK ? null : picked;
}

/** CLI: delete a key (interactive picker when no path given). */
export async function deleteKeyCommand(keyPath?: string): Promise<void> {
  const key = await resolveKey(keyPath);
  if (key) await deleteKeyFlow(key);
}

/** Interactive key-management menu (entry from the main menu). */
export async function keysMenu(crumbs: string[] = ['Главное меню']): Promise<void> {
  ui.ensureInteractive('Управление ключами');
  for (;;) {
    ui.clearScreen();
    const keys = listKeys();
    ui.printSection('🗝', `SSH-ключи (${keys.length})`);
    if (keys.length) console.log(renderKeysTable(keys) + '\n');

    const GEN = '__gen__';
    const picked = await ui.pickFromList<KeyInfo | { __action: string }>({
      message: 'Ключи',
      items: [{ __action: GEN } as { __action: string }, ...keys],
      render: (it) =>
        '__action' in it
          ? ui.chalk.green('✨ Сгенерировать новый ключ')
          : `${ui.chalk.bold(tilde((it as KeyInfo).path))}  ${ui.chalk.magenta((it as KeyInfo).type)}  ${ui.chalk.dim((it as KeyInfo).fingerprint || '—')}`,
      search: (it) => ('__action' in it ? 'генерировать создать new' : (it as KeyInfo).path),
      pageSize: 14,
      crumbs,
      indent: crumbs.length * 2,
    });
    if (picked === ui.BACK) return;

    ui.clearScreen();
    try {
      if ('__action' in picked) {
        await generateKeyFlow();
        await ui.pause();
        continue;
      }
      const key = picked as KeyInfo;
      const action = await ui.choose<string>({
        message: `${tilde(key.path)} — что делаем?`,
        choices: [
          { name: '📄 Показать публичный ключ', value: 'show' },
          { name: '📋 Копировать публичный ключ в буфер', value: 'copy' },
          { name: '📡 Установить на сервер (ssh-copy-id)', value: 'install' },
          { name: '🗑 Удалить ключ', value: 'delete' },
        ],
      });
      if (action === 'show') showPublicKey(key);
      else if (action === 'copy') copyPublicKey(key);
      else if (action === 'install') await installKeyOnServer(key);
      else if (action === 'delete') await deleteKeyFlow(key);
    } catch (e) {
      if (e instanceof PromptAbortError) ui.printInfo('Отменено.');
      else ui.printError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
    await ui.pause();
  }
}
