/** `wssh doctor` — environment diagnostics: required/optional binaries, data
 *  directory permissions, ~/.ssh/config health and vault status. Consolidates the
 *  checks scattered across preflight/copy-id/transfer into one health report. */

import fs from 'node:fs';
import os from 'node:os';
import { DATA_DIR, FILES, SSH_DIR, SSH_CONFIG_FILE } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { isMac, isWindows } from '../utils/platform.js';
import { listHosts } from '../ssh-config/index.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { vault } from '../vault/vault.js';
import { listKeys } from '../ssh/keys.js';
import * as ui from '../ui/index.js';

type Status = 'ok' | 'warn' | 'fail';
interface Check {
  label: string;
  status: Status;
  detail: string;
}

const ICON: Record<Status, string> = {
  ok: ui.chalk.green('✔'),
  warn: ui.chalk.yellow('⚠'),
  fail: ui.chalk.red('✖'),
};

function sshVersion(): string {
  // ssh prints its version to stderr.
  const res = capture('ssh', ['-V']);
  return (res.stderr || res.stdout || '').trim();
}

/** Octal mode (e.g. "700") of a path, or null if it can't be stat'd. */
function mode(p: string): string | null {
  try {
    return (fs.statSync(p).mode & 0o777).toString(8);
  } catch {
    return null;
  }
}

export function collectChecks(): Check[] {
  const checks: Check[] = [];
  const bin = (name: string, required: boolean, why: string): void => {
    const ok = commandExists(name);
    checks.push({
      label: name,
      status: ok ? 'ok' : required ? 'fail' : 'warn',
      detail: ok ? 'найден' : `не найден — ${why}`,
    });
  };

  checks.push({
    label: 'ssh',
    status: commandExists('ssh') ? 'ok' : 'fail',
    detail: commandExists('ssh')
      ? sshVersion() || 'найден'
      : 'не найден — основа всего, установите OpenSSH',
  });
  bin('scp', false, 'без него недоступна передача файлов scp');
  bin('rsync', false, 'без него недоступна дельта-синхронизация');
  bin('ssh-keygen', false, 'нужен для генерации ключей и known_hosts');
  bin('ssh-copy-id', false, 'нужен для установки ключа на сервер');
  bin('sshpass', false, 'нужен только для парольной авторизации');
  const clip = isMac ? 'pbcopy' : isWindows ? 'clip' : 'xclip/wl-copy';
  const clipOk = ['pbcopy', 'clip', 'xclip', 'wl-copy', 'xsel'].some(commandExists);
  checks.push({
    label: 'буфер обмена',
    status: clipOk ? 'ok' : 'warn',
    detail: clipOk ? 'доступен' : `не найден (${clip}) — копирование .pub отключено`,
  });

  // data dir + perms
  const dm = mode(DATA_DIR);
  checks.push({
    label: 'каталог данных',
    status: dm == null ? 'warn' : dm === '700' ? 'ok' : 'warn',
    detail: dm == null ? `${DATA_DIR} (нет)` : `${DATA_DIR} (права ${dm})`,
  });
  if (fs.existsSync(FILES.vault)) {
    const vm = mode(FILES.vault);
    checks.push({
      label: 'права vault.json',
      status: vm === '600' ? 'ok' : 'warn',
      detail: vm === '600' ? '600' : `${vm} (ожидается 600)`,
    });
  }

  // ~/.ssh + config
  const sm = mode(SSH_DIR);
  checks.push({
    label: '~/.ssh',
    status: sm == null ? 'warn' : sm === '700' ? 'ok' : 'warn',
    detail: sm == null ? 'нет каталога' : `права ${sm}`,
  });
  if (fs.existsSync(SSH_CONFIG_FILE)) {
    const cm = mode(SSH_CONFIG_FILE);
    let hostsCount = -1;
    try {
      hostsCount = listHosts().length;
    } catch {
      hostsCount = -1;
    }
    checks.push({
      label: '~/.ssh/config',
      status: hostsCount < 0 ? 'fail' : 'ok',
      detail: hostsCount < 0 ? 'не удалось разобрать' : `${hostsCount} хостов · права ${cm ?? '—'}`,
    });
  } else {
    checks.push({ label: '~/.ssh/config', status: 'warn', detail: 'нет файла (будет создан)' });
  }

  // vault / touch id
  checks.push({
    label: 'хранилище паролей',
    status: 'ok',
    detail: vault.exists() ? 'создано' : 'не создано',
  });
  if (isMac) {
    checks.push({
      label: 'Touch ID',
      status: 'ok',
      detail: vault.touchIdSupported() ? 'поддерживается' : 'недоступен (нужен Xcode CLT)',
    });
  }

  // inventory
  checks.push({
    label: 'инвентарь',
    status: 'ok',
    detail: `серверов: ${safeCount(() => servers.all().length)} · туннелей: ${safeCount(() => tunnels.all().length)} · врем.: ${safeCount(() => tempTunnels.all().length)} · ключей: ${safeCount(() => listKeys().length)}`,
  });

  return checks;
}

function safeCount(fn: () => number): number {
  try {
    return fn();
  } catch {
    return 0;
  }
}

export function doctor(opts: { json?: boolean } = {}): number {
  const checks = collectChecks();
  const failed = checks.some((c) => c.status === 'fail');
  if (opts.json) {
    console.log(JSON.stringify({ ok: !failed, platform: os.platform(), checks }, null, 2));
    return failed ? 2 : 0;
  }
  ui.printSection('🩺', 'Диагностика wssh');
  for (const c of checks) {
    console.log(
      `  ${ICON[c.status]} ${ui.chalk.bold(c.label.padEnd(20))} ${ui.chalk.dim(c.detail)}`,
    );
  }
  console.log('');
  if (failed) ui.printError('Есть критические проблемы (✖). Их стоит починить.');
  else ui.printOk('Всё в порядке.');
  return failed ? 2 : 0;
}
