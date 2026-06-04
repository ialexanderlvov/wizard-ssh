/** `wssh doctor` — environment diagnostics: required/optional binaries, data
 *  directory permissions, ~/.ssh/config health and vault status. Consolidates the
 *  checks scattered across preflight/copy-id/transfer into one health report. */

import fs from 'node:fs';
import os from 'node:os';
import { DATA_DIR, FILES, SSH_DIR, SSH_CONFIG_FILE } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { isMac, isWindows } from '../utils/platform.js';
import { listHosts } from '../ssh-config/index.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { vault } from '../vault/vault.js';
import { listKeys } from '../ssh/keys.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

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

export function collectChecks(): Check[] {
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

export function doctor(opts: { json?: boolean } = {}): number {
  const checks = collectChecks();
  const failed = checks.some((c) => c.status === 'fail');
  if (opts.json) {
    console.log(JSON.stringify({ ok: !failed, platform: os.platform(), checks }, null, 2));
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
