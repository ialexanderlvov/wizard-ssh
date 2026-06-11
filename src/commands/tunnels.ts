/** Tunnel CRUD + connect flows. Mirrors servers.ts, with forward config. */

import fs from 'node:fs';
import type { SortKey, SshConfigHost, Tunnel } from '../core/types.js';
import { PromptCancelError } from '../core/errors.js';
import type { EntityCollection } from '../store/collection.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import { sessions, sessionAlive, type TunnelSession } from '../store/sessions.store.js';
import { settings } from '../store/settings.store.js';
import { vault } from '../vault/vault.js';
import * as sshConfig from '../ssh-config/index.js';
import { runTunnel, startTunnelDetached, preflight } from '../ssh/runner.js';
import { isWindows } from '../utils/platform.js';
import { isPortFree, findFreePort } from '../utils/net.js';
import * as ui from '../ui/index.js';
import { detailBox, forwardSummary, targetSummary } from '../ui/format.js';
import { renderEntityTable, renderSessionsTable } from '../ui/tables.js';
import { isValidName } from '../utils/validators.js';
import { parseTags, slugify, tilde } from '../utils/strings.js';
import { tailFile, followLog } from '../utils/logtail.js';
import { askConnectionTarget, askForward, askMeta } from './wizard.js';
import {
  commitSecretChange,
  handlePasswordSecret,
  resolveEntity,
  resolvePassword,
  rollbackSecretChange,
} from './helpers.js';
import { tr } from '../i18n/index.js';

/** Tunnels live in one of two collections: the main list or the temporary one. */
type TunnelStore = EntityCollection<Tunnel>;

const storeKind = (store: TunnelStore): 'main' | 'temp' =>
  store === tempTunnels ? 'temp' : 'main';

/** Local `-L`/`-D` tunnels bind `localPort` on this machine; `-R` binds on the
 *  server, so only forward/dynamic types can clash locally. Catch a busy port
 *  before ssh fails with EADDRINUSE: non-interactively it's a hard error (exit
 *  1); interactively offer a free port (optionally persisted), an override, or
 *  cancel. Returns the (possibly re-ported) tunnel, or an abort with exit code. */
type PortCheck = { ok: true; tunnel: Tunnel } | { ok: false; code: number };

async function ensureLocalPortAvailable(tunnel: Tunnel, store: TunnelStore): Promise<PortCheck> {
  if (tunnel.type === 'remote') return { ok: true, tunnel };
  if (await isPortFree(tunnel.localPort)) return { ok: true, tunnel };

  if (!ui.isInteractive()) {
    ui.printError(tr.tunnels.portBusy(tunnel.localPort));
    return { ok: false, code: 1 };
  }
  const free = await findFreePort(tunnel.localPort + 1, 200);
  const choice = await ui.choose<'auto' | 'override' | 'cancel'>({
    message: tr.tunnels.portBusyPrompt(tunnel.localPort),
    choices: [
      ...(free ? [{ name: tr.tunnels.portUseFree(free), value: 'auto' as const }] : []),
      { name: tr.tunnels.portOverride, value: 'override' as const },
      { name: tr.tunnels.portCancel, value: 'cancel' as const },
    ],
  });
  if (choice === 'cancel') return { ok: false, code: 0 };
  if (choice === 'override' || !free) return { ok: true, tunnel };
  // Use the free port for this run; offer to persist it on the saved tunnel.
  if (await ui.confirm({ message: tr.tunnels.portSave(free), default: true })) {
    store.update(tunnel.id, { localPort: free });
  }
  return { ok: true, tunnel: { ...tunnel, localPort: free } };
}

export async function connectTunnel(tunnel: Tunnel, store: TunnelStore = tunnels): Promise<number> {
  const check = await ensureLocalPortAvailable(tunnel, store);
  if (!check.ok) return check.code;
  const t = check.tunnel;
  console.log('\n' + detailBox(t));
  const password = await resolvePassword(t);
  store.touch(t.id);
  return runTunnel(t, password, { autoReconnect: settings.get().tunnelAutoReconnect });
}

// ---------- background sessions ----------

/** Start a tunnel detached in the background and register the session. Only
 *  agent/key tunnels qualify (password tunnels need a foreground sshpass). */
export async function tunnelUpFlow(name?: string, store: TunnelStore = tunnels): Promise<number> {
  const tunnel = await resolveEntity(store, name, tr.tunnels.pickTunnelUp);
  if (!tunnel) return 0;
  return startTunnelBackground(tunnel, store);
}

/** The background-start core shared by the single-tunnel flow and the tag
 *  ("profile") flow: guards, port check, detach, session registration. */
export async function startTunnelBackground(
  tunnel: Tunnel,
  store: TunnelStore = tunnels,
): Promise<number> {
  if (tunnel.auth === 'password') {
    ui.printError(tr.tunnels.bgNoPassword);
    return 1;
  }
  const existing = sessions.find(tunnel.id);
  if (existing) {
    ui.printWarn(tr.tunnels.alreadyRunning(tunnel.name, existing.pid));
    return 0;
  }
  const err = preflight(tunnel, {
    forwardPorts: { local: tunnel.localPort, remote: tunnel.remotePort, type: tunnel.type },
  });
  if (err) {
    ui.printError(err);
    return 1;
  }
  const check = await ensureLocalPortAvailable(tunnel, store);
  if (!check.ok) return check.code;
  const running = check.tunnel;
  if (isWindows) ui.printWarn(tr.tunnels.windowsUnstable);

  const { pid, logFile } = startTunnelDetached(running);
  if (pid <= 0) {
    ui.printError(tr.tunnels.bgStartFailed);
    return 1;
  }
  store.touch(running.id);
  sessions.add({
    tunnelId: running.id,
    name: running.name,
    pid,
    store: storeKind(store),
    forward: forwardSummary(running),
    target: targetSummary(running),
    logFile,
  });
  ui.printOk(tr.tunnels.tunnelRaised(running.name, pid));
  ui.printInfo(tr.tunnels.tunnelLog(tilde(logFile), tunnel.name));
  return 0;
}

/** Bring up every saved tunnel carrying a tag — a one-command "profile"
 *  (e.g. `wssh tunnel start --tag work`). Sequential on purpose: each start may
 *  prompt interactively about a busy local port. */
export async function tunnelUpByTagFlow(tag: string): Promise<number> {
  const t = tag.trim();
  if (!t) {
    ui.printError(tr.tunnels.tagNeedsTag);
    return 1;
  }
  const list = tunnels.all().filter((x) => x.tags.includes(t));
  if (!list.length) {
    ui.printWarn(tr.tunnels.tagNoTunnels(t));
    return 0;
  }
  ui.printSection('🚇', tr.tunnels.tagUpSection(t, list.length));
  let failed = 0;
  for (const tunnel of list) {
    if ((await startTunnelBackground(tunnel, tunnels)) !== 0) failed++;
  }
  if (failed) {
    ui.printWarn(tr.tunnels.tagUpFail(failed, list.length));
    return 1;
  }
  ui.printOk(tr.tunnels.tagUpDone(list.length));
  return 0;
}

/** Stop every running background tunnel whose tunnel carries a tag. */
export function tunnelDownByTagFlow(tag: string): number {
  const t = tag.trim();
  if (!t) {
    ui.printError(tr.tunnels.tagNeedsTag);
    return 1;
  }
  const matching = sessions.list().filter((s) => {
    const coll = s.store === 'temp' ? tempTunnels : tunnels;
    return coll.findById(s.tunnelId)?.tags.includes(t) ?? false;
  });
  if (!matching.length) {
    ui.printWarn(tr.tunnels.tagDownNone(t));
    return 0;
  }
  let stopped = 0;
  for (const s of matching) {
    // Same PID-reuse TOCTOU guard as tunnelDownFlow: re-verify before signalling.
    if (sessionAlive(s)) {
      try {
        process.kill(s.pid, 'SIGTERM');
        stopped++;
      } catch {
        /* already gone */
      }
    }
    sessions.remove(s.tunnelId);
  }
  ui.printOk(tr.tunnels.stopped(stopped));
  return 0;
}

/** A live session enriched with health facts: is the local forward actually
 *  listening (local/dynamic only — a remote forward binds on the server), and
 *  the tail of its log when it isn't. */
export interface SessionHealth {
  session: TunnelSession;
  listening: boolean | null;
  lastError: string | null;
}

async function collectSessionHealth(live: TunnelSession[]): Promise<SessionHealth[]> {
  return Promise.all(
    live.map(async (session) => {
      const coll = session.store === 'temp' ? tempTunnels : tunnels;
      const tunnel = coll.findById(session.tunnelId);
      let listening: boolean | null = null;
      if (tunnel && tunnel.type !== 'remote') {
        // The ssh PID being alive doesn't mean the forward works — probe the
        // local bind: a free port under a live session = a dead/broken forward.
        listening = !(await isPortFree(tunnel.localPort));
      }
      let lastError: string | null = null;
      if (listening === false) {
        const lines = tailFile(session.logFile, 5).filter((l) => l.trim());
        lastError = lines.length ? (lines[lines.length - 1] ?? null) : null;
      }
      return { session, listening, lastError };
    }),
  );
}

export async function listSessions(opts: { json?: boolean } = {}): Promise<void> {
  const live = sessions.list();
  if (!live.length) {
    if (opts.json) console.log('[]');
    else ui.printWarn(tr.tunnels.noBackground);
    return;
  }
  const health = await collectSessionHealth(live);
  if (opts.json) {
    console.log(
      JSON.stringify(
        health.map((h) => ({
          ...h.session,
          uptimeSec: Math.max(0, Math.floor((Date.now() - Date.parse(h.session.startedAt)) / 1000)),
          listening: h.listening,
          lastError: h.lastError,
        })),
        null,
        2,
      ),
    );
    return;
  }
  ui.printSection('🟢', tr.tunnels.backgroundSection(live.length));
  console.log(renderSessionsTable(health));
  for (const h of health) {
    if (h.listening === false) {
      ui.printWarn(tr.tunnels.sessionNotListening(h.session.name));
      if (h.lastError) console.log('  ' + ui.chalk.dim(h.lastError));
    }
  }
}

/** Stop a background tunnel (by name) or all of them. */
export async function tunnelDownFlow(name?: string, opts: { all?: boolean } = {}): Promise<number> {
  const live = sessions.list();
  if (!live.length) {
    ui.printWarn(tr.tunnels.noBackgroundDown);
    return 0;
  }
  let toStop = live;
  if (!opts.all) {
    const target = name
      ? live.find((s) => s.name.toLowerCase() === name.toLowerCase())
      : await (async () => {
          ui.ensureInteractive(tr.tunnels.stopEnsure);
          const picked = await ui.pickFromList({
            message: tr.tunnels.pickTunnelDown,
            items: live,
            render: (s) => `${ui.chalk.bold(s.name)}  ${ui.chalk.dim(s.forward)}  pid ${s.pid}`,
            search: (s) => s.name,
            pageSize: 14,
          });
          return picked === ui.BACK ? null : picked;
        })();
    if (!target) {
      if (name) ui.printError(tr.tunnels.bgNotFound(name));
      return name ? 1 : 0;
    }
    toStop = [target];
  } else {
    // `--all`: needs a confirmation, so it must be interactive (or `--yes`).
    // Without ensureInteractive, a scripted `tunnel down --all` would abort with
    // an opaque PromptAbortError instead of a clear "interactive / --yes" error.
    // Under --yes the confirm auto-answers, so no TTY is required.
    if (!ui.runtime.assumeYes) ui.ensureInteractive(tr.tunnels.stopEnsure);
    if (!(await ui.confirm({ message: tr.tunnels.confirmStopAll(live.length), default: false }))) {
      ui.printInfo(tr.common.cancelled);
      return 0;
    }
  }

  let stopped = 0;
  for (const s of toStop) {
    // Re-verify the PID is STILL our process right before signalling: the list()
    // snapshot above may be stale after the (possibly long) confirm/pick prompt,
    // and the PID could have been recycled by an unrelated same-user process.
    if (!sessionAlive(s)) {
      sessions.remove(s.tunnelId);
      continue;
    }
    try {
      process.kill(s.pid, 'SIGTERM');
      stopped++;
    } catch {
      /* already gone */
    }
    sessions.remove(s.tunnelId);
  }
  ui.printOk(tr.tunnels.stopped(stopped));
  return 0;
}

export async function connectTunnelFlow(
  name?: string,
  store: TunnelStore = tunnels,
): Promise<number> {
  const tunnel = await resolveEntity(store, name, tr.tunnels.pickTunnelConnect);
  if (!tunnel) return 0;
  return connectTunnel(tunnel, store);
}

/** #9 — pick a ~/.ssh/config host, define the forward, save and raise it now. */
export async function createAndRaiseTunnel(): Promise<number> {
  ui.ensureInteractive(tr.tunnels.quickTunnelEnsure);
  const hosts = sshConfig.listHosts();
  if (!hosts.length) {
    ui.printWarn(tr.tunnels.noSshConfigHosts);
    return 0;
  }
  const host = await ui.pickFromList<SshConfigHost>({
    message: tr.tunnels.pickSshConfigHost,
    items: hosts,
    render: ui.configRowRenderer(hosts),
    search: ui.configSearch,
    sorts: ui.CONFIG_SORTS,
    pageSize: 14,
  });
  if (host === ui.BACK) return 0;

  const fwd = await askForward({});
  const meta = await askMeta(
    {},
    (n) => tunnels.nameExists(n),
    slugify(`${host.alias}-${fwd.localPort}`),
  );
  const tunnel = tunnels.create({
    hostMode: 'sshconfig',
    sshHost: host.alias,
    host: '',
    user: '',
    sshPort: 22,
    auth: 'agent',
    keyPath: null,
    secretId: null,
    ...fwd,
    ...meta,
    kind: 'tunnel',
  });
  ui.printOk(tr.tunnels.tunnelCreated(tunnel.name));
  return connectTunnel(tunnel);
}

/** Create + raise a tunnel to ANY host — including one not in ~/.ssh/config.
 *  Saved to its OWN list (temp-tunnels.json), kept apart from the main tunnels. */
export async function raiseTemporaryTunnel(): Promise<number> {
  ui.ensureInteractive(tr.tunnels.tempTunnelEnsure);
  ui.printSection('🚇', tr.tunnels.tempTunnelSection);
  const target = await askConnectionTarget({});
  const secretId = await handlePasswordSecret(target, null);
  let tunnel: Tunnel;
  try {
    const fwd = await askForward({});
    const suggested = slugify(
      `${target.hostMode === 'sshconfig' ? target.sshHost : target.host}-${fwd.localPort}`,
    );
    const meta = await askMeta({}, (n) => tempTunnels.nameExists(n), suggested);
    tunnel = tempTunnels.create({ ...target, secretId, ...fwd, ...meta, kind: 'tunnel' });
  } catch (e) {
    // Roll back ONLY while the tunnel isn't persisted yet. Once create() has run,
    // the secret is referenced by a saved record, so a later connect failure must
    // NOT delete it (which would orphan the record + re-prompt next time) —
    // mirrors addTunnel(), whose create() is its last statement before return.
    rollbackSecretChange(null, secretId);
    throw e;
  }
  ui.printOk(tr.tunnels.tempTunnelSaved(tunnel.name));
  return connectTunnel(tunnel, tempTunnels);
}

export async function addTunnel(seed: Partial<Tunnel> = {}): Promise<Tunnel | null> {
  ui.ensureInteractive(tr.tunnels.addTunnelEnsure);
  ui.printSection('➕', tr.tunnels.addTunnelSection);
  const target = await askConnectionTarget(seed);
  const secretId = await handlePasswordSecret(target, null);
  try {
    const fwd = await askForward(seed);
    const suggested = slugify(
      seed.name || (target.hostMode === 'sshconfig' ? target.sshHost : target.host),
    );
    const meta = await askMeta(seed, (n) => tunnels.nameExists(n), suggested);
    const tunnel = tunnels.create({ ...target, secretId, ...fwd, ...meta, kind: 'tunnel' });
    ui.printOk(tr.tunnels.tunnelSaved(tunnel.name));
    console.log(detailBox(tunnel));
    return tunnel;
  } catch (e) {
    rollbackSecretChange(null, secretId); // abort after saving a password → no orphan blob
    throw e;
  }
}

export async function editTunnel(name?: string, store: TunnelStore = tunnels): Promise<void> {
  ui.ensureInteractive(tr.tunnels.editEnsure);
  const tunnel = await resolveEntity(store, name, tr.tunnels.pickTunnelEdit);
  if (!tunnel) return;

  let working: Tunnel = { ...tunnel };
  const originalSecretId = tunnel.secretId;
  let dirty = false;

  for (;;) {
    ui.printSection('✏️', tr.tunnels.editSection(working.name));
    console.log(detailBox(working) + '\n');

    const choices = [
      { name: tr.tunnels.editFieldName(working.name), value: 'name' },
      {
        name: tr.tunnels.editFieldDescription(working.description || tr.common.dash),
        value: 'description',
      },
      { name: tr.tunnels.editFieldTags(working.tags.join(', ') || tr.common.dash), value: 'tags' },
      { name: tr.tunnels.editFieldConnection, value: 'connection' },
      { name: tr.tunnels.editFieldForward(forwardSummary(working)), value: 'forward' },
      ...(working.type === 'local'
        ? [{ name: tr.tunnels.editFieldBrowser(working.openBrowser ?? false), value: 'browser' }]
        : []),
      { name: tr.tunnels.editSave, value: '__save__' },
      { name: tr.tunnels.editCancel, value: '__cancel__' },
    ];
    let field: string;
    try {
      field = await ui.choose<string>({
        message: dirty ? tr.tunnels.editDirty : tr.tunnels.editClean,
        choices,
      });
    } catch (e) {
      // Esc on the editor menu = cancel the edit (still runs the unsaved guard).
      if (!(e instanceof PromptCancelError)) throw e;
      field = '__cancel__';
    }

    if (field === '__save__') {
      if (dirty) {
        store.update(tunnel.id, working);
        commitSecretChange(originalSecretId, working.secretId); // drop the replaced blob
        ui.printOk(tr.tunnels.editSaved);
      } else ui.printInfo(tr.tunnels.editNoChanges);
      return;
    }
    if (field === '__cancel__') {
      if (dirty && !(await ui.confirm({ message: tr.tunnels.editCancelConfirm, default: false })))
        continue;
      rollbackSecretChange(originalSecretId, working.secretId); // discard any pending blob
      ui.printInfo(tr.common.cancelled);
      return;
    }
    try {
      if (field === 'name') {
        working.name = (
          await ui.text({
            message: tr.tunnels.editNewName,
            default: working.name,
            validate: (v) =>
              !isValidName(v.trim())
                ? tr.tunnels.editInvalidName
                : store.nameExists(v.trim(), tunnel.id)
                  ? tr.tunnels.editNameTaken
                  : true,
          })
        ).trim();
        dirty = true;
      } else if (field === 'description') {
        working.description = await ui.text({
          message: tr.tunnels.editDescription,
          default: working.description,
        });
        dirty = true;
      } else if (field === 'tags') {
        working.tags = parseTags(
          await ui.text({ message: tr.tunnels.editTags, default: working.tags.join(', ') }),
        );
        dirty = true;
      } else if (field === 'connection') {
        const target = await askConnectionTarget(working);
        const prevPending = working.secretId;
        const secretId = await handlePasswordSecret(target, prevPending);
        // drop a superseded *pending* blob from an earlier edit this session.
        if (prevPending && prevPending !== originalSecretId && prevPending !== secretId)
          rollbackSecretChange(originalSecretId, prevPending);
        working = { ...working, ...target, secretId };
        dirty = true;
      } else if (field === 'forward') {
        const fwd = await askForward(working);
        working = { ...working, ...fwd };
        dirty = true;
      } else if (field === 'browser') {
        working.openBrowser = !working.openBrowser;
        dirty = true;
      }
    } catch (e) {
      // Esc out of a single field → discard that field's input, back to the editor.
      if (!(e instanceof PromptCancelError)) throw e;
    }
  }
}

export async function removeTunnelFlow(name?: string, store: TunnelStore = tunnels): Promise<void> {
  ui.ensureInteractive(tr.tunnels.removeEnsure);
  if (name) {
    const tunnel = await resolveEntity(store, name, tr.tunnels.pickTunnelRemove);
    if (!tunnel) return;
    if (await ui.confirm({ message: tr.tunnels.confirmRemoveOne(tunnel.name), default: false })) {
      removeTunnelById(tunnel, store);
      ui.printOk(tr.tunnels.removed(tunnel.name));
    } else ui.printInfo(tr.common.cancelled);
    return;
  }
  const list = store.sorted('name');
  if (!list.length) {
    ui.printWarn(tr.tunnels.tunnelListEmpty);
    return;
  }
  const ids = await ui.multiChoose<string>({
    message: tr.tunnels.pickTunnelsMulti,
    choices: list.map((t) => ({ name: `${t.name} — ${forwardSummary(t)}`, value: t.id })),
  });
  if (!ids.length) {
    ui.printInfo(tr.tunnels.nothingSelected);
    return;
  }
  if (await ui.confirm({ message: tr.tunnels.confirmRemoveMulti(ids.length), default: false })) {
    ids.forEach((id) => {
      const t = store.findById(id);
      if (t) removeTunnelById(t, store);
    });
    ui.printOk(tr.tunnels.removedMulti(ids.length));
  } else ui.printInfo(tr.common.cancelled);
}

function removeTunnelById(tunnel: Tunnel, store: TunnelStore): void {
  if (tunnel.secretId) vault.removeSecret(tunnel.secretId);
  store.remove(tunnel.id);
}

/** First "<base>", "<base>-2", … not already taken in the collection. */
function uniqueName(store: TunnelStore, base: string): string {
  if (!store.nameExists(base)) return base;
  for (let i = 2; ; i++) if (!store.nameExists(`${base}-${i}`)) return `${base}-${i}`;
}

/** Clone a tunnel under a new name. Copies every field, auto-bumps a local/
 *  dynamic forward to a free port, and never shares the source's vault secret
 *  (a shared blob would be deleted when either tunnel is removed). */
export async function cloneTunnelFlow(
  name?: string,
  newName?: string,
  store: TunnelStore = tunnels,
): Promise<void> {
  const src = await resolveEntity(store, name, tr.tunnels.pickTunnelClone);
  if (!src) return;

  let target = (newName ?? '').trim();
  if (target) {
    if (!isValidName(target)) {
      ui.printError(tr.tunnels.editInvalidName);
      return;
    }
    if (store.nameExists(target)) {
      ui.printError(tr.tunnels.editNameTaken);
      return;
    }
  } else {
    const suggestion = uniqueName(store, `${src.name}-copy`);
    target = ui.isInteractive()
      ? (
          await ui.text({
            message: tr.tunnels.cloneNamePrompt,
            default: suggestion,
            validate: (v) =>
              !isValidName(v.trim())
                ? tr.tunnels.editInvalidName
                : store.nameExists(v.trim())
                  ? tr.tunnels.editNameTaken
                  : true,
          })
        ).trim()
      : suggestion;
  }

  let localPort = src.localPort;
  if (src.type !== 'remote' && src.localPort > 0) {
    localPort = (await findFreePort(src.localPort, 200)) ?? src.localPort;
  }

  const clone = store.create({
    hostMode: src.hostMode,
    sshHost: src.sshHost,
    host: src.host,
    user: src.user,
    sshPort: src.sshPort,
    auth: src.auth,
    keyPath: src.keyPath,
    secretId: null, // a saved password is re-asked rather than sharing a vault blob
    type: src.type,
    localPort,
    remoteHost: src.remoteHost,
    remotePort: src.remotePort,
    openBrowser: src.openBrowser,
    description: src.description,
    tags: [...src.tags],
    name: target,
    kind: 'tunnel',
  });
  ui.printOk(tr.tunnels.cloned(src.name, clone.name));
  if (clone.localPort !== src.localPort) ui.printInfo(tr.tunnels.clonePortBumped(clone.localPort));
  console.log(detailBox(clone));
}

/** Show (and optionally follow) a background tunnel's log, resolved from the
 *  sessions registry so users never hunt PIDs or log paths. */
export async function tunnelLogsFlow(
  name?: string,
  opts: { tail?: number; follow?: boolean } = {},
): Promise<number> {
  const live = sessions.list();
  if (!live.length) {
    ui.printWarn(tr.tunnels.noBackground);
    return 0;
  }
  let target: TunnelSession;
  if (name) {
    const found = live.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      ui.printError(tr.tunnels.bgNotFound(name));
      return 1;
    }
    target = found;
  } else if (live.length === 1) {
    target = live[0]!;
  } else {
    ui.ensureInteractive(tr.tunnels.logsEnsure);
    const picked = await ui.pickFromList<TunnelSession>({
      message: tr.tunnels.pickTunnelLogs,
      items: live,
      render: (s) => `${ui.chalk.bold(s.name)}  ${ui.chalk.dim(s.forward)}  pid ${s.pid}`,
      search: (s) => s.name,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    target = picked;
  }

  if (!fs.existsSync(target.logFile)) {
    ui.printWarn(tr.tunnels.logMissing(tilde(target.logFile)));
    return 1;
  }
  ui.printSection('📜', tr.tunnels.logsSection(target.name, tilde(target.logFile)));
  const lines = tailFile(target.logFile, opts.tail ?? 40);
  if (lines.length) console.log(lines.join('\n'));
  if (opts.follow) {
    ui.printInfo(ui.chalk.dim(tr.tunnels.logFollowHint));
    await followLog(target.logFile);
  }
  return 0;
}

export function listTunnels(opts: { sort?: SortKey; reverse?: boolean; json?: boolean }): Tunnel[] {
  const sortKey = opts.sort ?? 'recent';
  const list = tunnels.sorted(sortKey, opts.reverse);
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return list;
  }
  if (!list.length) {
    ui.printWarn(tr.tunnels.listEmpty);
    return list;
  }
  ui.printSection('🚇', tr.tunnels.listSection(list.length, sortKey, opts.reverse ? ' ↑' : ' ↓'));
  console.log(renderEntityTable(list));
  return list;
}
