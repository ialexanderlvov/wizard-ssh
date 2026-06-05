/**
 * Interactive filesystem browser — step through directories instead of typing a
 * path blind. Live filter, sortable (name / size / date), hidden-file toggle,
 * quick jumps, and a manual "go to path" fallback. Used everywhere a file or
 * folder path is asked for. Built on @inquirer/core, sibling to list-prompt.
 *
 * Hotkeys:
 *   type        filter the current folder
 *   ↑ / ↓       move           → / Enter   open a folder
 *   ←           up one level   Enter        choose a file (or the folder, in dir mode)
 *   Tab         cycle sort (name / size / date)
 *   Ctrl+H      toggle hidden (dot)files
 *   Ctrl+G      type a path manually (go to / create)
 *   ~           jump to home   /            jump to root   (when the filter is empty)
 *   Esc         cancel (or leave manual-path mode)
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  createPrompt,
  useState,
  useKeypress,
  usePagination,
  isEnterKey,
  isUpKey,
  isDownKey,
  isBackspaceKey,
} from '@inquirer/core';
import { chalk, brand } from './theme.js';
import { tilde, expandHome, stripControl } from '../utils/strings.js';
import { PromptAbortError } from '../core/errors.js';
import { BACK, type Picked } from './list-prompt.js';
import { tr } from '../i18n/index.js';

export { BACK } from './list-prompt.js';

/** What a successful pick must resolve to. */
export type PathSelect = 'file' | 'directory' | 'any';

export interface FilePickerConfig {
  message: string;
  /** initial directory (a file path uses its parent). Defaults to cwd. */
  start?: string;
  /** what Enter may select. 'any' = a file OR (via the top row) the folder. */
  select?: PathSelect;
  /** allow returning a path that does not exist yet (type a name) — for save. */
  allowCreate?: boolean;
  /** show dotfiles from the start (default false). */
  showHidden?: boolean;
  /** restrict which files are shown/selectable (dirs always shown). */
  fileFilter?: (name: string) => boolean;
}

interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

interface RawKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  sequence?: string;
}

const isPrintable = (key: RawKey): boolean =>
  !key.ctrl &&
  !key.meta &&
  typeof key.sequence === 'string' &&
  key.sequence.length === 1 &&
  key.sequence >= ' ';

function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n}B`;
  const units = ['K', 'M', 'G', 'T'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[i]}`;
}

/** Read a directory into entries; `ok=false` when it couldn't be read. */
function readDir(dir: string): { entries: FsEntry[]; ok: boolean } {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { entries: [], ok: false };
  }
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    let isDir = d.isDirectory();
    let size = 0;
    let mtimeMs = 0;
    try {
      // stat (follow symlinks) so a linked directory is navigable and sizes/dates
      // are real; fall back to the dirent type if the target is unreachable.
      const st = fs.statSync(full);
      isDir = st.isDirectory();
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      /* broken symlink / permission — keep the dirent's guess */
    }
    entries.push({ name: d.name, isDir, size, mtimeMs });
  }
  return { entries, ok: true };
}

const SORTS = ['name', 'size', 'modified'] as const;
type SortMode = (typeof SORTS)[number];

function sortEntries(entries: FsEntry[], mode: SortMode): FsEntry[] {
  // Folders always come first; the mode orders within each group.
  const cmp = (a: FsEntry, b: FsEntry): number => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (mode === 'size') return b.size - a.size || a.name.localeCompare(b.name);
    if (mode === 'modified') return b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  };
  return [...entries].sort(cmp);
}

/** Resolve the initial directory: a directory as-is, a file's parent, else cwd. */
function resolveStart(start?: string): string {
  const guess = start ? path.resolve(expandHome(start)) : process.cwd();
  try {
    const st = fs.statSync(guess);
    return st.isDirectory() ? guess : path.dirname(guess);
  } catch {
    // doesn't exist yet (e.g. a save path): use the closest existing ancestor.
    let dir = path.dirname(guess);
    for (let i = 0; i < 64; i++) {
      try {
        if (fs.statSync(dir).isDirectory()) return dir;
      } catch {
        /* keep walking up */
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return process.cwd();
  }
}

// Synthetic, non-filtered action rows shown above the real entries.
type Row =
  | { kind: 'chooseDir' }
  | { kind: 'create' }
  | { kind: 'parent' }
  | { kind: 'entry'; entry: FsEntry }
  | typeof BACK;

const filePicker = createPrompt<string | typeof BACK, FilePickerConfig>((cfg, done) => {
  const select: PathSelect = cfg.select ?? 'any';
  const allowCreate = cfg.allowCreate ?? false;

  const [cwd, setCwd] = useState(resolveStart(cfg.start));
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [showHidden, setShowHidden] = useState(cfg.showHidden ?? false);
  // null = browsing; a string = manual "go to / create" input buffer.
  const [goto, setGoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'done'>('idle');

  // Read straight from the current dir each render: always reflects `cwd` with no
  // effect-timing or cache-staleness bugs. The folders browsed here (~/.ssh,
  // project dirs) are small; filtering/sorting below operate on the result.
  const { entries, ok: readOk } = readDir(cwd);

  const navigate = (dir: string): void => {
    setError('');
    setCwd(dir);
    setCursor(0);
    setTerm('');
    setGoto(null);
  };

  const sortMode = SORTS[sortIdx % SORTS.length]!;
  const sortLabel = {
    name: tr.ui.filePicker.sortName,
    size: tr.ui.filePicker.sortSize,
    modified: tr.ui.filePicker.sortModified,
  }[sortMode];

  // Filter (hidden + filename term + caller file filter), then sort.
  const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = sortEntries(
    entries.filter((e) => {
      if (!showHidden && e.name.startsWith('.')) return false;
      if (!e.isDir && cfg.fileFilter && !cfg.fileFilter(e.name)) return false;
      if (tokens.length) {
        const hay = e.name.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    }),
    sortMode,
  );

  const atRoot = path.dirname(cwd) === cwd;
  const rows: Row[] = [];
  if (select === 'directory' || select === 'any') rows.push({ kind: 'chooseDir' });
  if (allowCreate) rows.push({ kind: 'create' });
  if (!atRoot) rows.push({ kind: 'parent' });
  for (const entry of visible) rows.push({ kind: 'entry', entry });
  rows.push(BACK);

  const active = Math.min(cursor, rows.length - 1);

  /** Resolve a manual path buffer against cwd / home / absolute. */
  const resolveInput = (raw: string): string => {
    const t = raw.trim();
    if (!t) return cwd;
    const ex = expandHome(t);
    return path.isAbsolute(ex) ? path.resolve(ex) : path.resolve(cwd, ex);
  };

  const finishFile = (p: string): void => {
    setStatus('done');
    done(p);
  };

  const commitGoto = (): void => {
    const target = resolveInput(goto ?? '');
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(target);
    } catch {
      st = null;
    }
    if (st?.isDirectory()) {
      navigate(target); // walk into it
      return;
    }
    if (st) {
      // existing file
      if (select === 'directory') {
        setError(tr.ui.filePicker.mustBeDir);
        return;
      }
      finishFile(target);
      return;
    }
    // doesn't exist
    if (allowCreate) {
      finishFile(target);
      return;
    }
    setError(tr.ui.filePicker.notExist(tilde(target)));
  };

  const act = (row: Row): void => {
    setError('');
    if (row === BACK) {
      setStatus('done');
      done(BACK);
      return;
    }
    if (row.kind === 'chooseDir') {
      setStatus('done');
      done(cwd);
      return;
    }
    if (row.kind === 'create') {
      setGoto('');
      return;
    }
    if (row.kind === 'parent') {
      navigate(path.dirname(cwd));
      return;
    }
    // an entry
    const full = path.join(cwd, row.entry.name);
    if (row.entry.isDir) {
      navigate(full);
      return;
    }
    if (select === 'directory') {
      setError(tr.ui.filePicker.mustBeDir);
      return;
    }
    finishFile(full);
  };

  useKeypress((key, rl) => {
    const raw = key as RawKey;
    if (status === 'done') return;

    // ---- manual "go to path" mode ----
    if (goto !== null) {
      if (isEnterKey(key)) commitGoto();
      else if (key.name === 'escape') {
        setGoto(null);
        setError('');
      } else if (isBackspaceKey(key)) setGoto(goto.slice(0, -1));
      else if (isPrintable(raw)) setGoto(goto + raw.sequence);
      rl.clearLine(0);
      return;
    }

    // ---- browsing mode ----
    if (isEnterKey(key)) {
      act(rows[active] ?? BACK);
    } else if (key.name === 'escape') {
      setStatus('done');
      done(BACK);
    } else if (isUpKey(key)) {
      setCursor((active - 1 + rows.length) % rows.length);
    } else if (isDownKey(key)) {
      setCursor((active + 1) % rows.length);
    } else if (key.name === 'right') {
      // open the active folder (no-op on files / action rows)
      const r = rows[active];
      if (r && r !== BACK && r.kind === 'entry' && r.entry.isDir)
        navigate(path.join(cwd, r.entry.name));
      else if (r && r !== BACK && r.kind === 'parent') navigate(path.dirname(cwd));
    } else if (key.name === 'left') {
      if (!atRoot) navigate(path.dirname(cwd));
    } else if (raw.name === 'tab') {
      setSortIdx((sortIdx + 1) % SORTS.length);
      setCursor(0);
    } else if (raw.ctrl && raw.name === 'h') {
      setShowHidden(!showHidden);
      setCursor(0);
    } else if (raw.ctrl && raw.name === 'g') {
      setGoto('');
    } else if (isBackspaceKey(key)) {
      if (term) {
        setTerm(term.slice(0, -1));
        setCursor(0);
      }
    } else if (isPrintable(raw)) {
      // ~ and / are quick jumps only when not already filtering.
      if (!term && raw.sequence === '~') navigate(os.homedir());
      else if (!term && raw.sequence === '/') navigate(path.parse(cwd).root || '/');
      else {
        setTerm(term + raw.sequence);
        setCursor(0);
      }
    }
    rl.clearLine(0);
  });

  const renderRow = (row: Row, isActive: boolean): string => {
    const pointer = isActive ? chalk.cyan('❯') : ' ';
    if (row === BACK) return `${pointer} ${chalk.dim(tr.common.back)}`;
    if (row.kind === 'chooseDir')
      return `${pointer} ${chalk.green(tr.ui.filePicker.chooseDir(tilde(cwd)))}`;
    if (row.kind === 'create') return `${pointer} ${chalk.yellow(tr.ui.filePicker.create)}`;
    if (row.kind === 'parent') return `${pointer} ${chalk.cyan(tr.ui.filePicker.parent)}`;
    const e = row.entry;
    // Sanitize the displayed name: a directory we browse may hold an attacker-
    // placed filename with raw terminal escapes (cursor moves / line clears /
    // OSC-8 spoofing) that could repaint rows and trick the operator into picking
    // a different path than they see. The real fs name (path.join below) is left
    // untouched — only the rendered string is stripped.
    const name = stripControl(e.name);
    if (e.isDir) return `${pointer} ${chalk.cyan.bold(name + tr.ui.filePicker.dirBadge)}`;
    const size = e.size ? chalk.dim(`  ${humanSize(e.size)}`) : '';
    return `${pointer} ${name}${size}`;
  };

  const page = usePagination<Row>({
    items: rows,
    active,
    pageSize: 14,
    loop: false,
    renderItem: ({ item, isActive }) => renderRow(item, isActive),
  });

  if (status === 'done') return '';

  const sep = chalk.dim(' › ');
  const header = `${brand('wssh')}${sep}${chalk.bold.cyan(cfg.message)}`;
  const where =
    chalk.dim('📂 ') + chalk.white(stripControl(tilde(cwd))) + (readOk ? '' : ' ' + chalk.red(''));
  const filterLine =
    goto !== null
      ? chalk.yellow('→ ') + tr.ui.filePicker.namePrompt + chalk.dim(': ') + goto + chalk.dim('▏')
      : term
        ? `${chalk.yellow('▸ ' + term)}${chalk.dim('▏')}`
        : '';
  const rule = chalk.dim('─'.repeat(60));

  const body = readOk
    ? visible.length || term || rows.length > 1
      ? page
      : chalk.dim(`  ${tr.ui.filePicker.emptyDir}\n${page}`)
    : `${chalk.red('  ' + tr.ui.filePicker.denied)}\n${page}`;

  const help =
    chalk.dim(tr.ui.filePicker.help) +
    '\n' +
    chalk.dim(tr.ui.filePicker.help2(sortLabel, showHidden));
  const errLine = error ? '\n' + chalk.red('  ' + error) : '';

  return [header, where + (filterLine ? '   ' + filterLine : ''), rule, body, rule, help + errLine]
    .filter(Boolean)
    .join('\n');
});

type PickerContext = Parameters<typeof filePicker>[1];

/** Browse the filesystem and return the chosen absolute path, or BACK. */
export async function pickPath(
  config: FilePickerConfig,
  context?: PickerContext,
): Promise<Picked<string>> {
  try {
    return (await filePicker(config, context)) as Picked<string>;
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    if (
      err?.name === 'ExitPromptError' ||
      err?.name === 'AbortPromptError' ||
      err?.code === 'ERR_USE_AFTER_CLOSE' ||
      /force closed|SIGINT|readline was closed/i.test(err?.message ?? '')
    ) {
      throw new PromptAbortError();
    }
    throw e;
  }
}
