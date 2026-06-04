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
import {
  isValidForwardHost,
  isValidHostOrIp,
  isValidName,
  isValidPort,
  isValidSshAlias,
  isValidUser,
  isSafeKeyPath,
} from '../utils/validators.js';
import { expandHome, parseTags, slugify } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

export interface ServerAddFlags {
  host?: string;
  user?: string;
  port?: string;
  auth?: string;
  key?: string;
  desc?: string;
  tags?: string;
}

/** A username that lands in ~/.ssh/config (User) or in `user@host` must be a
 *  clean token — a newline would inject an arbitrary config directive. */
function resolveUser(user: string | undefined, fallback: string): string {
  const u = (user ?? fallback).trim();
  if (u && !isValidUser(u)) throw new WizardError(tr.noninteractive.invalidUser(JSON.stringify(u)));
  return u;
}

/** A key path becomes an IdentityFile directive — reject control chars before it
 *  reaches ~/.ssh/config (the file-exists check happens separately). */
function resolveKeyPath(key: string): string {
  const p = expandHome(key.trim());
  if (!isSafeKeyPath(p)) throw new WizardError(tr.noninteractive.invalidKeyPath);
  if (!fs.existsSync(p)) throw new WizardError(tr.noninteractive.keyNotFound(p));
  return p;
}

function resolveAuth(auth: string | undefined, key: string | undefined): AuthMethod {
  const a = (auth ?? (key ? 'key' : 'agent')).toLowerCase();
  if (a === 'password') throw new WizardError(tr.noninteractive.authPasswordDisabled);
  if (a !== 'agent' && a !== 'key') throw new WizardError(tr.noninteractive.authInvalid(a));
  return a;
}

export function addServerNonInteractive(name: string | undefined, f: ServerAddFlags): Server {
  const alias = (name ?? '').trim();
  if (!isValidSshAlias(alias)) throw new WizardError(tr.noninteractive.serverAddUsage);
  if (servers.nameExists(alias)) throw new WizardError(tr.noninteractive.serverNameExists(alias));
  if (!f.host || !isValidHostOrIp(f.host.trim()))
    throw new WizardError(tr.noninteractive.hostRequired);
  const port = f.port ?? String(settings.get().defaultSshPort);
  if (!isValidPort(port)) throw new WizardError(tr.noninteractive.portInvalid(f.port));

  const auth = resolveAuth(f.auth, f.key);
  let keyPath: string | null = null;
  if (auth === 'key') {
    if (!f.key) throw new WizardError(tr.noninteractive.authKeyRequiresPath);
    keyPath = resolveKeyPath(f.key);
  }
  const user = resolveUser(f.user, settings.get().defaultUser);

  const server = servers.create({
    name: alias,
    kind: 'server',
    hostMode: 'sshconfig',
    sshHost: '',
    host: f.host.trim(),
    user,
    sshPort: Number(port),
    auth,
    keyPath,
    secretId: null,
    description: f.desc ?? '',
    tags: parseTags(f.tags ?? ''),
  });
  ui.printOk(tr.noninteractive.serverCreated(server.name));
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
    throw new WizardError(tr.noninteractive.typeInvalid);
  if (!f.local || !isValidPort(f.local)) throw new WizardError(tr.noninteractive.localPortRequired);
  const localPort = Number(f.local);

  let remotePort: number | null = null;
  if (type !== 'dynamic') {
    if (!f.remotePort || !isValidPort(f.remotePort))
      throw new WizardError(tr.noninteractive.remotePortRequired(type));
    remotePort = Number(f.remotePort);
  }
  const remoteHost = (f.remoteHost ?? settings.get().defaultRemoteHost) || '127.0.0.1';
  if (!isValidForwardHost(remoteHost))
    throw new WizardError(tr.noninteractive.remoteHostInvalid(JSON.stringify(remoteHost)));

  // connection: a config alias, or a manual host
  let conn: Pick<Tunnel, 'hostMode' | 'sshHost' | 'host' | 'user' | 'sshPort' | 'auth' | 'keyPath'>;
  if (f.alias) {
    if (!isValidSshAlias(f.alias)) throw new WizardError(tr.noninteractive.aliasInvalid(f.alias));
    const auth = resolveAuth(f.auth, f.key);
    let keyPath: string | null = null;
    if (auth === 'key') {
      if (!f.key) throw new WizardError(tr.noninteractive.authKeyRequiresPath);
      keyPath = resolveKeyPath(f.key);
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
      throw new WizardError(tr.noninteractive.aliasOrHostRequired);
    const port = f.port ?? String(settings.get().defaultSshPort);
    if (!isValidPort(port)) throw new WizardError(tr.noninteractive.portInvalid(f.port));
    const auth = resolveAuth(f.auth, f.key);
    let keyPath: string | null = null;
    if (auth === 'key') {
      if (!f.key) throw new WizardError(tr.noninteractive.authKeyRequiresPath);
      keyPath = resolveKeyPath(f.key);
    }
    conn = {
      hostMode: 'manual',
      sshHost: '',
      host: f.host.trim(),
      user: resolveUser(f.user, settings.get().defaultUser),
      sshPort: Number(port),
      auth,
      keyPath,
    };
  }

  // An explicit --name must satisfy the same contract as the wizard/import, so a
  // non-interactive add can't persist a garbled/over-long/control-char name that
  // the interactive path would reject. The slugified fallback is always valid.
  if (f.name && !isValidName(f.name.trim())) throw new WizardError(tr.noninteractive.nameInvalid);
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
  ui.printOk(tr.noninteractive.tunnelCreated(tunnel.name));
  return tunnel;
}
