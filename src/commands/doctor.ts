/** `wssh doctor` — environment diagnostics: required/optional binaries, data
 *  directory permissions, ~/.ssh/config health and vault status. Consolidates the
 *  checks scattered across preflight/copy-id/transfer into one health report. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, FILES, SSH_DIR, SSH_CONFIG_FILE } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { isMac, isWindows } from '../utils/platform.js';
import { listHosts } from '../ssh-config/index.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { vault } from '../vault/vault.js';
import { listKeys, auditKeys, type KeyAudit, type KeyIssue } from '../ssh/keys.js';
import { expandHome, tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

/** Localized label per key-issue tag (getters so the locale is read at render). */
const KEY_ISSUE_LABEL: Record<KeyIssue, () => string> = {
  'weak-rsa': () => tr.doctor.keyIssueWeakRsa,
  unencrypted: () => tr.doctor.keyIssueUnencrypted,
  'no-pub': () => tr.doctor.keyIssueNoPub,
  orphan: () => tr.doctor.keyIssueOrphan,
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Audit ~/.ssh keys, marking as orphan any not referenced by a server/tunnel. */
export function collectKeyAudit(): KeyAudit[] {
  const referenced = new Set<string>();
  const add = (kp: string | null): void => {
    if (kp) referenced.add(path.resolve(expandHome(kp)));
  };
  for (const s of safe(() => servers.all(), [])) add(s.keyPath);
  for (const t of safe(() => tunnels.all(), [])) add(t.keyPath);
  for (const t of safe(() => tempTunnels.all(), [])) add(t.keyPath);
  return safe(() => auditKeys(referenced), []);
}

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

export function collectChecks(keyAudit: KeyAudit[] = collectKeyAudit()): Check[] {
  const checks: Check[] = [];
  const bin = (name: string, required: boolean, why: string): void => {
    const ok = commandExists(name);
    checks.push({
      label: name,
      status: ok ? 'ok' : required ? 'fail' : 'warn',
      detail: ok ? tr.doctor.binFound : tr.doctor.binNotFound(why),
    });
  };

  checks.push({
    label: 'ssh',
    status: commandExists('ssh') ? 'ok' : 'fail',
    detail: commandExists('ssh') ? sshVersion() || tr.doctor.binFound : tr.doctor.sshMissing,
  });
  bin('scp', false, tr.doctor.whyScp);
  bin('rsync', false, tr.doctor.whyRsync);
  bin('ssh-keygen', false, tr.doctor.whyKeygen);
  bin('ssh-copy-id', false, tr.doctor.whyCopyId);
  bin('sshpass', false, tr.doctor.whySshpass);
  const clip = isMac ? 'pbcopy' : isWindows ? 'clip' : 'xclip/wl-copy';
  const clipOk = ['pbcopy', 'clip', 'xclip', 'wl-copy', 'xsel'].some(commandExists);
  checks.push({
    label: tr.doctor.clipLabel,
    status: clipOk ? 'ok' : 'warn',
    detail: clipOk ? tr.doctor.clipOk : tr.doctor.clipMissing(clip),
  });

  // data dir + perms
  const dm = mode(DATA_DIR);
  checks.push({
    label: tr.doctor.dataDirLabel,
    status: dm == null ? 'warn' : dm === '700' ? 'ok' : 'warn',
    detail: dm == null ? tr.doctor.dataDirMissing(DATA_DIR) : tr.doctor.dataDirPerms(DATA_DIR, dm),
  });
  if (fs.existsSync(FILES.vault)) {
    const vm = mode(FILES.vault);
    checks.push({
      label: tr.doctor.vaultPermsLabel,
      status: vm === '600' ? 'ok' : 'warn',
      detail: vm === '600' ? '600' : tr.doctor.vaultPermsWrong(vm ?? tr.common.dash),
    });
  }

  // ~/.ssh + config
  const sm = mode(SSH_DIR);
  checks.push({
    label: '~/.ssh',
    status: sm == null ? 'warn' : sm === '700' ? 'ok' : 'warn',
    detail: sm == null ? tr.doctor.sshDirMissing : tr.doctor.sshDirPerms(sm),
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
      detail:
        hostsCount < 0
          ? tr.doctor.sshConfigUnparseable
          : tr.doctor.sshConfigOk(hostsCount, cm ?? tr.common.dash),
    });
  } else {
    checks.push({ label: '~/.ssh/config', status: 'warn', detail: tr.doctor.sshConfigMissing });
  }

  // vault / touch id
  checks.push({
    label: tr.doctor.vaultLabel,
    status: 'ok',
    detail: vault.exists() ? tr.doctor.vaultCreated : tr.doctor.vaultNotCreated,
  });
  if (isMac) {
    checks.push({
      label: 'Touch ID',
      status: 'ok',
      detail: vault.touchIdSupported() ? tr.doctor.touchIdSupported : tr.doctor.touchIdUnavailable,
    });
  }

  // corruption backups: readJson renames any unparseable file to
  // `<name>.corrupt-<ts>` and starts clean — surface those so a silently
  // recovered (and otherwise invisible) data loss doesn't go unnoticed.
  try {
    const corrupt = fs.readdirSync(DATA_DIR).filter((f) => f.includes('.corrupt-'));
    if (corrupt.length) {
      checks.push({
        label: tr.doctor.corruptLabel,
        status: 'warn',
        detail: tr.doctor.corruptFound(corrupt.join(', ')),
      });
    }
  } catch {
    /* no data dir yet */
  }

  // ssh key hygiene — only when there are keys to talk about
  if (keyAudit.length) {
    const flagged = keyAudit.filter((k) => k.issues.length);
    const insecure = keyAudit.some(
      (k) => k.issues.includes('weak-rsa') || k.issues.includes('unencrypted'),
    );
    checks.push({
      label: tr.doctor.keysLabel,
      status: insecure ? 'warn' : 'ok',
      detail: flagged.length
        ? tr.doctor.keysIssues(flagged.length, keyAudit.length)
        : tr.doctor.keysOk(keyAudit.length),
    });
  }

  // inventory
  checks.push({
    label: tr.doctor.inventoryLabel,
    status: 'ok',
    detail: tr.doctor.inventoryDetail(
      safeCount(() => servers.all().length),
      safeCount(() => tunnels.all().length),
      safeCount(() => tempTunnels.all().length),
      safeCount(() => listKeys().length),
    ),
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

export function doctor(opts: { json?: boolean; listStaleKeys?: boolean } = {}): number {
  const keyAudit = collectKeyAudit();

  // `--list-stale-keys`: a focused, scriptable view of only the flagged keys.
  if (opts.listStaleKeys) {
    const flagged = keyAudit.filter((k) => k.issues.length);
    if (opts.json) {
      console.log(JSON.stringify(flagged, null, 2));
      return 0;
    }
    if (!flagged.length) {
      ui.printOk(tr.doctor.noStaleKeys);
      return 0;
    }
    ui.printSection('🔑', tr.doctor.staleKeysSection(flagged.length));
    for (const k of flagged) {
      const labels = k.issues.map((i) => KEY_ISSUE_LABEL[i]()).join(', ');
      console.log(
        `  ${ui.chalk.yellow('⚠')} ${ui.chalk.bold(tilde(k.path))}  ${ui.chalk.dim(labels)}`,
      );
    }
    return 0;
  }

  const checks = collectChecks(keyAudit);
  const failed = checks.some((c) => c.status === 'fail');
  if (opts.json) {
    console.log(
      JSON.stringify({ ok: !failed, platform: os.platform(), checks, keys: keyAudit }, null, 2),
    );
    return failed ? 2 : 0;
  }
  ui.printSection('🩺', tr.doctor.sectionTitle);
  for (const c of checks) {
    console.log(
      `  ${ICON[c.status]} ${ui.chalk.bold(c.label.padEnd(20))} ${ui.chalk.dim(c.detail)}`,
    );
  }
  console.log('');
  if (failed) ui.printError(tr.doctor.hasCritical);
  else ui.printOk(tr.doctor.allOk);
  return failed ? 2 : 0;
}
