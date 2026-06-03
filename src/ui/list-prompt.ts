/**
 * One reusable interactive list used by every picker and list view:
 *  - type to fuzzy-filter (live)
 *  - Tab cycles the sort mode (when sorts are provided)
 *  - ↑/↓ move, Enter selects
 *  - Esc (or the trailing "← Назад" row) returns BACK — never quits the app
 *
 * Rows are rendered by the caller via `render`, so the look is consistent
 * everywhere. Built on @inquirer/core.
 */

import {
  createPrompt,
  useState,
  useEffect,
  useKeypress,
  usePagination,
  isEnterKey,
  isUpKey,
  isDownKey,
  isBackspaceKey,
} from '@inquirer/core';
import { chalk, brand } from './theme.js';
import { stripAnsi } from '../utils/strings.js';
import { PromptAbortError } from '../core/errors.js';

/** Returned when the user backs out (Esc / "← Назад") instead of choosing. */
export const BACK = Symbol('list:back');
export type Picked<T> = T | typeof BACK;

export interface ListSort<T> {
  label: string;
  compare: (a: T, b: T) => number;
}

export interface ListConfig<T> {
  message: string;
  items: readonly T[];
  /** one display line per item (caller controls colours/columns) */
  render: (item: T, active: boolean) => string;
  /** text used for filtering (defaults to the rendered line, ANSI-stripped) */
  search?: (item: T) => string;
  /** sort modes cycled with Tab */
  sorts?: ReadonlyArray<ListSort<T>>;
  pageSize?: number;
  /** label for the back row (default "← Назад") */
  backLabel?: string;
  /** empty-list note */
  emptyText?: string;
  /** breadcrumb ancestors shown dimmed before the active (bold) title */
  crumbs?: string[];
  /** left indent in spaces (typically menu depth × 2) */
  indent?: number;
}

interface RawKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

const isPrintable = (key: RawKey): boolean =>
  !key.ctrl &&
  !key.meta &&
  typeof key.sequence === 'string' &&
  key.sequence.length === 1 &&
  key.sequence >= ' ';

// The prompt is created once at module scope so @inquirer can bind it to the
// (real or test) streams passed via the context argument.
const listPrompt = createPrompt<unknown, ListConfig<unknown>>((cfg, done) => {
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [status, setStatus] = useState<'idle' | 'done'>('idle');

  // Node's readline waits `escapeCodeTimeout` ms (default 500) after a lone Esc
  // to tell it apart from an escape sequence — arrows, etc. all start with the
  // ESC byte. We only read local key presses here (sequences arrive atomically),
  // so shrink it; otherwise backing out with Esc lags about half a second.
  useEffect((rl) => {
    (rl as unknown as { escapeCodeTimeout: number }).escapeCodeTimeout = 1;
  }, []);

  const sorts = cfg.sorts ?? [];
  const searchOf = cfg.search ?? ((it: unknown) => stripAnsi(cfg.render(it, false)));
  const backLabel = cfg.backLabel ?? '← Назад';

  const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
  let view = cfg.items.filter((it) => {
    if (!tokens.length) return true;
    const hay = searchOf(it).toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  if (sorts.length) {
    const cmp = sorts[sortIdx % sorts.length]!.compare;
    view = [...view].sort(cmp);
  }

  // last entry is the BACK row
  const entries: Array<unknown> = [...view, BACK];
  const active = Math.min(cursor, entries.length - 1);

  useKeypress((key, rl) => {
    const raw = key as RawKey;
    if (status === 'done') return;
    if (isEnterKey(key)) {
      const sel = entries[active];
      setStatus('done');
      done(sel === BACK ? BACK : sel);
    } else if (key.name === 'escape') {
      setStatus('done');
      done(BACK);
    } else if (isUpKey(key)) {
      setCursor((active - 1 + entries.length) % entries.length);
    } else if (isDownKey(key)) {
      setCursor((active + 1) % entries.length);
    } else if (raw.name === 'tab' && sorts.length > 1) {
      setSortIdx((sortIdx + 1) % sorts.length);
      setCursor(0);
    } else if (isBackspaceKey(key)) {
      if (term) {
        setTerm(term.slice(0, -1));
        setCursor(0);
      }
    } else if (isPrintable(raw)) {
      setTerm(term + raw.sequence);
      setCursor(0);
    }
    // We own the term; never let readline echo or buffer input.
    rl.clearLine(0);
  });

  const page = usePagination<unknown>({
    items: entries,
    active,
    pageSize: cfg.pageSize ?? 10,
    loop: false,
    renderItem: ({ item, isActive }) => {
      const pointer = isActive ? chalk.cyan('❯') : ' ';
      if (item === BACK) return `${pointer} ${chalk.dim(backLabel)}`;
      return `${pointer} ${cfg.render(item, isActive)}`;
    },
  });

  // When finished we render nothing: the caller clears the screen between menus,
  // so only the active menu is ever visible (no piled-up answered prompts).
  if (status === 'done') return '';

  const pad = ' '.repeat(Math.max(0, cfg.indent ?? 0));
  const indentAll = (s: string): string =>
    s
      .split('\n')
      .map((l) => pad + l)
      .join('\n');

  // Breadcrumb: dim ancestors, bold active title, with a brand mark up front.
  const crumbs = cfg.crumbs ?? [];
  const sep = chalk.dim(' › ');
  const trail = [...crumbs.map((c) => chalk.dim(c)), chalk.bold.cyan(cfg.message)].join(sep);
  const count = chalk.dim(`(${view.length})`);
  const filter = term ? `   ${chalk.yellow('▸ ' + term)}${chalk.dim('▏')}` : '';
  const header = `${brand('wssh')}${sep}${trail}   ${count}${filter}`;

  const rule = chalk.dim('─'.repeat(56));
  const sortHint =
    sorts.length > 1
      ? `${chalk.dim('  ·  Tab:')} ${chalk.cyan(sorts[sortIdx % sorts.length]!.label)}`
      : '';
  const help = chalk.dim('фильтр: печатай · ↑↓ — выбор · Enter — выбрать · Esc — назад') + sortHint;

  const body =
    view.length || term ? page : chalk.dim(`  ${cfg.emptyText ?? 'ничего нет'}\n${page}`);
  return indentAll([header, rule, body, rule, help].join('\n'));
});

type ListContext = Parameters<typeof listPrompt>[1];

export async function pickFromList<T>(
  config: ListConfig<T>,
  context?: ListContext,
): Promise<Picked<T>> {
  try {
    return (await listPrompt(config as ListConfig<unknown>, context)) as Picked<T>;
  } catch (e) {
    // @inquirer/core rejects with ExitPromptError on Ctrl+C (SIGINT). Convert it
    // to PromptAbortError so callers handle it like every other prompt does
    // (clean «Отменено.» / exit 130) instead of crashing with a raw stack trace.
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
