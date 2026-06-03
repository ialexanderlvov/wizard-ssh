/** CRUD over the real ~/.ssh/config, plus connecting straight to an alias. */

import type { Server, SshConfigHost } from '../core/types.js';
import type { SshConfigParam } from '../ssh-config/index.js';
import * as sshConfig from '../ssh-config/index.js';
import { runInteractive } from '../ssh/runner.js';
import * as ui from '../ui/index.js';
import { renderConfigHostsTable } from '../ui/tables.js';
import { isValidSshAlias } from '../utils/validators.js';
import { nowIso } from '../utils/time.js';

const STD_KEYS = ['HostName', 'User', 'Port', 'IdentityFile', 'ProxyJump'] as const;

async function pickHost(message: string): Promise<SshConfigHost | null> {
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn('В ~/.ssh/config нет хостов.');
    return null;
  }
  ui.ensureInteractive('Выбор хоста');
  const res = await ui.pickFromList<SshConfigHost>({
    message,
    items: hosts,
    render: ui.configRowRenderer(hosts),
    search: ui.configSearch,
    sorts: ui.CONFIG_SORTS,
    pageSize: 14,
  });
  return res === ui.BACK ? null : res;
}

/** Merge standard answers into existing params, preserving extra options. */
function mergeParams(
  existing: SshConfigParam[],
  answers: Record<string, string>,
): SshConfigParam[] {
  const out = existing.filter(
    (p) => !STD_KEYS.some((k) => k.toLowerCase() === p.key.toLowerCase()),
  );
  for (const key of STD_KEYS) {
    const value = (answers[key] ?? '').trim();
    if (value) out.unshift({ key, value });
  }
  // keep a stable, readable order: standard keys first
  return out.sort((a, b) => {
    const ai = STD_KEYS.findIndex((k) => k.toLowerCase() === a.key.toLowerCase());
    const bi = STD_KEYS.findIndex((k) => k.toLowerCase() === b.key.toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

async function askHostFields(current?: SshConfigHost): Promise<Record<string, string>> {
  const get = (k: string): string =>
    current?.params.find((p) => p.key.toLowerCase() === k.toLowerCase())?.value ?? '';
  return {
    HostName: await ui.text({ message: '🖥 HostName (IP/домен)', default: get('HostName') }),
    User: await ui.text({ message: '👤 User', default: get('User') }),
    Port: await ui.text({ message: '🔌 Port (пусто = 22)', default: get('Port') }),
    IdentityFile: await ui.text({
      message: '🗝 IdentityFile (путь, необязательно)',
      default: get('IdentityFile'),
    }),
    ProxyJump: await ui.text({
      message: '🛬 ProxyJump (jump-host, необязательно)',
      default: get('ProxyJump'),
    }),
  };
}

export async function addConfigHost(): Promise<void> {
  ui.ensureInteractive('Добавление в ~/.ssh/config');
  ui.printSection('➕', 'Новый хост в ~/.ssh/config');
  const alias = (
    await ui.text({
      message: '🔗 Host (алиас)',
      validate: (v) =>
        !isValidSshAlias(v)
          ? 'Только буквы, цифры, . _ -'
          : sshConfig.getHost(v.trim())
            ? 'Такой алиас уже есть'
            : true,
    })
  ).trim();
  const answers = await askHostFields();
  const { backup, created } = sshConfig.upsertHost({ alias, params: mergeParams([], answers) });
  ui.printOk(`${created ? 'Добавлен' : 'Обновлён'} хост ${alias}.`);
  if (backup) ui.printInfo(`Бэкап: ${backup}`);
}

export async function editConfigHost(alias?: string): Promise<void> {
  ui.ensureInteractive('Редактирование ~/.ssh/config');
  const host = alias ? sshConfig.getHost(alias) : await pickHost('✏️ Выберите хост');
  if (!host) {
    if (alias) ui.printError(`Хост «${alias}» не найден.`);
    return;
  }
  ui.printSection('✏️', `Хост ${host.alias}`);
  const answers = await askHostFields(host);
  const { backup } = sshConfig.upsertHost({
    alias: host.alias,
    params: mergeParams(host.params, answers),
  });
  ui.printOk(`Хост ${host.alias} обновлён.`);
  if (backup) ui.printInfo(`Бэкап: ${backup}`);
  if (!sshConfig.isManageable(host.alias)) {
    ui.printWarn(
      'Исходное определение в Include/Match — добавлен переопределяющий блок в основной ~/.ssh/config.',
    );
  }
}

export async function removeConfigHostFlow(alias?: string): Promise<void> {
  ui.ensureInteractive('Удаление из ~/.ssh/config');
  const host = alias ? sshConfig.getHost(alias) : await pickHost('🗑 Выберите хост');
  if (!host) {
    if (alias) ui.printError(`Хост «${alias}» не найден.`);
    return;
  }
  if (!sshConfig.isManageable(host.alias)) {
    ui.printWarn(
      `Хост ${host.alias} определён в Include/Match или мультиалиасном блоке — авто-удаление не поддерживается.`,
    );
    return;
  }
  if (!(await ui.confirm({ message: `Удалить ${host.alias} из ~/.ssh/config?`, default: false }))) {
    ui.printInfo('Отменено.');
    return;
  }
  const { removed, backup } = sshConfig.removeHost(host.alias);
  if (removed) {
    ui.printOk(`Хост ${host.alias} удалён.`);
    if (backup) ui.printInfo(`Бэкап: ${backup}`);
  } else ui.printWarn('Не удалось удалить.');
}

export function listConfigHosts(opts: { json?: boolean } = {}): SshConfigHost[] {
  const hosts = sshConfig.listHosts();
  if (opts.json) {
    console.log(JSON.stringify(hosts, null, 2));
    return hosts;
  }
  if (!hosts.length) {
    ui.printWarn('В ~/.ssh/config нет хостов.');
    return hosts;
  }
  ui.printSection('🗂', `~/.ssh/config (${hosts.length})`);
  console.log(renderConfigHostsTable(hosts));
  return hosts;
}

/** Connect straight to a config alias (no saved server needed). */
export async function connectConfigHostFlow(alias?: string): Promise<number> {
  const host = alias
    ? sshConfig.getHost(alias)
    : await pickHost('🔌 Выберите хост для подключения');
  if (!host) {
    if (alias) ui.printError(`Хост «${alias}» не найден.`);
    return 0;
  }
  const ad: Server = {
    kind: 'server',
    id: '',
    name: host.alias,
    description: 'из ~/.ssh/config',
    tags: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastUsedAt: null,
    useCount: 0,
    hostMode: 'sshconfig',
    sshHost: host.alias,
    host: '',
    user: '',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    linkedSshHost: host.alias,
  };
  return runInteractive(ad);
}
