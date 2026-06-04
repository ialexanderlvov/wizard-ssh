/**
 * Public i18n surface. `tr` is the synchronous accessor used everywhere:
 *
 *   import { tr } from '../i18n/index.js';
 *   tr.common.cancelled;            // string
 *   tr.cli.helpAfter(dataDir);      // interpolated via a function entry
 *
 * Before `initI18n()` runs (e.g. in unit tests that import a module directly)
 * `tr` falls back to the eager default-locale module, so output is never
 * undefined and the existing Russian behaviour holds without explicit setup.
 */

import { findBestLocaleMatch } from 'i18n-typed-store';
import { settings } from '../store/settings.store.js';
import {
  store,
  locales,
  MODULES,
  NAMESPACE_KEYS,
  DEFAULT_LOCALE,
  type AppLocale,
  type Namespace,
  type Translations,
} from './store.js';

export type { AppLocale } from './store.js';
export const availableLocales = Object.keys(locales) as AppLocale[];

function current<K extends Namespace>(key: K): Translations[K] {
  return (store.translations[key].currentTranslation ??
    MODULES[key][DEFAULT_LOCALE]) as Translations[K];
}

export const tr = {
  get common() {
    return current('common');
  },
  get errors() {
    return current('errors');
  },
  get ui() {
    return current('ui');
  },
  get cli() {
    return current('cli');
  },
  get menu() {
    return current('menu');
  },
  get helpers() {
    return current('helpers');
  },
  get actions() {
    return current('actions');
  },
  get importExport() {
    return current('importExport');
  },
  get config() {
    return current('config');
  },
  get noninteractive() {
    return current('noninteractive');
  },
  get connect() {
    return current('connect');
  },
  get info() {
    return current('info');
  },
  get search() {
    return current('search');
  },
  get doctor() {
    return current('doctor');
  },
  get servers() {
    return current('servers');
  },
  get tunnels() {
    return current('tunnels');
  },
  get keys() {
    return current('keys');
  },
  get settings() {
    return current('settings');
  },
  get cmd() {
    return current('cmd');
  },
  get ssh() {
    return current('ssh');
  },
  get vault() {
    return current('vault');
  },
  get wizard() {
    return current('wizard');
  },
};

/** Normalise a raw env/OS tag ("en_US.UTF-8", "ru_RU") to a BCP 47-ish string. */
function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/[.@].*$/, '')
    .replace(/_/g, '-');
}

function systemLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the active locale. Precedence:
 *   1. WSSH_LANG (explicit override)
 *   2. settings.language (when not `system`)
 *   3. LC_ALL / LANG / OS locale
 *   4. DEFAULT_LOCALE
 */
export function resolveLocale(): AppLocale {
  const pref = settings.get().language;
  const candidates = [
    process.env.WSSH_LANG,
    pref !== 'system' ? pref : undefined,
    process.env.LC_ALL,
    process.env.LANG,
    systemLocale(),
  ].filter((v): v is string => Boolean(v && v.trim()));

  for (const c of candidates) {
    const match = findBestLocaleMatch(normalizeTag(c), locales);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

let activeLocale: AppLocale = DEFAULT_LOCALE;
export const currentLocale = (): AppLocale => activeLocale;

/** Load every namespace for `locale` so `tr` resolves synchronously after. */
async function loadAll(locale: AppLocale): Promise<void> {
  store.changeLocale(locale);
  await Promise.all(NAMESPACE_KEYS.map((ns) => store.translations[ns].load(locale)));
  activeLocale = locale;
}

/** Resolve + load the startup locale. Call once at the top of `main()`. */
export async function initI18n(locale: AppLocale = resolveLocale()): Promise<AppLocale> {
  await loadAll(locale);
  return locale;
}

/** Switch language at runtime (e.g. from the settings menu) and persist it. */
export async function setLocale(locale: AppLocale, persist = true): Promise<void> {
  if (persist) settings.update({ language: locale });
  await loadAll(locale);
}
