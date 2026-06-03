/** Extra actions: reachability check, ssh-copy-id, remote command, file transfer. */

import type { ConnectionTarget, Server } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { findSshKeys } from '../ssh/keys.js';
import { healthCheck, copyId, runCommand, transfer } from '../ssh/features.js';
import type { TransferOptions, TransferTool } from '../ssh/features.js';
import * as ui from '../ui/index.js';
import { targetSummary } from '../ui/format.js';
import { tilde } from '../utils/strings.js';
import { commandExists } from '../utils/exec.js';
import { resolveEntity, resolvePassword } from './helpers.js';

/** Resolve a server, or fall back to a tunnel (both are connection targets). */
async function resolveServerLike(
  name: string | undefined,
  message: string,
): Promise<Server | null> {
  const server = await resolveEntity(servers, name, message);
  return server;
}

export async function checkTarget(target: ConnectionTarget, label: string): Promise<boolean> {
  ui.printSection('🔎', `Проверка доступности → ${label}`);
  const result = await healthCheck(target);
  if (result.open) {
    ui.printOk(`${result.host}:${result.port} доступен (${result.ms} мс).`);
  } else {
    ui.printError(`${result.host}:${result.port} недоступен (таймаут/отказ за ${result.ms} мс).`);
  }
  return result.open;
}

export async function checkFlow(name?: string): Promise<number> {
  // try servers first, then tunnels
  const server = name ? servers.findByName(name) : null;
  if (server) return (await checkTarget(server, server.name)) ? 0 : 2;
  const tunnel = name ? tunnels.findByName(name) : null;
  if (tunnel) return (await checkTarget(tunnel, tunnel.name)) ? 0 : 2;

  const picked = await resolveServerLike(name, '🔎 Выберите сервер для проверки');
  if (!picked) return 0;
  return (await checkTarget(picked, picked.name)) ? 0 : 2;
}

export async function copyIdFlow(name?: string): Promise<number> {
  const server = await resolveServerLike(name, '📋 Сервер для копирования ключа (ssh-copy-id)');
  if (!server) return 0;

  // Pick a public/identity key to install.
  let keyPath: string | null = server.auth === 'key' ? server.keyPath : null;
  const found = findSshKeys();
  if (!keyPath && found.length) {
    const DEFAULT = '__default__';
    const choice = await ui.choose<string>({
      message: '🗝 Какой ключ установить на сервер?',
      choices: [
        ...found.map((k) => ({ name: `🗝 ${tilde(k)}`, value: k })),
        { name: 'По умолчанию (ssh-copy-id сам выберет)', value: DEFAULT },
      ],
    });
    keyPath = choice === DEFAULT ? null : choice;
  }

  const password = await resolvePassword(server);
  ui.printSection('📋', `ssh-copy-id → ${targetSummary(server)}`);
  try {
    const code = await copyId(server, keyPath, password);
    if (code === 0) ui.printOk('Ключ установлен. Теперь можно подключаться без пароля.');
    else ui.printError(`ssh-copy-id завершился с кодом ${code}.`);
    return code;
  } catch (e) {
    ui.printError((e as Error).message);
    return 1;
  }
}

export async function runFlow(name: string | undefined, command: string[]): Promise<number> {
  const server = await resolveServerLike(name, '⚡ Сервер для команды');
  if (!server) return 0;
  let cmd = command;
  if (!cmd.length) {
    ui.ensureInteractive('Ввод команды');
    const line = await ui.text({
      message: '⚡ Команда для выполнения на сервере',
      validate: (v) => v.trim().length > 0 || 'Пусто',
    });
    cmd = ['sh', '-lc', line];
  }
  const password = await resolvePassword(server);
  servers.touch(server.id);
  ui.printSection('⚡', `Выполняю на → ${targetSummary(server)}`);
  return runCommand(server, cmd, password);
}

export async function transferFlow(name?: string): Promise<number> {
  const server = await resolveServerLike(name, '📂 Сервер для передачи файлов');
  if (!server) return 0;
  ui.ensureInteractive('Передача файлов');

  const toolChoices: Array<{ name: string; value: TransferTool }> = [
    { name: '📦 scp — простое копирование', value: 'scp' },
  ];
  if (commandExists('rsync')) {
    toolChoices.unshift({
      name: '🔄 rsync — дельта-синхронизация (быстрее на повторных)',
      value: 'rsync',
    });
  }
  const tool =
    toolChoices.length > 1
      ? await ui.choose<TransferTool>({ message: '🛠 Чем передавать?', choices: toolChoices })
      : 'scp';

  const direction = await ui.choose<'upload' | 'download'>({
    message: '📂 Направление',
    choices: [
      { name: '⬆️ Загрузить на сервер (upload)', value: 'upload' },
      { name: '⬇️ Скачать с сервера (download)', value: 'download' },
    ],
  });
  const localPath = await ui.text({
    message: '🖥 Локальный путь',
    validate: (v) => v.trim().length > 0 || 'Пусто',
  });
  const remotePath = await ui.text({
    message: '☁️ Путь на сервере',
    validate: (v) => v.trim().length > 0 || 'Пусто',
  });

  const opts: TransferOptions = { direction, localPath, remotePath, tool };
  if (tool === 'rsync') {
    opts.archive = true;
    opts.compress = await ui.confirm({ message: '🗜 Сжимать в пути (-z)?', default: true });
    opts.delete = await ui.confirm({
      message: '🧹 Удалять лишнее на приёмнике (--delete)?',
      default: false,
    });
    opts.dryRun = await ui.confirm({ message: '👀 Пробный прогон (--dry-run)?', default: false });
  } else {
    opts.recursive = await ui.confirm({ message: '📁 Рекурсивно (папка)?', default: false });
  }

  const password = await resolvePassword(server);
  ui.printSection('📂', `${tool} ${direction} → ${targetSummary(server)}`);
  try {
    const code = await transfer(server, opts, password);
    if (code === 0) ui.printOk('Готово.');
    else ui.printError(`${tool} завершился с кодом ${code}.`);
    return code;
  } catch (e) {
    ui.printError((e as Error).message);
    return 1;
  }
}
