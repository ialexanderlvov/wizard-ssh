/** SSH key management: list / inspect / generate / copy public key / install on
 *  a server / delete. Deleting a key first reports who references it (servers and
 *  tunnels whose IdentityFile / key path points at it) so nothing breaks silently. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PromptAbortError } from '../core/errors.js';
import type { Entity, Server } from '../core/types.js';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import {
  type KeyInfo,
  type KeyType,
  listKeys,
  generateKey,
  deleteKey,
  defaultKeyComment,
  publicKeyText,
  keyFingerprint,
  pubPathFor,
  isSkKeyType,
} from '../ssh/keys.js';
import { copyId } from '../ssh/features.js';
import { commandExists } from '../utils/exec.js';
import { copyToClipboard } from '../utils/platform.js';
import { expandHome, tilde } from '../utils/strings.js';
import * as ui from '../ui/index.js';
import { renderKeysTable } from '../ui/tables.js';
import { targetSummary } from '../ui/format.js';
import { resolveEntity, resolvePassword } from './helpers.js';
import { tr } from '../i18n/index.js';

export interface KeyReference {
  kind: string;
  name: string;
}

/** Every saved server/tunnel whose key path points at `keyPath`. */
export function keyReferences(keyPath: string): KeyReference[] {
  const target = expandHome(keyPath);
  const refs: KeyReference[] = [];
  const match = (e: Entity): boolean => Boolean(e.keyPath && expandHome(e.keyPath) === target);
  for (const s of servers.all())
    if (match(s)) refs.push({ kind: tr.keys.kindServer, name: s.name });
  for (const t of tunnels.all())
    if (match(t)) refs.push({ kind: tr.keys.kindTunnel, name: t.name });
  for (const t of tempTunnels.all())
    if (match(t)) refs.push({ kind: tr.keys.kindTempTunnel, name: t.name });
  return refs;
}

export function listKeysCommand(opts: { json?: boolean } = {}): KeyInfo[] {
  const keys = listKeys();
  if (opts.json) {
    console.log(
      JSON.stringify(
        keys.map((k) => ({ ...k, references: keyReferences(k.path).length })),
        null,
        2,
      ),
    );
    return keys;
  }
  if (!commandExists('ssh-keygen')) ui.printWarn(tr.keys.sshKeygenMissing);
  if (!keys.length) {
    ui.printWarn(tr.keys.noKeysFound);
    return keys;
  }
  ui.printSection('🗝', tr.keys.keysSection(keys.length));
  console.log(renderKeysTable(keys));
  return keys;
}

function showPublicKey(key: KeyInfo): void {
  const text = publicKeyText(key.path);
  if (!text) {
    ui.printWarn(tr.keys.pubKeyNotFound(tilde(key.pubPath)));
    return;
  }
  ui.printSection('📄', tr.keys.pubKeySection(tilde(key.path)));
  console.log(ui.chalk.green(text));
}

function copyPublicKey(key: KeyInfo): void {
  const text = publicKeyText(key.path);
  if (!text) {
    ui.printWarn(tr.keys.pubKeyNotFound(tilde(key.pubPath)));
    return;
  }
  const tool = copyToClipboard(text);
  if (tool) ui.printOk(tr.keys.pubKeyCopied(tool));
  else {
    ui.printWarn(tr.keys.noClipboardTool);
    console.log(ui.chalk.green(text));
  }
}

/** Install a specific key on a chosen server via ssh-copy-id. */
async function installKeyOnServer(key: KeyInfo): Promise<void> {
  const server = await resolveEntity(servers, undefined, tr.keys.installKeyQuestion);
  if (!server) return;
  const pubKey = fs.existsSync(key.pubPath) ? key.pubPath : key.path;
  const password = await resolvePassword(server as Server);
  ui.printSection('📋', tr.keys.installKeySection(tilde(key.path), targetSummary(server)));
  try {
    const code = await copyId(server as Server, pubKey, password);
    if (code === 0) ui.printOk(tr.keys.keyInstalled);
    else ui.printError(tr.keys.copyIdFailed(code));
  } catch (e) {
    ui.printError((e as Error).message);
  }
}

/** Generate a new key pair (interactive). Returns the created private-key path. */
export async function generateKeyFlow(): Promise<string | null> {
  ui.ensureInteractive(tr.keys.genEnsure);
  if (!commandExists('ssh-keygen')) {
    ui.printError(tr.keys.sshKeygenNotFound);
    return null;
  }
  ui.printSection('✨', tr.keys.newKeySection);
  const type = await ui.choose<KeyType>({
    message: tr.keys.keyTypeQuestion,
    choices: [
      { name: tr.keys.keyTypeEd25519, value: 'ed25519' },
      { name: tr.keys.keyTypeRsa, value: 'rsa' },
      { name: 'ecdsa', value: 'ecdsa' },
      {
        name: tr.keys.keyTypeEd25519sk,
        value: 'ed25519-sk',
        description: tr.keys.keyTypeEd25519skDesc,
      },
      {
        name: tr.keys.keyTypeEcdsaSk,
        value: 'ecdsa-sk',
        description: tr.keys.keyTypeEcdsaSkDesc,
      },
    ],
    default: 'ed25519',
  });
  if (isSkKeyType(type)) {
    ui.printInfo(tr.keys.skInfo);
  }
  const sshDir = path.join(os.homedir(), '.ssh');
  // ssh convention names sk keys with an underscore: id_ed25519_sk
  const suggested = path.join(sshDir, `id_${type.replace('-sk', '_sk')}`);
  const keyPath = expandHome(
    (
      await ui.text({
        message: tr.keys.keyPathQuestion,
        default: tilde(suggested),
        validate: (v) => v.trim().length > 0 || tr.keys.keyPathRequired,
      })
    ).trim(),
  );
  if (fs.existsSync(keyPath)) {
    const refs = keyReferences(keyPath);
    const note = refs.length ? tr.keys.overwriteNote(refs.map((r) => r.name).join(', ')) : '';
    if (
      !(await ui.confirm({
        message: tr.keys.overwriteConfirm(tilde(keyPath), note),
        default: false,
      }))
    ) {
      ui.printInfo(tr.common.cancelled);
      return null;
    }
    deleteKey(keyPath); // ssh-keygen would otherwise prompt; remove first
  }
  const comment = (
    await ui.text({ message: tr.keys.commentQuestion, default: defaultKeyComment() })
  ).trim();
  const withPassphrase = await ui.confirm({
    message: tr.keys.passphraseQuestion,
    default: false,
  });

  try {
    const code = await generateKey({ path: keyPath, type, comment, withPassphrase });
    if (code !== 0) {
      ui.printError(tr.keys.keygenFailed(code));
      return null;
    }
  } catch (e) {
    ui.printError((e as Error).message);
    return null;
  }
  const fp = keyFingerprint(keyPath);
  ui.printOk(tr.keys.keyCreated(tilde(keyPath), fp ? `  ${fp.hash}` : ''));
  if (await ui.confirm({ message: tr.keys.installNowQuestion, default: false }))
    await installKeyOnServer({
      path: keyPath,
      pubPath: pubPathFor(keyPath),
      hasPub: fs.existsSync(pubPathFor(keyPath)),
      type: fp?.type ?? type,
      bits: fp?.bits ?? 0,
      fingerprint: fp?.hash ?? '',
      comment,
    });
  return keyPath;
}

/** Delete a key — but first surface who references it. */
export async function deleteKeyFlow(key: KeyInfo): Promise<void> {
  const refs = keyReferences(key.path);
  ui.printSection('🗑', tr.keys.deleteSection(tilde(key.path)));
  if (refs.length) {
    ui.printWarn(tr.keys.refsWarn(refs.length));
    for (const r of refs) console.log(`   ${ui.chalk.dim(r.kind)}  ${ui.chalk.bold(r.name)}`);
    ui.printWarn(tr.keys.refsWillBreak);
  } else {
    ui.printInfo(tr.keys.noRefs);
  }
  const removesPub = fs.existsSync(key.pubPath);
  if (
    !(await ui.confirm({
      message: tr.keys.deleteConfirm(tilde(key.path), removesPub ? tr.keys.deleteAndPub : ''),
      default: false,
    }))
  ) {
    ui.printInfo(tr.common.cancelled);
    return;
  }
  const { removed } = deleteKey(key.path);
  if (removed.length) ui.printOk(tr.keys.deleted(removed.map(tilde).join(', ')));
  else ui.printWarn(tr.keys.nothingToDelete);
}

/** Resolve a key by path for the CLI, or pick one interactively. */
async function resolveKey(keyPath?: string): Promise<KeyInfo | null> {
  const keys = listKeys();
  if (keyPath) {
    const want = expandHome(keyPath);
    const hit = keys.find((k) => k.path === want || tilde(k.path) === keyPath);
    if (hit) return hit;
    ui.printError(tr.keys.keyNotFound(keyPath));
    return null;
  }
  if (!keys.length) {
    ui.printWarn(tr.keys.noKeysFoundShort);
    return null;
  }
  ui.ensureInteractive(tr.keys.pickKeyEnsure);
  const picked = await ui.pickFromList<KeyInfo>({
    message: tr.keys.pickKeyQuestion,
    items: keys,
    render: (k) => {
      const refs = keyReferences(k.path).length;
      return (
        `${ui.chalk.bold(tilde(k.path))}  ${ui.chalk.magenta(k.type)}` +
        `  ${ui.chalk.dim(k.fingerprint || tr.common.dash)}` +
        (refs ? ui.chalk.cyan(tr.keys.refsSuffix(refs)) : '')
      );
    },
    search: (k) => `${k.path} ${k.type} ${k.comment}`,
    pageSize: 14,
  });
  return picked === ui.BACK ? null : picked;
}

/** CLI: delete a key (interactive picker when no path given). */
export async function deleteKeyCommand(keyPath?: string): Promise<void> {
  const key = await resolveKey(keyPath);
  if (key) await deleteKeyFlow(key);
}

/** Interactive key-management menu (entry from the main menu). */
export async function keysMenu(crumbs: string[] = [tr.keys.mainMenuCrumb]): Promise<void> {
  ui.ensureInteractive(tr.keys.menuEnsure);
  for (;;) {
    ui.clearScreen();
    const keys = listKeys();
    ui.printSection('🗝', tr.keys.keysSection(keys.length));
    if (keys.length) console.log(renderKeysTable(keys) + '\n');

    const GEN = '__gen__';
    const picked = await ui.pickFromList<KeyInfo | { __action: string }>({
      message: tr.keys.menuMessage,
      items: [{ __action: GEN } as { __action: string }, ...keys],
      render: (it) =>
        '__action' in it
          ? ui.chalk.green(tr.keys.menuGenerate)
          : `${ui.chalk.bold(tilde((it as KeyInfo).path))}  ${ui.chalk.magenta((it as KeyInfo).type)}  ${ui.chalk.dim((it as KeyInfo).fingerprint || tr.common.dash)}`,
      search: (it) => ('__action' in it ? tr.keys.menuSearch : (it as KeyInfo).path),
      pageSize: 14,
      crumbs,
      indent: crumbs.length * 2,
    });
    if (picked === ui.BACK) return;

    ui.clearScreen();
    try {
      if ('__action' in picked) {
        await generateKeyFlow();
        await ui.pause();
        continue;
      }
      const key = picked as KeyInfo;
      const action = await ui.choose<string>({
        message: tr.keys.keyActionQuestion(tilde(key.path)),
        choices: [
          { name: tr.keys.actionShowPub, value: 'show' },
          { name: tr.keys.actionCopyPub, value: 'copy' },
          { name: tr.keys.actionInstall, value: 'install' },
          { name: tr.keys.actionDelete, value: 'delete' },
        ],
      });
      if (action === 'show') showPublicKey(key);
      else if (action === 'copy') copyPublicKey(key);
      else if (action === 'install') await installKeyOnServer(key);
      else if (action === 'delete') await deleteKeyFlow(key);
    } catch (e) {
      // Esc / Ctrl+C out of a key action → straight back to the key list, no pause.
      if (e instanceof PromptAbortError) continue;
      ui.printError(tr.common.error(e instanceof Error ? e.message : String(e)));
    }
    await ui.pause();
  }
}
