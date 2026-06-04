/** Extra actions: reachability check, fleet status, ssh-copy-id, remote command,
 *  file transfer, known_hosts, tag groups. */

import type { ConnectionTarget, Server } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { findSshKeys } from '../ssh/keys.js';
import { healthCheck, healthCheckAll, copyId, runCommand, transfer } from '../ssh/features.js';
import type { FleetTarget, TransferOptions, TransferTool } from '../ssh/features.js';
import { forgetHostKey } from '../ssh/hostkey.js';
import { resolveEndpoint } from '../ssh/features.js';
import * as ui from '../ui/index.js';
import { renderStatusTable } from '../ui/tables.js';
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

export async function checkFlow(name?: string, opts: { json?: boolean } = {}): Promise<number> {
  // try servers first, then tunnels
  const server = name ? servers.findByName(name) : null;
  const tunnel = !server && name ? tunnels.findByName(name) : null;
  const direct = server ?? tunnel;

  if (opts.json) {
    if (!direct) {
      ui.printError(`«${name ?? ''}» не найдено (для --json нужно точное имя).`);
      return 1;
    }
    const res = await healthCheck(direct);
    console.log(JSON.stringify({ name: direct.name, ...res }, null, 2));
    return res.open ? 0 : 2;
  }

  if (direct) return (await checkTarget(direct, direct.name)) ? 0 : 2;

  const picked = await resolveServerLike(name, '🔎 Выберите сервер для проверки');
  if (!picked) return 0;
  return (await checkTarget(picked, picked.name)) ? 0 : 2;
}

// ---------- fleet status (mass parallel check) ----------

export interface StatusOptions {
  json?: boolean;
  /** restrict to servers only / tunnels only */
  serversOnly?: boolean;
  tunnelsOnly?: boolean;
  /** restrict to entities carrying this tag */
  tag?: string;
}

function fleetTargets(opts: StatusOptions): FleetTarget[] {
  const out: FleetTarget[] = [];
  const tagged = (tags: string[]): boolean => !opts.tag || tags.includes(opts.tag);
  if (!opts.tunnelsOnly)
    for (const s of servers.all())
      if (tagged(s.tags)) out.push({ name: s.name, kind: 'server', target: s });
  if (!opts.serversOnly)
    for (const t of tunnels.all())
      if (tagged(t.tags)) out.push({ name: t.name, kind: 'tunnel', target: t });
  return out;
}

/** Check every server/tunnel (optionally filtered) at once and show a dashboard. */
export async function statusFlow(opts: StatusOptions = {}): Promise<number> {
  const targets = fleetTargets(opts);
  if (!targets.length) {
    if (opts.json) console.log('[]');
    else ui.printWarn('Нет целей для проверки.');
    return 0;
  }
  if (!opts.json) ui.printSection('📡', `Статус — проверяю ${targets.length}…`);
  const results = await healthCheckAll(targets, { concurrency: 10 });
  if (opts.json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          name: r.name,
          kind: r.kind,
          host: r.result.host,
          port: r.result.port,
          open: r.result.open,
          ms: r.result.ms,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(renderStatusTable(results));
    const down = results.filter((r) => !r.result.open).length;
    if (down) ui.printWarn(`Недоступно: ${down} из ${results.length}.`);
    else ui.printOk(`Все доступны (${results.length}).`);
  }
  return results.some((r) => !r.result.open) ? 2 : 0;
}

// ---------- known_hosts ----------

/** Forget a host's saved key (after a legitimate server rebuild). */
export async function forgetHostKeyFlow(name?: string): Promise<number> {
  let host = '';
  const server = name ? servers.findByName(name) : null;
  if (server) {
    host = resolveEndpoint(server).host;
  } else if (name) {
    host = name; // treat a non-matching argument as a literal host
  } else {
    const picked = await resolveServerLike(undefined, '🧹 У какого сервера забыть host-key?');
    if (!picked) return 0;
    host = resolveEndpoint(picked).host;
  }
  const res = forgetHostKey(host);
  if (res.ok) ui.printOk(res.message);
  else ui.printError(res.message);
  return res.ok ? 0 : 1;
}

// ---------- tag groups ----------

export function groupListFlow(opts: { json?: boolean } = {}): void {
  const counts = new Map<string, number>();
  for (const s of servers.all()) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of tunnels.all())
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (opts.json) {
    console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
    return;
  }
  if (!rows.length) {
    ui.printWarn('Тегов пока нет. Добавьте теги серверам/туннелям.');
    return;
  }
  ui.printSection('🏷', `Группы по тегам (${rows.length})`);
  for (const [tag, n] of rows)
    console.log(`  ${ui.chalk.cyan('#' + tag)}  ${ui.chalk.dim(`${n}`)}`);
}

/** Check every entity carrying a tag (parallel). */
export async function groupCheckFlow(tag: string, opts: { json?: boolean } = {}): Promise<number> {
  if (!tag.trim()) {
    ui.printError('Укажите тег: wssh group check <tag>');
    return 1;
  }
  return statusFlow({ tag: tag.trim(), json: opts.json });
}

export async function copyIdFlow(name?: string): Promise<number> {
  const server = await resolveServerLike(name, '📋 Сервер для копирования ключа (ssh-copy-id)');
  if (!server) return 0;

  // Pick a public/identity key to install. A server with a known IdentityFile
  // (incl. config-backed servers) reuses it; otherwise we offer a picker.
  let keyPath: string | null = server.keyPath ?? null;
  const found = findSshKeys();
  if (!keyPath && found.length) {
    const DEFAULT = '__default__';
    const choice = await ui.choose<string>({
      message: '🗝 Какой ключ установить на сервер?',
      choices: [
        ...found.map((k) => ({ name: `${tilde(k)}`, value: k })),
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
    { name: 'scp — простое копирование', value: 'scp' },
  ];
  if (commandExists('rsync')) {
    toolChoices.unshift({
      name: 'rsync — дельта-синхронизация (быстрее на повторных)',
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
      { name: 'Загрузить на сервер (upload)', value: 'upload' },
      { name: 'Скачать с сервера (download)', value: 'download' },
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
