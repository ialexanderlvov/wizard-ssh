/** Default settings (as an editable menu) + password-vault management. */

import type { AuthMethod, Entity, LanguageSetting, SortKey } from '../core/types.js';
import { settings } from '../store/settings.store.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { vault } from '../vault/vault.js';
import * as ui from '../ui/index.js';
import { isValidPort } from '../utils/validators.js';
import { ensureVaultSetup, unlockVault } from './helpers.js';
import { tr, setLocale, resolveLocale } from '../i18n/index.js';

interface Row {
  label: string;
  value: string;
}

const pick = async (
  message: string,
  rows: Row[],
  crumbs: string[] = [tr.menu.root],
): Promise<string | typeof ui.BACK> => {
  const res = await ui.pickFromList<Row>({
    message,
    items: rows,
    render: (r) => r.label,
    search: (r) => r.label,
    pageSize: 14,
    crumbs,
    indent: crumbs.length * 2,
  });
  return res === ui.BACK ? ui.BACK : res.value;
};

// ---------- settings as an editable menu (#7) ----------

async function editSetting(key: string): Promise<void> {
  const s = settings.get();
  if (key === 'defaultUser') {
    settings.update({
      defaultUser: (
        await ui.text({ message: tr.settings.defaultUserPrompt, default: s.defaultUser })
      ).trim(),
    });
  } else if (key === 'defaultSshPort') {
    const v = await ui.text({
      message: tr.settings.defaultSshPortPrompt,
      default: String(s.defaultSshPort),
      validate: (x) => isValidPort(x) || '1..65535',
    });
    settings.update({ defaultSshPort: Number(v) });
  } else if (key === 'defaultAuth') {
    settings.update({
      defaultAuth: await ui.choose<AuthMethod>({
        message: tr.settings.defaultAuthPrompt,
        choices: [
          { name: tr.settings.authAgent, value: 'agent' },
          { name: tr.settings.authKey, value: 'key' },
          { name: tr.settings.authPassword, value: 'password' },
        ],
        default: s.defaultAuth,
      }),
    });
  } else if (key === 'defaultRemoteHost') {
    settings.update({
      defaultRemoteHost: (
        await ui.text({
          message: tr.settings.defaultRemoteHostPrompt,
          default: s.defaultRemoteHost,
        })
      ).trim(),
    });
  } else if (key === 'openBrowser') {
    settings.update({
      openBrowser: await ui.confirm({
        message: tr.settings.openBrowserPrompt,
        default: s.openBrowser,
      }),
    });
  } else if (key === 'tunnelAutoReconnect') {
    settings.update({
      tunnelAutoReconnect: await ui.confirm({
        message: tr.settings.tunnelAutoReconnectPrompt,
        default: s.tunnelAutoReconnect,
      }),
    });
  } else if (key === 'defaultSort') {
    settings.update({
      defaultSort: await ui.choose<SortKey>({
        message: tr.settings.defaultSortPrompt,
        choices: [
          { name: tr.settings.sortRecent, value: 'recent' },
          { name: tr.settings.sortName, value: 'name' },
          { name: tr.settings.sortUses, value: 'uses' },
          { name: tr.settings.sortCreated, value: 'created' },
          { name: tr.settings.sortUpdated, value: 'updated' },
        ],
        default: s.defaultSort,
      }),
    });
  } else if (key === 'language') {
    const choice = await ui.choose<LanguageSetting>({
      message: tr.settings.languagePrompt,
      choices: [
        { name: tr.settings.langSystem, value: 'system' },
        { name: tr.settings.langRu, value: 'ru' },
        { name: tr.settings.langEn, value: 'en' },
      ],
      default: s.language,
    });
    settings.update({ language: choice });
    // `system` re-resolves from env/OS; an explicit choice loads that locale.
    await setLocale(choice === 'system' ? resolveLocale() : choice, false);
  }
  ui.printOk(tr.settings.saved);
}

export async function settingsFlow(): Promise<void> {
  ui.ensureInteractive(tr.settings.ensureSettings);
  const sortLabels: Record<SortKey, string> = {
    recent: tr.settings.sortLabelRecent,
    name: tr.settings.sortLabelName,
    uses: tr.settings.sortLabelUses,
    created: tr.settings.sortLabelCreated,
    updated: tr.settings.sortLabelUpdated,
  };
  const langLabels: Record<LanguageSetting, string> = {
    system: tr.settings.langSystem,
    ru: tr.settings.langRu,
    en: tr.settings.langEn,
  };
  for (;;) {
    ui.clearScreen();
    const s = settings.get();
    const rows: Row[] = [
      { value: 'defaultUser', label: tr.settings.labelDefaultUser(ui.chalk.cyan(s.defaultUser)) },
      {
        value: 'defaultSshPort',
        label: tr.settings.labelDefaultSshPort(ui.chalk.cyan(String(s.defaultSshPort))),
      },
      {
        value: 'defaultAuth',
        label: tr.settings.labelDefaultAuth(ui.chalk.cyan(s.defaultAuth)),
      },
      {
        value: 'defaultRemoteHost',
        label: tr.settings.labelDefaultRemoteHost(ui.chalk.cyan(s.defaultRemoteHost)),
      },
      {
        value: 'openBrowser',
        label: tr.settings.labelOpenBrowser(
          ui.chalk.cyan(s.openBrowser ? tr.common.yes : tr.common.no),
        ),
      },
      {
        value: 'tunnelAutoReconnect',
        label: tr.settings.labelTunnelAutoReconnect(
          ui.chalk.cyan(s.tunnelAutoReconnect ? tr.common.yes : tr.common.no),
        ),
      },
      {
        value: 'defaultSort',
        label: tr.settings.labelDefaultSort(ui.chalk.cyan(sortLabels[s.defaultSort])),
      },
      {
        value: 'language',
        label: tr.settings.labelLanguage(ui.chalk.cyan(langLabels[s.language])),
      },
    ];
    const key = await pick(tr.settings.settingsMenuPrompt, rows);
    if (key === ui.BACK) return;
    await editSetting(key);
  }
}

// ---------- vault ----------

function vaultStatus(): void {
  const supported = vault.touchIdSupported();
  ui.printSection('🔐', tr.settings.vaultSection);
  ui.printInfo(
    tr.settings.vaultStatusLine(
      vault.exists()
        ? ui.chalk.green(tr.settings.vaultStateCreated)
        : ui.chalk.dim(tr.settings.vaultStateNotCreated),
      vault.isUnlocked()
        ? ui.chalk.green(tr.settings.vaultStateUnlocked)
        : ui.chalk.yellow(tr.settings.vaultStateLocked),
      tr.settings.vaultSecretsCount(vault.secretCount()),
    ),
  );
  ui.printInfo(
    tr.settings.touchIdLine(
      vault.isTouchIdEnabled()
        ? ui.chalk.green(tr.settings.touchIdEnabled)
        : ui.chalk.dim(tr.settings.touchIdDisabled),
      supported ? '' : ui.chalk.dim(tr.settings.touchIdUnavailable),
    ),
  );
}

/** A connection (server / tunnel / temp tunnel) that has a saved password. */
interface SecretHolder {
  kindLabel: string;
  entity: Entity;
  /** drop the secretId on the owning store (keeps the entity itself) */
  clear: () => void;
}

function secretHolders(): SecretHolder[] {
  const out: SecretHolder[] = [];
  for (const e of servers.all())
    if (e.secretId)
      out.push({
        kindLabel: tr.common.server,
        entity: e,
        clear: () => servers.update(e.id, { secretId: null }),
      });
  for (const e of tunnels.all())
    if (e.secretId)
      out.push({
        kindLabel: tr.common.tunnel,
        entity: e,
        clear: () => void tunnels.update(e.id, { secretId: null }),
      });
  for (const e of tempTunnels.all())
    if (e.secretId)
      out.push({
        kindLabel: tr.settings.kindLabelTempTunnel,
        entity: e,
        clear: () => void tempTunnels.update(e.id, { secretId: null }),
      });
  return out;
}

async function pickSecretHolder(message: string): Promise<SecretHolder | null> {
  const holders = secretHolders();
  if (!holders.length) {
    ui.printWarn(tr.settings.noSavedPasswords);
    return null;
  }
  const picked = await ui.pickFromList<SecretHolder>({
    message,
    items: holders,
    render: (h) => `${ui.chalk.dim(h.kindLabel)}  ${ui.chalk.bold(h.entity.name)}`,
    search: (h) => h.entity.name,
    pageSize: 14,
  });
  return picked === ui.BACK ? null : picked;
}

/** Reveal the plaintext of a saved password (vault must be unlocked first). */
async function revealSavedPassword(): Promise<void> {
  const picked = await pickSecretHolder(tr.settings.pickRevealPrompt);
  if (!picked) return;
  const id = picked.entity.secretId;
  if (!id) return;
  if (
    !(await ui.confirm({
      message: tr.settings.confirmReveal(picked.entity.name),
      default: false,
    }))
  ) {
    ui.printInfo(tr.common.cancelled);
    return;
  }
  if (!(await unlockVault())) {
    ui.printWarn(tr.settings.vaultNotUnlockedReveal);
    return;
  }
  const pw = vault.getSecret(id);
  if (pw == null) {
    ui.printWarn(tr.settings.secretNotFound);
    return;
  }
  ui.printOk(tr.settings.revealHeader(picked.entity.name));
  console.log('  ' + ui.chalk.bold.yellow(pw));
  ui.printInfo(tr.settings.revealHint);
}

/** #6 — remove a saved password (keeps the server/tunnel; will ask next time). */
async function deleteSavedPassword(): Promise<void> {
  const picked = await pickSecretHolder(tr.settings.pickDeletePrompt);
  if (!picked) return;
  vault.removeSecret(picked.entity.secretId);
  picked.clear();
  ui.printOk(tr.settings.passwordDeleted(picked.entity.name));
}

/** #6 — wipe the vault when the passphrase is forgotten; entities keep their data. */
async function resetVault(): Promise<void> {
  const ok = await ui.confirm({
    message: ui.chalk.red(tr.settings.confirmReset),
    default: false,
  });
  if (!ok) {
    ui.printInfo(tr.common.cancelled);
    return;
  }
  vault.reset();
  servers.all().forEach((e) => e.secretId && servers.update(e.id, { secretId: null }));
  tunnels.all().forEach((e) => e.secretId && tunnels.update(e.id, { secretId: null }));
  tempTunnels.all().forEach((e) => e.secretId && tempTunnels.update(e.id, { secretId: null }));
  settings.update({ vault: { enabled: false, touchId: false } });
  ui.printOk(tr.settings.resetDone);
}

export async function vaultFlow(): Promise<void> {
  ui.ensureInteractive(tr.settings.ensureVault);
  for (;;) {
    ui.clearScreen();
    vaultStatus();
    const exists = vault.exists();
    const rows: Row[] = [
      ...(!exists ? [{ value: 'setup', label: tr.settings.actionSetup }] : []),
      ...(exists && !vault.isUnlocked()
        ? [{ value: 'unlock', label: tr.settings.actionUnlock }]
        : []),
      ...(exists && vault.isUnlocked() ? [{ value: 'lock', label: tr.settings.actionLock }] : []),
      ...(exists ? [{ value: 'rekey', label: tr.settings.actionRekey }] : []),
      // Shown whenever the vault exists (even with 0 secrets) so the feature is
      // discoverable; with nothing saved they just report tr.settings.noSavedPasswords.
      ...(exists
        ? [
            {
              value: 'revealSecret',
              label: vault.secretCount()
                ? tr.settings.actionRevealSecretCount(vault.secretCount())
                : tr.settings.actionRevealSecret,
            },
          ]
        : []),
      ...(exists ? [{ value: 'deleteSecret', label: tr.settings.actionDeleteSecret }] : []),
      ...(exists && vault.touchIdSupported() && !vault.isTouchIdEnabled()
        ? [{ value: 'enableTouch', label: tr.settings.actionEnableTouch }]
        : []),
      ...(exists && vault.isTouchIdEnabled()
        ? [{ value: 'disableTouch', label: tr.settings.actionDisableTouch }]
        : []),
      ...(exists ? [{ value: 'reset', label: tr.settings.actionReset }] : []),
    ];
    const action = await pick(tr.settings.vaultMenuPrompt, rows, [
      tr.menu.root,
      tr.settings.vaultCrumb,
    ]);
    if (action === ui.BACK) return;

    if (action === 'setup') {
      await ensureVaultSetup();
    } else if (action === 'unlock') {
      ui.printInfo((await unlockVault()) ? tr.settings.unlocked : tr.settings.unlockFailed);
    } else if (action === 'lock') {
      vault.lock();
      ui.printOk(tr.settings.sessionCleared);
    } else if (action === 'rekey') {
      if (!(await unlockVault())) {
        ui.printWarn(tr.settings.needUnlockFirst);
      } else {
        const p1 = await ui.secret({
          message: tr.settings.rekeyNewPassphrase,
          validate: (v) => v.length >= 4 || tr.settings.rekeyMinLength,
        });
        const p2 = await ui.secret({ message: tr.settings.rekeyRepeat });
        if (p1 !== p2) ui.printError(tr.settings.rekeyMismatch);
        else {
          try {
            vault.rekey(p1);
            ui.printOk(tr.settings.rekeyDone);
          } catch (e) {
            ui.printError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    } else if (action === 'revealSecret') {
      await revealSavedPassword();
    } else if (action === 'deleteSecret') {
      await deleteSavedPassword();
    } else if (action === 'enableTouch') {
      if (!(await unlockVault())) ui.printWarn(tr.settings.needUnlockTouch);
      else if (vault.enableTouchId()) {
        settings.update({ vault: { ...settings.get().vault, touchId: true } });
        ui.printOk(tr.settings.touchIdOn);
      } else ui.printError(tr.settings.touchIdOnFailed);
    } else if (action === 'disableTouch') {
      vault.disableTouchId();
      settings.update({ vault: { ...settings.get().vault, touchId: false } });
      ui.printOk(tr.settings.touchIdOff);
    } else if (action === 'reset') {
      await resetVault();
    }
    await ui.pause();
  }
}
