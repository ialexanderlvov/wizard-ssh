/** Reusable prompt blocks for creating/editing servers and tunnels. */

import fs from 'node:fs';
import type { ConnectionTarget, ForwardType, Tunnel } from '../core/types.js';
import { settings } from '../store/settings.store.js';
import { findSshKeys } from '../ssh/keys.js';
import * as sshConfig from '../ssh-config/index.js';
import * as ui from '../ui/index.js';
import { configHostLine } from '../ui/format.js';
import { isValidHostOrIp, isValidName, isValidPort, isValidSshAlias } from '../utils/validators.js';
import { expandHome, parseTags, slugify, tilde } from '../utils/strings.js';

const portValidate = (v: string): boolean | string => isValidPort(v) || 'Порт должен быть 1..65535';

/** Fuzzy-pick a ~/.ssh/config alias (or type a new one). */
export async function pickSshAlias(current?: string): Promise<string> {
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn('В ~/.ssh/config нет хостов — введите алиас вручную.');
    return ui.text({
      message: '🔗 Алиас хоста',
      default: current,
      validate: (v) => isValidSshAlias(v) || 'Только буквы, цифры, . _ -',
    });
  }
  return ui.searchChoose<string>({
    message: '🔗 Хост из ~/.ssh/config (печатай для поиска)',
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
  choices.push({ name: 'Ввести путь вручную', value: MANUAL });
  const pick = await ui.choose<string>({
    message: `🗝 Приватный SSH-ключ${keys.length ? ` (найдено: ${keys.length})` : ''}`,
    choices,
    ...(savedPath && keys.includes(expandHome(savedPath))
      ? { default: expandHome(savedPath) }
      : {}),
  });
  if (pick !== MANUAL) return pick;
  const manual = await ui.text({
    message: '📁 Путь до приватного ключа',
    default: savedPath ?? '~/.ssh/id_rsa',
    validate: (v) =>
      fs.existsSync(expandHome(v.trim())) ? true : `Файл не найден: ${expandHome(v.trim())}`,
  });
  return expandHome(manual.trim());
}

/** Ask for the connection target (where + how to auth). */
export async function askConnectionTarget(
  defaults: Partial<ConnectionTarget> = {},
): Promise<ConnectionTarget> {
  const s = settings.get();
  ui.printSection('🌐', 'Куда подключаемся');

  const hostMode = await ui.choose<'manual' | 'sshconfig'>({
    message: '🧭 Способ адресации хоста',
    choices: [
      {
        name: 'Алиас из ~/.ssh/config',
        value: 'sshconfig',
        description: 'user/port/key берутся из конфига',
      },
      { name: 'IP / домен', value: 'manual', description: 'указать вручную' },
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
    message: '🖥 IP или домен',
    default: defaults.host,
    validate: (v) => isValidHostOrIp(v.trim()) || 'Введите валидный IP или домен',
  });
  const user = await ui.text({
    message: '👤 SSH-пользователь',
    default: defaults.user || s.defaultUser,
    validate: (v) => v.trim().length > 0 || 'Не может быть пустым',
  });
  const sshPortStr = await ui.text({
    message: '🔌 SSH-порт',
    default: String(defaults.sshPort ?? s.defaultSshPort),
    validate: portValidate,
  });
  const auth = await ui.choose<'agent' | 'key' | 'password'>({
    message: '🔐 Как авторизуемся?',
    choices: [
      {
        name: 'ssh-agent / по умолчанию',
        value: 'agent',
        description: 'ничего вводить не нужно',
      },
      { name: 'SSH-ключ', value: 'key', description: 'указать файл' },
      {
        name: 'Пароль',
        value: 'password',
        description: 'можно сохранить в зашифрованном хранилище',
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

export interface ForwardAnswers {
  type: ForwardType;
  localPort: number;
  remoteHost: string;
  remotePort: number | null;
  openBrowser: boolean;
}

export async function askForward(defaults: Partial<Tunnel> = {}): Promise<ForwardAnswers> {
  const s = settings.get();
  ui.printSection('🚇', 'Что пробрасываем');
  const type = await ui.choose<ForwardType>({
    message: '🎯 Тип проброса',
    choices: [
      {
        name: '-L  Local',
        value: 'local',
        description: 'открыть удалённый сервис у себя (частое)',
      },
      {
        name: '-R  Remote (reverse)',
        value: 'remote',
        description: 'открыть локальный сервис на сервере',
      },
      { name: '-D  Dynamic', value: 'dynamic', description: 'SOCKS5-прокси на локальном порту' },
    ],
    default: defaults.type ?? 'local',
  });

  if (type === 'dynamic') {
    const localPort = Number(
      await ui.text({
        message: '🧦 Локальный порт SOCKS-прокси',
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
        message: '🛰 Порт на сервере (откроется удалённо)',
        default: defaults.remotePort ? String(defaults.remotePort) : '',
        validate: portValidate,
      }),
    );
    const remoteHost =
      (
        await ui.text({
          message: '🏠 Локальная цель — хост',
          default: defaults.remoteHost || 'localhost',
        })
      ).trim() || 'localhost';
    const localPort = Number(
      await ui.text({
        message: '🔢 Локальная цель — порт',
        default: defaults.localPort ? String(defaults.localPort) : '',
        validate: portValidate,
      }),
    );
    return { type, localPort, remoteHost, remotePort, openBrowser: false };
  }

  const remotePort = Number(
    await ui.text({
      message: '🎯 Порт сервиса на сервере (127.0.0.1 на сервере)',
      default: defaults.remotePort ? String(defaults.remotePort) : '',
      validate: portValidate,
    }),
  );
  const remoteHost =
    (
      await ui.text({
        message: '🌐 Хост сервиса на сервере (обычно 127.0.0.1)',
        default: defaults.remoteHost || s.defaultRemoteHost,
      })
    ).trim() || '127.0.0.1';
  const localPort = Number(
    await ui.text({
      message: '🏠 Локальный порт (откроется у тебя)',
      default: String(defaults.localPort || defaults.remotePort || ''),
      validate: portValidate,
    }),
  );
  const openBrowser = await ui.confirm({
    message: '🌍 Открывать браузер при подключении?',
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
  ui.printSection('🏷', 'Название и метки');
  const name = (
    await ui.text({
      message: '🏷 Имя (уникальное, для быстрого доступа)',
      default: defaults.name || suggested,
      validate: (v) => {
        const t = v.trim();
        if (!isValidName(t)) return '1–64 символа: буквы, цифры, пробел и . @ : - _';
        if (nameTaken(t)) return `Имя «${t}» уже занято`;
        return true;
      },
    })
  ).trim();
  const description = await ui.text({
    message: '📝 Описание (необязательно)',
    default: defaults.description ?? '',
  });
  const tagsStr = await ui.text({
    message: '#️⃣ Теги через запятую (необязательно)',
    default: (defaults.tags ?? []).join(', '),
  });
  return { name, description, tags: parseTags(tagsStr) };
}

export { slugify };
