/** Install / uninstall shell completion into the right place for the user's shell.
 *
 *  `completion.ts` only *renders* the scripts; this module puts them where each
 *  shell will actually load them and (for bash / plain zsh) wires up the rc file,
 *  so `wssh completion install` is a one-shot that just works — no copy-pasting a
 *  redirect into the wrong directory and forgetting to rebuild the compinit cache.
 *
 *  Everything here is idempotent: re-running refreshes the files in place, and
 *  rc edits live inside a single marked block we can find and replace / remove. */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { completionScript, type Shell } from './completion.js';

/** Markers delimiting our managed block inside an rc file, so install is
 *  idempotent and uninstall can excise exactly what we added. */
const BLOCK_BEGIN = '# >>> wizard-ssh completion >>>';
const BLOCK_END = '# <<< wizard-ssh completion <<<';

export interface InstallResult {
  shell: Shell;
  /** The completion file we wrote (a `_wssh` autoload fn, a `.bash` source, …). */
  file: string;
  /** The rc file we touched, if any (bash / plain zsh). */
  rcFile?: string;
  /** Whether we added/updated a block in the rc file (false → nothing to edit). */
  rcEdited: boolean;
  /** oh-my-zsh detected → completions go on its fpath, no rc edit needed. */
  ohMyZsh: boolean;
  /** Commands the user can run now to load completion without a full restart. */
  reloadHints: string[];
}

export interface UninstallResult {
  shell: Shell;
  /** Files we removed (may be empty if nothing was installed). */
  removed: string[];
  rcFile?: string;
  rcEdited: boolean;
}

const home = (): string => os.homedir();

/** Detect the user's shell from $SHELL (e.g. /bin/zsh → 'zsh'). Returns undefined
 *  when it isn't one we support, so the caller can ask the user to be explicit. */
export function detectShell(): Shell | undefined {
  const base = path.basename(process.env.SHELL ?? '').toLowerCase();
  if (base === 'bash' || base === 'zsh' || base === 'fish') return base;
  return undefined;
}

/** True when this looks like an oh-my-zsh install. oh-my-zsh runs compinit itself
 *  and keeps a few completion dirs on $fpath, so we drop our file in one of those
 *  instead of editing .zshrc. */
function ohMyZshDir(): string | undefined {
  const zsh = process.env.ZSH?.trim() || path.join(home(), '.oh-my-zsh');
  if (!fs.existsSync(zsh)) return undefined;
  // $ZSH_CUSTOM/completions survives oh-my-zsh self-updates; prefer it.
  const custom = process.env.ZSH_CUSTOM?.trim() || path.join(zsh, 'custom');
  return path.join(custom, 'completions');
}

function writeFileTree(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** Insert or replace our managed block in an rc file. Returns true if the file
 *  changed (false when the desired block was already present verbatim). */
function upsertBlock(rcFile: string, body: string): boolean {
  const block = `${BLOCK_BEGIN}\n${body}\n${BLOCK_END}\n`;
  let text = '';
  try {
    text = fs.readFileSync(rcFile, 'utf8');
  } catch {
    /* rc file doesn't exist yet — we'll create it */
  }
  const re = new RegExp(`${escapeRe(BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, 'm');
  let next: string;
  if (re.test(text)) {
    next = text.replace(re, block);
  } else {
    // Keep a blank line before our block for readability.
    next = text.length && !text.endsWith('\n') ? `${text}\n${block}` : `${text}${block}`;
  }
  if (next === text) return false;
  fs.mkdirSync(path.dirname(rcFile), { recursive: true });
  fs.writeFileSync(rcFile, next);
  return true;
}

/** Remove our managed block from an rc file. Returns true if anything changed. */
function removeBlock(rcFile: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(rcFile, 'utf8');
  } catch {
    return false;
  }
  const re = new RegExp(`\\n?${escapeRe(BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, 'm');
  const next = text.replace(re, '\n');
  if (next === text) return false;
  fs.writeFileSync(rcFile, next);
  return true;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Delete stale compinit dump caches so a freshly installed `_wssh` is picked up
 *  on the next shell start instead of being masked by a cached function table. */
function clearZcompdump(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(home());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('.zcompdump')) continue;
    const p = path.join(home(), name);
    try {
      if (fs.statSync(p).isFile()) fs.rmSync(p, { force: true });
    } catch {
      /* best-effort cache clear */
    }
  }
}

const xdgConfig = (): string => process.env.XDG_CONFIG_HOME?.trim() || path.join(home(), '.config');
const xdgData = (): string =>
  process.env.XDG_DATA_HOME?.trim() || path.join(home(), '.local', 'share');

// ---- per-shell install ---------------------------------------------------

function installBash(): InstallResult {
  const file = path.join(xdgData(), 'wizard-ssh', 'wssh.bash');
  writeFileTree(file, completionScript('bash'));
  const rcFile = path.join(home(), '.bashrc');
  const rcEdited = upsertBlock(rcFile, `[ -f "${file}" ] && source "${file}"`);
  return {
    shell: 'bash',
    file,
    rcFile,
    rcEdited,
    ohMyZsh: false,
    reloadHints: [`source ${tildify(rcFile)}`],
  };
}

function installZsh(): InstallResult {
  const omz = ohMyZshDir();
  let dir: string;
  let rcFile: string | undefined;
  let rcEdited = false;
  if (omz) {
    dir = omz; // already on fpath; oh-my-zsh runs compinit for us
  } else {
    dir = path.join(home(), '.zsh', 'completions');
    rcFile = path.join(home(), '.zshrc');
    // Put our dir on fpath and make sure compinit runs (harmless if it already
    // does elsewhere in the rc). Must come before our completion is used.
    rcEdited = upsertBlock(rcFile, `fpath=("${dir}" $fpath)\nautoload -Uz compinit && compinit`);
  }
  const file = path.join(dir, '_wssh');
  writeFileTree(file, completionScript('zsh'));
  clearZcompdump();
  return {
    shell: 'zsh',
    file,
    rcFile,
    rcEdited,
    ohMyZsh: Boolean(omz),
    reloadHints: ['exec zsh'],
  };
}

function installFish(): InstallResult {
  // fish auto-loads any file under completions/ on demand — no rc edit needed.
  const file = path.join(xdgConfig(), 'fish', 'completions', 'wssh.fish');
  writeFileTree(file, completionScript('fish'));
  return {
    shell: 'fish',
    file,
    rcEdited: false,
    ohMyZsh: false,
    reloadHints: ['exec fish'],
  };
}

export function installCompletion(shell: Shell): InstallResult {
  if (shell === 'bash') return installBash();
  if (shell === 'zsh') return installZsh();
  return installFish();
}

// ---- per-shell uninstall -------------------------------------------------

export function uninstallCompletion(shell: Shell): UninstallResult {
  const removed: string[] = [];
  const rm = (f: string): void => {
    try {
      if (fs.existsSync(f)) {
        fs.rmSync(f, { force: true });
        removed.push(f);
      }
    } catch {
      /* best-effort */
    }
  };

  if (shell === 'bash') {
    rm(path.join(xdgData(), 'wizard-ssh', 'wssh.bash'));
    const rcFile = path.join(home(), '.bashrc');
    return { shell, removed, rcFile, rcEdited: removeBlock(rcFile) };
  }
  if (shell === 'zsh') {
    const omz = ohMyZshDir();
    if (omz) rm(path.join(omz, '_wssh'));
    rm(path.join(home(), '.zsh', 'completions', '_wssh'));
    clearZcompdump();
    const rcFile = path.join(home(), '.zshrc');
    return { shell, removed, rcFile, rcEdited: removeBlock(rcFile) };
  }
  rm(path.join(xdgConfig(), 'fish', 'completions', 'wssh.fish'));
  return { shell, removed, rcEdited: false };
}

/** Shorten an absolute path under $HOME to `~/…` for friendlier output. */
export function tildify(p: string): string {
  const h = home();
  return p === h ? '~' : p.startsWith(h + path.sep) ? `~${p.slice(h.length)}` : p;
}
