/** Reusable prompt blocks for creating/editing servers and tunnels. */

import fs from 'node:fs';
import type { ConnectionTarget, ForwardType, Tunnel } from '../core/types.js';
import { tr } from '../i18n/index.js';
import { settings } from '../store/settings.store.js';
import { findSshKeys } from '../ssh/keys.js';
import * as sshConfig from '../ssh-config/index.js';
import * as ui from '../ui/index.js';
import { configHostLine } from '../ui/format.js';
import {
  isValidForwardHost,
  isValidHostOrIp,
  isValidName,
  isValidPort,
  isValidSshAlias,
} from '../utils/validators.js';
import { expandHome, parseTags, slugify, tilde } from '../utils/strings.js';

const portValidate = (v: string): boolean | string => isValidPort(v) || tr.wizard.portRange;

/** Fuzzy-pick a ~/.ssh/config alias (or type a new one). */
export async function pickSshAlias(current?: string): Promise<string> {
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn(tr.wizard.noSshConfigHosts);
    return ui.text({
      message: tr.wizard.aliasPrompt,
      default: current,
      validate: (v) => isValidSshAlias(v) || tr.wizard.aliasValidate,
    });
  }
  return ui.searchChoose<string>({
    message: tr.wizard.aliasSearchPrompt,
    source: (term) =>
      sshConfig
        .listHosts()
        .filter(
          (h) =>
            !term ||
            h.alias.toLowerCase().includes(term.toLowerCase()) ||
            h.hostName.toLowerCase().includes(term.toLowerCase()),
        )
        .map((h) => ({ name: configHostLine(h), value: h.alias })),
  });
}

/** Choose a private key from ~/.ssh, browse, or type a path. */
export async function pickKey(savedPath?: string | null): Promise<string> {
  const keys = findSshKeys();
  const MANUAL = '__manual__';
  const choices = keys.map((k) => ({ name: `${tilde(k)}`, value: k }));
  choices.push({ name: tr.wizard.keyManualChoice, value: MANUAL });
  const pick = await ui.choose<string>({
    message: tr.wizard.keyPrompt(keys.length),
    choices,
    ...(savedPath && keys.includes(expandHome(savedPath))
      ? { default: expandHome(savedPath) }
      : {}),
  });
  if (pick !== MANUAL) return pick;
  const manual = await ui.text({
    message: tr.wizard.keyPathPrompt,
    default: savedPath ?? '~/.ssh/id_rsa',
    validate: (v) =>
      fs.existsSync(expandHome(v.trim())) ? true : tr.wizard.keyNotFound(expandHome(v.trim())),
  });
  return expandHome(manual.trim());
}

/** Ask for the connection target (where + how to auth). */
export async function askConnectionTarget(
  defaults: Partial<ConnectionTarget> = {},
): Promise<ConnectionTarget> {
  const s = settings.get();
  ui.printSection('🌐', tr.wizard.connectSection);

  const hostMode = await ui.choose<'manual' | 'sshconfig'>({
    message: tr.wizard.hostModePrompt,
    choices: [
      {
        name: tr.wizard.hostModeSshConfig,
        value: 'sshconfig',
        description: tr.wizard.hostModeSshConfigDesc,
      },
      {
        name: tr.wizard.hostModeManual,
        value: 'manual',
        description: tr.wizard.hostModeManualDesc,
      },
    ],
    default: defaults.hostMode ?? 'manual',
  });

  if (hostMode === 'sshconfig') {
    const sshHost = await pickSshAlias(defaults.sshHost);
    return {
      hostMode,
      sshHost,
      host: defaults.host ?? '',
      user: defaults.user ?? '',
      sshPort: defaults.sshPort ?? 22,
      auth: 'agent',
      keyPath: defaults.keyPath ?? null,
      secretId: defaults.secretId ?? null,
    };
  }

  const host = await ui.text({
    message: tr.wizard.hostPrompt,
    default: defaults.host,
    validate: (v) => isValidHostOrIp(v.trim()) || tr.wizard.hostValidate,
  });
  const user = await ui.text({
    message: tr.wizard.userPrompt,
    default: defaults.user || s.defaultUser,
    validate: (v) => v.trim().length > 0 || tr.common.notEmpty,
  });
  const sshPortStr = await ui.text({
    message: tr.wizard.sshPortPrompt,
    default: String(defaults.sshPort ?? s.defaultSshPort),
    validate: portValidate,
  });
  const auth = await ui.choose<'agent' | 'key' | 'password'>({
    message: tr.wizard.authPrompt,
    choices: [
      {
        name: tr.wizard.authAgent,
        value: 'agent',
        description: tr.wizard.authAgentDesc,
      },
      { name: tr.wizard.authKey, value: 'key', description: tr.wizard.authKeyDesc },
      {
        name: tr.wizard.authPassword,
        value: 'password',
        description: tr.wizard.authPasswordDesc,
      },
    ],
    default: defaults.auth ?? s.defaultAuth,
  });
  const keyPath = auth === 'key' ? await pickKey(defaults.keyPath) : null;

  return {
    hostMode,
    sshHost: '',
    host: host.trim(),
    user: user.trim(),
    sshPort: Number(sshPortStr),
    auth,
    keyPath,
    secretId: defaults.secretId ?? null,
  };
}

/** Connection details for a SERVER. A server is always a ~/.ssh/config Host, so
 *  there is no alias-vs-manual choice — we ask the host fields directly. */
export async function askServerConnection(
  defaults: Partial<ConnectionTarget> = {},
): Promise<ConnectionTarget> {
  const s = settings.get();
  ui.printSection('🌐', tr.wizard.serverConnectSection);
  const host = await ui.text({
    message: tr.wizard.serverHostPrompt,
    default: defaults.host,
    validate: (v) => isValidHostOrIp(v.trim()) || tr.wizard.hostValidate,
  });
  const user = await ui.text({
    message: tr.wizard.userPrompt,
    default: defaults.user || s.defaultUser,
    validate: (v) => v.trim().length > 0 || tr.common.notEmpty,
  });
  const sshPortStr = await ui.text({
    message: tr.wizard.sshPortPrompt,
    default: String(defaults.sshPort ?? s.defaultSshPort),
    validate: portValidate,
  });
  const auth = await ui.choose<'agent' | 'key' | 'password'>({
    message: tr.wizard.authPrompt,
    choices: [
      { name: tr.wizard.authAgent, value: 'agent', description: tr.wizard.authAgentDesc },
      {
        name: tr.wizard.serverAuthKeyIdentity,
        value: 'key',
        description: tr.wizard.serverAuthKeyIdentityDesc,
      },
      {
        name: tr.wizard.authPassword,
        value: 'password',
        description: tr.wizard.serverAuthPasswordDesc,
      },
    ],
    default: defaults.auth ?? s.defaultAuth,
  });
  const keyPath = auth === 'key' ? await pickKey(defaults.keyPath) : null;
  return {
    hostMode: 'sshconfig',
    sshHost: '',
    host: host.trim(),
    user: user.trim(),
    sshPort: Number(sshPortStr),
    auth,
    keyPath,
    secretId: defaults.secretId ?? null,
  };
}

/** Description + tags (the parts that ride in the `#wssh` comment). */
export async function askAnnotations(
  defaults: { description?: string; tags?: string[] } = {},
): Promise<{ description: string; tags: string[] }> {
  ui.printSection('🏷', tr.wizard.annotationsSection);
  const description = await ui.text({
    message: tr.wizard.descriptionPrompt,
    default: defaults.description ?? '',
  });
  const tags = parseTags(
    await ui.text({
      message: tr.wizard.tagsPrompt,
      default: (defaults.tags ?? []).join(', '),
    }),
  );
  return { description, tags };
}

export interface ForwardAnswers {
  type: ForwardType;
  localPort: number;
  remoteHost: string;
  remotePort: number | null;
  openBrowser: boolean;
}

export async function askForward(defaults: Partial<Tunnel> = {}): Promise<ForwardAnswers> {
  const s = settings.get();
  ui.printSection('🚇', tr.wizard.forwardSection);
  const type = await ui.choose<ForwardType>({
    message: tr.wizard.forwardTypePrompt,
    choices: [
      {
        name: '-L  Local',
        value: 'local',
        description: tr.wizard.forwardLocalDesc,
      },
      {
        name: '-R  Remote (reverse)',
        value: 'remote',
        description: tr.wizard.forwardRemoteDesc,
      },
      { name: '-D  Dynamic', value: 'dynamic', description: tr.wizard.forwardDynamicDesc },
    ],
    default: defaults.type ?? 'local',
  });

  if (type === 'dynamic') {
    const localPort = Number(
      await ui.text({
        message: tr.wizard.socksPortPrompt,
        default: String(defaults.localPort || 1080),
        validate: portValidate,
      }),
    );
    return {
      type,
      localPort,
      remoteHost: s.defaultRemoteHost,
      remotePort: null,
      openBrowser: false,
    };
  }

  if (type === 'remote') {
    const remotePort = Number(
      await ui.text({
        message: tr.wizard.remotePortPrompt,
        default: defaults.remotePort ? String(defaults.remotePort) : '',
        validate: portValidate,
      }),
    );
    const remoteHost =
      (
        await ui.text({
          message: tr.wizard.remoteTargetHostPrompt,
          default: defaults.remoteHost || 'localhost',
          validate: (v) => !v.trim() || isValidForwardHost(v.trim()) || tr.wizard.invalidHost,
        })
      ).trim() || 'localhost';
    const localPort = Number(
      await ui.text({
        message: tr.wizard.remoteTargetPortPrompt,
        default: defaults.localPort ? String(defaults.localPort) : '',
        validate: portValidate,
      }),
    );
    return { type, localPort, remoteHost, remotePort, openBrowser: false };
  }

  const remotePort = Number(
    await ui.text({
      message: tr.wizard.servicePortPrompt,
      default: defaults.remotePort ? String(defaults.remotePort) : '',
      validate: portValidate,
    }),
  );
  const remoteHost =
    (
      await ui.text({
        message: tr.wizard.serviceHostPrompt,
        default: defaults.remoteHost || s.defaultRemoteHost,
        validate: (v) => !v.trim() || isValidForwardHost(v.trim()) || tr.wizard.invalidHost,
      })
    ).trim() || '127.0.0.1';
  const localPort = Number(
    await ui.text({
      message: tr.wizard.localPortPrompt,
      default: String(defaults.localPort || defaults.remotePort || ''),
      validate: portValidate,
    }),
  );
  const openBrowser = await ui.confirm({
    message: tr.wizard.openBrowserPrompt,
    default: defaults.openBrowser ?? s.openBrowser,
  });
  return { type, localPort, remoteHost, remotePort, openBrowser };
}

export interface MetaAnswers {
  name: string;
  description: string;
  tags: string[];
}

export async function askMeta(
  defaults: { name?: string; description?: string; tags?: string[] },
  nameTaken: (name: string) => boolean,
  suggested?: string,
): Promise<MetaAnswers> {
  ui.printSection('🏷', tr.wizard.metaSection);
  const name = (
    await ui.text({
      message: tr.wizard.namePrompt,
      default: defaults.name || suggested,
      validate: (v) => {
        const t = v.trim();
        if (!isValidName(t)) return tr.wizard.nameInvalid;
        if (nameTaken(t)) return tr.wizard.nameTaken(t);
        return true;
      },
    })
  ).trim();
  const description = await ui.text({
    message: tr.wizard.descriptionPrompt,
    default: defaults.description ?? '',
  });
  const tagsStr = await ui.text({
    message: tr.wizard.metaTagsPrompt,
    default: (defaults.tags ?? []).join(', '),
  });
  return { name, description, tags: parseTags(tagsStr) };
}

export { slugify };
