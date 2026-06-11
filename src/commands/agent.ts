/** ssh-agent flows: list loaded identities, add a key, remove key(s). */

import { probeAgent, agentAddKey, agentRemoveKey, type AgentIdentity } from '../ssh/agent.js';
import { findSshKeys } from '../ssh/keys.js';
import { isMac } from '../utils/platform.js';
import { tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

/** Show what the agent currently holds. Exit codes: 0 ok, 2 agent unavailable. */
export function agentListFlow(opts: { json?: boolean } = {}): number {
  const probe = probeAgent();
  if (opts.json) {
    console.log(JSON.stringify(probe, null, 2));
    return probe.status === 'unavailable' ? 2 : 0;
  }
  if (probe.status === 'unavailable') {
    ui.printError(tr.keys.agentUnavailable);
    return 2;
  }
  if (probe.status === 'empty') {
    ui.printWarn(tr.keys.agentEmpty);
    return 0;
  }
  ui.printSection('🔑', tr.keys.agentSection(probe.identities.length));
  for (const id of probe.identities) {
    console.log(
      `  ${ui.chalk.bold(id.comment || '?')}  ${ui.chalk.dim(`${id.type} ${id.bits}`)}  ` +
        ui.chalk.dim(id.fingerprint),
    );
  }
  return 0;
}

/** Add a key to the agent: explicit path, or a picker over ~/.ssh keys. */
export async function agentAddFlow(path?: string): Promise<number> {
  if (probeAgent().status === 'unavailable') {
    ui.printError(tr.keys.agentUnavailable);
    return 2;
  }
  let keyPath = path?.trim();
  if (!keyPath) {
    ui.ensureInteractive(tr.keys.agentEnsure);
    const found = findSshKeys();
    if (!found.length) {
      ui.printWarn(tr.keys.noKeysFoundShort);
      return 1;
    }
    const picked = await ui.pickFromList<string>({
      message: tr.keys.agentPickAdd,
      items: found,
      render: (k) => tilde(k),
      search: (k) => k,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    keyPath = picked;
  }
  // macOS ships an OpenSSH with Keychain integration: offer to persist the key's
  // passphrase so the next agent add is silent. Elsewhere the flag doesn't exist.
  let useKeychain = false;
  if (isMac && ui.isInteractive() && !ui.runtime.assumeYes) {
    useKeychain = await ui.confirm({ message: tr.keys.agentKeychainQuestion, default: false });
  }
  const code = await agentAddKey(keyPath, { useKeychain });
  if (code === 0) ui.printOk(tr.keys.agentAdded(tilde(keyPath)));
  else ui.printError(tr.keys.agentAddFailed(code));
  return code;
}

/** Remove one key (path or picker) or everything (`--all`). */
export async function agentRemoveFlow(
  path?: string,
  opts: { all?: boolean } = {},
): Promise<number> {
  const probe = probeAgent();
  if (probe.status === 'unavailable') {
    ui.printError(tr.keys.agentUnavailable);
    return 2;
  }
  if (probe.status === 'empty') {
    ui.printWarn(tr.keys.agentEmpty);
    return 0;
  }

  if (opts.all) {
    // --yes answers the confirm by itself; only a real prompt needs a TTY.
    if (!ui.runtime.assumeYes) ui.ensureInteractive(tr.keys.agentEnsure);
    const ok = await ui.confirm({
      message: tr.keys.agentConfirmRemoveAll(probe.identities.length),
      default: false,
    });
    if (!ok) {
      ui.printInfo(tr.common.cancelled);
      return 0;
    }
    const code = agentRemoveKey(null);
    if (code === 0) ui.printOk(tr.keys.agentRemovedAll);
    else ui.printError(tr.keys.agentRemoveFailed(code));
    return code;
  }

  let keyPath = path?.trim();
  if (!keyPath) {
    ui.ensureInteractive(tr.keys.agentEnsure);
    // `ssh-add -d` needs a key FILE; offer the on-disk keys that are currently
    // loaded (matched by comment/path is unreliable, so offer all local keys).
    const found = findSshKeys();
    if (!found.length) {
      ui.printWarn(tr.keys.noKeysFoundShort);
      return 1;
    }
    const picked = await ui.pickFromList<string>({
      message: tr.keys.agentPickRemove,
      items: found,
      render: (k) => tilde(k),
      search: (k) => k,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    keyPath = picked;
  }
  const code = agentRemoveKey(keyPath);
  if (code === 0) ui.printOk(tr.keys.agentRemoved);
  else ui.printError(tr.keys.agentRemoveFailed(code));
  return code;
}

export type { AgentIdentity };
