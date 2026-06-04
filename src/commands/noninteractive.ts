/** Non-interactive (flag-driven) creation of servers and tunnels, for scripting.
 *  The store layer is already non-interactive; this just parses/validates flags
 *  and bypasses the prompt wizard. Password auth is rejected here (it needs an
 *  interactive secret prompt). Validation failures throw WizardError. */

import fs from 'node:fs';
import type { AuthMethod, ForwardType, Server, Tunnel } from '../core/types.js';
import { WizardError } from '../core/errors.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { settings } from '../store/settings.store.js';
import { isValidHostOrIp, isValidPort, isValidSshAlias } from '../utils/validators.js';
import { expandHome, parseTags, slugify } from '../utils/strings.js';
import * as ui from '../ui/index.js';

export interface ServerAddFlags {
  host?: string;
  user?: string;
  port?: string;
  auth?: string;
  key?: string;
  desc?: string;
  tags?: string;
}

function resolveAuth(auth: string | undefined, key: string | undefined): AuthMethod {
  const a = (auth ?? (key ? 'key' : 'agent')).toLowerCase();
  if (a === 'password')
    throw new WizardError(
      '--auth password недоступен в неинтерактивном режиме (нужен ввод пароля).',
    );
  if (a !== 'agent' && a !== 'key')
    throw new WizardError(`--auth должно быть agent|key (получено: ${a}).`);
  return a;
}

export function addServerNonInteractive(name: string | undefined, f: ServerAddFlags): Server {
  const alias = (name ?? '').trim();
  if (!isValidSshAlias(alias))
    throw new WizardError('Укажите корректное имя/алиас: wssh server add <name> --host <ip>');
  if (servers.nameExists(alias)) throw new WizardError(`Хост «${alias}» уже есть в ~/.ssh/config.`);
  if (!f.host || !isValidHostOrIp(f.host.trim()))
    throw new WizardError('Нужен корректный --host <ip|домен>.');
  const port = f.port ?? String(settings.get().defaultSshPort);
  if (!isValidPort(port)) throw new WizardError(`Некорректный --port: ${f.port}`);

  const auth = resolveAuth(f.auth, f.key);
  let keyPath: string | null = null;
  if (auth === 'key') {
    if (!f.key) throw new WizardError('--auth key требует --key <путь>.');
    keyPath = expandHome(f.key.trim());
    if (!fs.existsSync(keyPath)) throw new WizardError(`SSH-ключ не найден: ${keyPath}`);
  }

  const server = servers.create({
    name: alias,
    kind: 'server',
    hostMode: 'sshconfig',
    sshHost: '',
    host: f.host.trim(),
    user: (f.user ?? settings.get().defaultUser).trim(),
    sshPort: Number(port),
    auth,
    keyPath,
    secretId: null,
    description: f.desc ?? '',
    tags: parseTags(f.tags ?? ''),
  });
  ui.printOk(`Сервер «${server.name}» создан в ~/.ssh/config.`);
  return server;
}

export interface TunnelAddFlags {
  name?: string;
  type?: string;
  local?: string;
  remoteHost?: string;
  remotePort?: string;
  // connection
  alias?: string;
  host?: string;
  user?: string;
  port?: string;
  auth?: string;
  key?: string;
  desc?: string;
  tags?: string;
}

export function addTunnelNonInteractive(f: TunnelAddFlags): Tunnel {
  const type = (f.type ?? 'local').toLowerCase() as ForwardType;
  if (!['local', 'remote', 'dynamic'].includes(type))
    throw new WizardError('--type должно быть local|remote|dynamic.');
  if (!f.local || !isValidPort(f.local)) throw new WizardError('Нужен корректный --local <порт>.');
  const localPort = Number(f.local);

  let remotePort: number | null = null;
  if (type !== 'dynamic') {
    if (!f.remotePort || !isValidPort(f.remotePort))
      throw new WizardError(`Для --type ${type} нужен корректный --remote-port.`);
    remotePort = Number(f.remotePort);
  }
  const remoteHost = (f.remoteHost ?? settings.get().defaultRemoteHost) || '127.0.0.1';

  // connection: a config alias, or a manual host
  let conn: Pick<Tunnel, 'hostMode' | 'sshHost' | 'host' | 'user' | 'sshPort' | 'auth' | 'keyPath'>;
  if (f.alias) {
    if (!isValidSshAlias(f.alias)) throw new WizardError(`Некорректный --alias: ${f.alias}`);
    const auth = resolveAuth(f.auth, f.key);
    let keyPath: string | null = null;
    if (auth === 'key') {
      if (!f.key) throw new WizardError('--auth key требует --key <путь>.');
      keyPath = expandHome(f.key.trim());
      if (!fs.existsSync(keyPath)) throw new WizardError(`SSH-ключ не найден: ${keyPath}`);
    }
    conn = {
      hostMode: 'sshconfig',
      sshHost: f.alias.trim(),
      host: '',
      user: '',
      sshPort: 22,
      auth,
      keyPath,
    };
  } else {
    if (!f.host || !isValidHostOrIp(f.host.trim()))
      throw new WizardError('Укажите --alias <конфиг> или --host <ip|домен>.');
    const port = f.port ?? String(settings.get().defaultSshPort);
    if (!isValidPort(port)) throw new WizardError(`Некорректный --port: ${f.port}`);
    const auth = resolveAuth(f.auth, f.key);
    let keyPath: string | null = null;
    if (auth === 'key') {
      if (!f.key) throw new WizardError('--auth key требует --key <путь>.');
      keyPath = expandHome(f.key.trim());
      if (!fs.existsSync(keyPath)) throw new WizardError(`SSH-ключ не найден: ${keyPath}`);
    }
    conn = {
      hostMode: 'manual',
      sshHost: '',
      host: f.host.trim(),
      user: (f.user ?? settings.get().defaultUser).trim(),
      sshPort: Number(port),
      auth,
      keyPath,
    };
  }

  const suggested = slugify(f.name || `${f.alias || f.host}-${localPort}`);
  let name = (f.name || suggested).trim();
  let i = 2;
  while (tunnels.nameExists(name)) name = `${suggested}-${i++}`;

  const tunnel = tunnels.create({
    ...conn,
    secretId: null,
    kind: 'tunnel',
    type,
    localPort,
    remoteHost,
    remotePort,
    openBrowser: false,
    name,
    description: f.desc ?? '',
    tags: parseTags(f.tags ?? ''),
  });
  ui.printOk(`Туннель «${tunnel.name}» создан.`);
  return tunnel;
}
