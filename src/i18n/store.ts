/**
 * Translation store built on i18n-typed-store.
 *
 * Unlike the typical web setup (lazy `import()` per locale), a CLI is bundled by
 * tsup into a single file and must render synchronously, so every locale module
 * is imported eagerly here and the loader just hands back the already-resolved
 * object. The store still drives locale resolution (BCP 47 matching), fallback
 * merging and change events — we only swap lazy loading for eager loading.
 *
 * Adding a namespace = add its ru/en imports to MODULES, its `Dict` to
 * `Translations`, an entry to `namespaces`, and a getter to `tr` (see index.ts).
 */

import { createTranslationStore } from 'i18n-typed-store';

import commonRu from './translations/common/ru.js';
import commonEn from './translations/common/en.js';
import errorsRu from './translations/errors/ru.js';
import errorsEn from './translations/errors/en.js';
import uiRu from './translations/ui/ru.js';
import uiEn from './translations/ui/en.js';
import cliRu from './translations/cli/ru.js';
import cliEn from './translations/cli/en.js';
import menuRu from './translations/menu/ru.js';
import menuEn from './translations/menu/en.js';
import helpersRu from './translations/helpers/ru.js';
import helpersEn from './translations/helpers/en.js';
import actionsRu from './translations/actions/ru.js';
import actionsEn from './translations/actions/en.js';
import importExportRu from './translations/importExport/ru.js';
import importExportEn from './translations/importExport/en.js';
import configRu from './translations/config/ru.js';
import configEn from './translations/config/en.js';
import noninteractiveRu from './translations/noninteractive/ru.js';
import noninteractiveEn from './translations/noninteractive/en.js';
import connectRu from './translations/connect/ru.js';
import connectEn from './translations/connect/en.js';
import infoRu from './translations/info/ru.js';
import infoEn from './translations/info/en.js';
import searchRu from './translations/search/ru.js';
import searchEn from './translations/search/en.js';
import doctorRu from './translations/doctor/ru.js';
import doctorEn from './translations/doctor/en.js';
import serversRu from './translations/servers/ru.js';
import serversEn from './translations/servers/en.js';
import tunnelsRu from './translations/tunnels/ru.js';
import tunnelsEn from './translations/tunnels/en.js';
import keysRu from './translations/keys/ru.js';
import keysEn from './translations/keys/en.js';
import settingsRu from './translations/settings/ru.js';
import settingsEn from './translations/settings/en.js';
import cmdRu from './translations/cmd/ru.js';
import cmdEn from './translations/cmd/en.js';
import sshRu from './translations/ssh/ru.js';
import sshEn from './translations/ssh/en.js';
import vaultRu from './translations/vault/ru.js';
import vaultEn from './translations/vault/en.js';
import wizardRu from './translations/wizard/ru.js';
import wizardEn from './translations/wizard/en.js';

import type { Dict as CommonDict } from './translations/common/ru.js';
import type { Dict as ErrorsDict } from './translations/errors/ru.js';
import type { Dict as UiDict } from './translations/ui/ru.js';
import type { Dict as CliDict } from './translations/cli/ru.js';
import type { Dict as MenuDict } from './translations/menu/ru.js';
import type { Dict as HelpersDict } from './translations/helpers/ru.js';
import type { Dict as ActionsDict } from './translations/actions/ru.js';
import type { Dict as ImportExportDict } from './translations/importExport/ru.js';
import type { Dict as ConfigDict } from './translations/config/ru.js';
import type { Dict as NoninteractiveDict } from './translations/noninteractive/ru.js';
import type { Dict as ConnectDict } from './translations/connect/ru.js';
import type { Dict as InfoDict } from './translations/info/ru.js';
import type { Dict as SearchDict } from './translations/search/ru.js';
import type { Dict as DoctorDict } from './translations/doctor/ru.js';
import type { Dict as ServersDict } from './translations/servers/ru.js';
import type { Dict as TunnelsDict } from './translations/tunnels/ru.js';
import type { Dict as KeysDict } from './translations/keys/ru.js';
import type { Dict as SettingsDict } from './translations/settings/ru.js';
import type { Dict as CmdDict } from './translations/cmd/ru.js';
import type { Dict as SshDict } from './translations/ssh/ru.js';
import type { Dict as VaultDict } from './translations/vault/ru.js';
import type { Dict as WizardDict } from './translations/wizard/ru.js';

export const locales = { ru: 'ru', en: 'en' } as const;
export type AppLocale = keyof typeof locales;

export const namespaces = {
  common: 'common',
  errors: 'errors',
  ui: 'ui',
  cli: 'cli',
  menu: 'menu',
  helpers: 'helpers',
  actions: 'actions',
  importExport: 'importExport',
  config: 'config',
  noninteractive: 'noninteractive',
  connect: 'connect',
  info: 'info',
  search: 'search',
  doctor: 'doctor',
  servers: 'servers',
  tunnels: 'tunnels',
  keys: 'keys',
  settings: 'settings',
  cmd: 'cmd',
  ssh: 'ssh',
  vault: 'vault',
  wizard: 'wizard',
} as const;
export type Namespace = keyof typeof namespaces;

export interface Translations {
  common: CommonDict;
  errors: ErrorsDict;
  ui: UiDict;
  cli: CliDict;
  menu: MenuDict;
  helpers: HelpersDict;
  actions: ActionsDict;
  importExport: ImportExportDict;
  config: ConfigDict;
  noninteractive: NoninteractiveDict;
  connect: ConnectDict;
  info: InfoDict;
  search: SearchDict;
  doctor: DoctorDict;
  servers: ServersDict;
  tunnels: TunnelsDict;
  keys: KeysDict;
  settings: SettingsDict;
  cmd: CmdDict;
  ssh: SshDict;
  vault: VaultDict;
  wizard: WizardDict;
}

/** Eagerly-imported locale modules, keyed by namespace then locale. */
export const MODULES: { [K in Namespace]: Record<AppLocale, Translations[K]> } = {
  common: { ru: commonRu, en: commonEn },
  errors: { ru: errorsRu, en: errorsEn },
  ui: { ru: uiRu, en: uiEn },
  cli: { ru: cliRu, en: cliEn },
  menu: { ru: menuRu, en: menuEn },
  helpers: { ru: helpersRu, en: helpersEn },
  actions: { ru: actionsRu, en: actionsEn },
  importExport: { ru: importExportRu, en: importExportEn },
  config: { ru: configRu, en: configEn },
  noninteractive: { ru: noninteractiveRu, en: noninteractiveEn },
  connect: { ru: connectRu, en: connectEn },
  info: { ru: infoRu, en: infoEn },
  search: { ru: searchRu, en: searchEn },
  doctor: { ru: doctorRu, en: doctorEn },
  servers: { ru: serversRu, en: serversEn },
  tunnels: { ru: tunnelsRu, en: tunnelsEn },
  keys: { ru: keysRu, en: keysEn },
  settings: { ru: settingsRu, en: settingsEn },
  cmd: { ru: cmdRu, en: cmdEn },
  ssh: { ru: sshRu, en: sshEn },
  vault: { ru: vaultRu, en: vaultEn },
  wizard: { ru: wizardRu, en: wizardEn },
};

export const DEFAULT_LOCALE: AppLocale = 'ru';

const factory = createTranslationStore({
  namespaces,
  locales,
  loadModule: async (locale, namespace) => MODULES[namespace as Namespace][locale as AppLocale],
  extractTranslation: (module) => module,
  defaultLocale: DEFAULT_LOCALE,
  useFallback: true,
  fallbackLocale: DEFAULT_LOCALE,
});

export const store = factory.type<Translations>();

export const NAMESPACE_KEYS = Object.keys(namespaces) as Namespace[];
