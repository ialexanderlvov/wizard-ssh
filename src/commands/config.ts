/** CRUD over the real ~/.ssh/config, plus connecting straight to an alias.
 *  Servers ARE config hosts, so connecting goes through the same path. */

import type { SshConfigHost } from '../core/types.js';
import type { SshConfigParam } from '../ssh-config/index.js';
import * as sshConfig from '../ssh-config/index.js';
import { servers } from '../store/servers.store.js';
import { usage } from '../store/usage.store.js';
import { vault } from '../vault/vault.js';
import * as ui from '../ui/index.js';
import { renderConfigHostsTable } from '../ui/tables.js';
import {
  isSafeKeyPath,
  isValidHostOrIp,
  isValidPort,
  isValidProxyJump,
  isValidSshAlias,
  isValidUser,
} from '../utils/validators.js';
import { connectServer } from './servers.js';
import { tr } from '../i18n/index.js';

const STD_KEYS = ['HostName', 'User', 'Port', 'IdentityFile', 'ProxyJump'] as const;

async function pickHost(message: string): Promise<SshConfigHost | null> {
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn(tr.config.noHosts);
    return null;
  }
  ui.ensureInteractive(tr.config.pickHostEnsure);
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

/** Pick a ProxyJump bastion from existing config hosts (or none / manual chain). */
async function askProxyJump(current: string, excludeAlias?: string): Promise<string> {
  const hosts = sshConfig.listHosts().filter((h) => h.alias !== excludeAlias);
  const KEEP = '__keep__';
  const NONE = '__none__';
  const MANUAL = '__manual__';
  const choices = [
    ...(current ? [{ name: tr.config.proxyKeep(current), value: KEEP }] : []),
    { name: tr.config.proxyNone, value: NONE },
    ...hosts.map((h) => ({
      name: `${h.alias}${h.hostName ? ` (${h.hostName})` : ''}`,
      value: h.alias,
    })),
    { name: tr.config.proxyManual, value: MANUAL },
  ];
  const pick = await ui.choose<string>({
    message: tr.config.proxyQuestion,
    choices,
    default: current ? KEEP : NONE,
  });
  if (pick === KEEP) return current;
  if (pick === NONE) return '';
  if (pick === MANUAL) {
    return (
      await ui.text({
        message: tr.config.proxyManualPrompt,
        default: current,
        validate: (v) => !v.trim() || isValidProxyJump(v.trim()) || tr.config.proxyJumpInvalid,
      })
    ).trim();
  }
  return pick;
}

async function askHostFields(current?: SshConfigHost): Promise<Record<string, string>> {
  const get = (k: string): string =>
    current?.params.find((p) => p.key.toLowerCase() === k.toLowerCase())?.value ?? '';
  return {
    HostName: await ui.text({
      message: tr.config.hostNameQuestion,
      default: get('HostName'),
      validate: (v) => !v.trim() || isValidHostOrIp(v.trim()) || tr.config.hostNameInvalid,
    }),
    User: await ui.text({
      message: tr.config.userQuestion,
      default: get('User'),
      validate: (v) => !v.trim() || isValidUser(v.trim()) || tr.config.userInvalid,
    }),
    Port: await ui.text({
      message: tr.config.portQuestion,
      default: get('Port'),
      validate: (v) => !v.trim() || isValidPort(v.trim()) || tr.config.portInvalid,
    }),
    IdentityFile: await ui.text({
      message: tr.config.identityFileQuestion,
      default: get('IdentityFile'),
      validate: (v) => !v.trim() || isSafeKeyPath(v.trim()) || tr.config.identityFileInvalid,
    }),
    ProxyJump: await askProxyJump(get('ProxyJump'), current?.alias),
  };
}

export async function addConfigHost(): Promise<void> {
  ui.ensureInteractive(tr.config.addEnsure);
  ui.printSection('➕', tr.config.addSection);
  const alias = (
    await ui.text({
      message: tr.config.aliasQuestion,
      validate: (v) =>
        !isValidSshAlias(v)
          ? tr.config.aliasInvalidChars
          : sshConfig.getHost(v.trim())
            ? tr.config.aliasExists
            : true,
    })
  ).trim();
  const answers = await askHostFields();
  const { backup, created } = sshConfig.upsertHost({ alias, params: mergeParams([], answers) });
  ui.printOk(created ? tr.config.hostAdded(alias) : tr.config.hostUpdated(alias));
  if (backup) ui.printInfo(tr.config.backupInfo(backup));
}

export async function editConfigHost(alias?: string): Promise<void> {
  ui.ensureInteractive(tr.config.editEnsure);
  const host = alias ? sshConfig.getHost(alias) : await pickHost(tr.config.pickHostEdit);
  if (!host) {
    if (alias) ui.printError(tr.config.hostNotFound(alias));
    return;
  }
  ui.printSection('✏️', tr.config.editSection(host.alias));
  const answers = await askHostFields(host);
  const { backup } = sshConfig.upsertHost({
    alias: host.alias,
    params: mergeParams(host.params, answers),
    wssh: host.wssh, // keep the #wssh annotation (desc/tags/auth/secret) intact
  });
  ui.printOk(tr.config.editOk(host.alias));
  if (backup) ui.printInfo(tr.config.backupInfo(backup));
  if (!sshConfig.isManageable(host.alias)) {
    ui.printWarn(tr.config.includeMatchWarn);
  }
}

export async function removeConfigHostFlow(alias?: string): Promise<void> {
  ui.ensureInteractive(tr.config.removeEnsure);
  const host = alias ? sshConfig.getHost(alias) : await pickHost(tr.config.pickHostRemove);
  if (!host) {
    if (alias) ui.printError(tr.config.hostNotFound(alias));
    return;
  }
  if (!sshConfig.isManageable(host.alias)) {
    ui.printWarn(tr.config.includeMatchRemoveWarn(host.alias));
    return;
  }
  if (!(await ui.confirm({ message: tr.config.removeConfirm(host.alias), default: false }))) {
    ui.printInfo(tr.common.cancelled);
    return;
  }
  const { removed, backup } = sshConfig.removeHost(host.alias);
  if (removed) {
    // Mirror the server facade's delete: drop usage stats and any orphaned vault
    // secret so a re-added alias of the same name doesn't silently inherit them.
    usage.remove(host.alias);
    vault.removeSecret(host.wssh?.secretId);
    ui.printOk(tr.config.removeOk(host.alias));
    if (backup) ui.printInfo(tr.config.backupInfo(backup));
  } else ui.printWarn(tr.config.removeFailed);
}

export function listConfigHosts(opts: { json?: boolean } = {}): SshConfigHost[] {
  const hosts = sshConfig.listHosts();
  if (opts.json) {
    console.log(JSON.stringify(hosts, null, 2));
    return hosts;
  }
  if (!hosts.length) {
    ui.printWarn(tr.config.noHosts);
    return hosts;
  }
  ui.printSection('🗂', tr.config.listSection(hosts.length));
  console.log(renderConfigHostsTable(hosts));
  return hosts;
}

/** Connect straight to a config alias — same path as connecting to a server,
 *  since every config host IS a server. */
export async function connectConfigHostFlow(alias?: string): Promise<number> {
  const host = alias ? sshConfig.getHost(alias) : await pickHost(tr.config.pickHostConnect);
  if (!host) {
    if (alias) ui.printError(tr.config.hostNotFound(alias));
    return 0;
  }
  const server = servers.findById(host.alias);
  return server ? connectServer(server) : 0;
}
