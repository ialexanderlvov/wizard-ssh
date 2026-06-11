/** ssh-agent flows: list loaded identities, add a key, remove key(s).
 *
 *  Flow return contract: a number is an exit code whose output is on screen;
 *  `null` means the user backed out of an inner picker with NOTHING printed —
 *  the menu uses it to skip the read-this pause. Every flow takes an optional
 *  pre-made `probe` so one `ssh-add -l` round-trip (slow with a forwarded
 *  agent) serves the header AND the action instead of re-probing per step. */

import { probeAgent, agentAddKey, agentRemoveKey } from '../ssh/agent.js';
import type { AgentIdentity, AgentProbe } from '../ssh/agent.js';
import { findSshKeys } from '../ssh/keys.js';
import { isMac } from '../utils/platform.js';
import { tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { loop } from './menu-kit.js';
import { tr } from '../i18n/index.js';

/** Show what the agent currently holds. Exit codes: 0 ok, 2 agent unavailable. */
export function agentListFlow(opts: { json?: boolean; probe?: AgentProbe } = {}): number {
  const probe = opts.probe ?? probeAgent();
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
export async function agentAddFlow(
  path?: string,
  opts: { probe?: AgentProbe } = {},
): Promise<number | null> {
  if ((opts.probe ?? probeAgent()).status === 'unavailable') {
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
    if (picked === ui.BACK) return null; // backed out — nothing printed
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
  opts: { all?: boolean; probe?: AgentProbe } = {},
): Promise<number | null> {
  const probe = opts.probe ?? probeAgent();
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
    if (picked === ui.BACK) return null; // backed out — nothing printed
    keyPath = picked;
  }
  const code = agentRemoveKey(keyPath);
  if (code === 0) ui.printOk(tr.keys.agentRemoved);
  else ui.printError(tr.keys.agentRemoveFailed(code));
  return code;
}

/** Interactive ssh-agent submenu (entered from the Keys menu). Built on the
 *  shared menu loop; the header re-probes the agent once per pass and the
 *  probe is reused by the chosen action — one `ssh-add -l` per screen. */
export async function agentMenu(crumbs: string[] = []): Promise<void> {
  ui.ensureInteractive(tr.keys.agentEnsure);
  // A dead agent can't serve any menu action — say so once and leave, instead
  // of rendering add/remove rows that could only re-print the same error.
  if (probeAgent().status === 'unavailable') {
    ui.printError(tr.keys.agentUnavailable);
    await ui.pause();
    return;
  }
  let probe: AgentProbe | undefined;
  await loop(
    tr.keys.agentMenuTitle,
    crumbs,
    [
      { label: tr.keys.agentMenuAdd, value: 'add' },
      { label: tr.keys.agentMenuRemove, value: 'remove' },
      { label: tr.keys.agentMenuRemoveAll, value: 'removeAll' },
    ],
    async (a) => {
      // null = backed out of an inner picker with nothing printed → report the
      // action as pure navigation so the loop skips its read-this pause.
      let code: number | null = 0;
      if (a === 'add') code = await agentAddFlow(undefined, { probe });
      else if (a === 'remove') code = await agentRemoveFlow(undefined, { probe });
      else if (a === 'removeAll') code = await agentRemoveFlow(undefined, { all: true, probe });
      return code === null ? true : undefined;
    },
    {
      header: () => {
        probe = probeAgent();
        agentListFlow({ probe });
        console.log('');
      },
    },
  );
}

export type { AgentIdentity };
