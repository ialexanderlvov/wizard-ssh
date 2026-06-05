/** Thin, typed wrappers over @inquirer/prompts with a non-TTY guard and a
 *  uniform Ctrl+C → PromptAbortError conversion, so callers never see a raw
 *  readline crash. */

import {
  input as _input,
  select as _select,
  confirm as _confirm,
  password as _password,
  checkbox as _checkbox,
  search as _search,
} from '@inquirer/prompts';
import { NotInteractiveError, PromptAbortError, PromptCancelError } from '../core/errors.js';
import { runtime } from './runtime.js';
import { expandHome } from '../utils/strings.js';
import { pickPath, BACK, type PathSelect } from './file-picker.js';
import { tr } from '../i18n/index.js';

export const isInteractive = (): boolean =>
  !runtime.nonInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY);

export function ensureInteractive(what?: string): void {
  if (!isInteractive()) throw new NotInteractiveError(what);
}

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    // Esc cancels via the AbortSignal we wire in askWithEscape → AbortPromptError.
    // Surface it as a soft PromptCancelError so editing menus can return to their
    // own screen, distinct from Ctrl+C below (which force-quits the prompt).
    if (err?.name === 'AbortPromptError') throw new PromptCancelError();
    if (
      err?.name === 'ExitPromptError' ||
      err?.code === 'ERR_USE_AFTER_CLOSE' ||
      /force closed|SIGINT|readline was closed/i.test(err?.message ?? '')
    ) {
      throw new PromptAbortError();
    }
    throw e;
  }
}

/** Context handed to an @inquirer prompt — carries the AbortSignal we cancel on. */
type PromptContext = { signal?: AbortSignal };

/** Run an @inquirer prompt with Esc-to-cancel wired in. While the prompt is open
 *  we watch stdin for a lone ESC byte and abort the prompt's AbortSignal, so the
 *  user can leave a value-edit prompt without submitting a value (→ guard turns
 *  the resulting AbortPromptError into PromptCancelError). A bare 0x1b is the
 *  Escape key; escape SEQUENCES (arrows, Alt-combos, …) start with 0x1b but carry
 *  more bytes, so only a single-byte chunk counts — arrows never cancel. Without a
 *  TTY there is no raw key stream to watch, so we just run the prompt as-is. */
function askWithEscape<T>(factory: (ctx: PromptContext) => Promise<T>): Promise<T> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return guard(factory({}));
  const controller = new AbortController();
  const onData = (chunk: Buffer | string): void => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (buf.length === 1 && buf[0] === 0x1b) controller.abort();
  };
  // A parallel 'data' listener only observes the bytes (Node fans each chunk out
  // to every listener); inquirer's own readline still receives and parses them.
  stdin.on('data', onData);
  return guard(factory({ signal: controller.signal })).finally(() => {
    stdin.removeListener('data', onData);
  });
}

export interface Choice<V> {
  name: string;
  value: V;
  description?: string;
  disabled?: boolean | string;
}

export function text(opts: {
  message: string;
  default?: string;
  validate?: (v: string) => boolean | string;
}): Promise<string> {
  return askWithEscape((ctx) =>
    _input({ message: opts.message, default: opts.default, validate: opts.validate }, ctx),
  );
}

export function secret(opts: {
  message: string;
  validate?: (v: string) => boolean | string;
}): Promise<string> {
  return askWithEscape((ctx) =>
    _password({ message: opts.message, mask: '•', validate: opts.validate }, ctx),
  );
}

export function confirm(opts: { message: string; default?: boolean }): Promise<boolean> {
  // `--yes` assumes "yes" to every confirmation (for unattended/scripted runs).
  if (runtime.assumeYes) return Promise.resolve(true);
  return askWithEscape((ctx) => _confirm({ message: opts.message, default: opts.default }, ctx));
}

export function choose<V>(opts: {
  message: string;
  choices: Array<Choice<V>>;
  pageSize?: number;
  default?: V;
}): Promise<V> {
  return askWithEscape((ctx) =>
    _select<V>(
      {
        message: opts.message,
        choices: opts.choices,
        pageSize: opts.pageSize ?? 12,
        ...(opts.default !== undefined ? { default: opts.default } : {}),
      },
      ctx,
    ),
  );
}

export function multiChoose<V>(opts: {
  message: string;
  choices: Array<Choice<V>>;
  pageSize?: number;
}): Promise<V[]> {
  return askWithEscape((ctx) =>
    _checkbox<V>(
      { message: opts.message, choices: opts.choices, pageSize: opts.pageSize ?? 14 },
      ctx,
    ),
  );
}

/** Fuzzy autocomplete: `source` is called with the live search term. */
export function searchChoose<V>(opts: {
  message: string;
  source: (term: string | undefined) => Promise<Array<Choice<V>>> | Array<Choice<V>>;
  pageSize?: number;
}): Promise<V> {
  return askWithEscape((ctx) =>
    _search<V>(
      {
        message: opts.message,
        pageSize: opts.pageSize ?? 12,
        source: async (term) => opts.source(term),
      },
      ctx,
    ),
  );
}

export interface PromptPathOptions {
  message: string;
  /** what the result must be (default 'any': a file, or the folder via its row). */
  select?: PathSelect;
  /** allow a path that doesn't exist yet (type a name) — for save targets. */
  allowCreate?: boolean;
  /** initial directory to open the browser at (a file path opens its parent). */
  start?: string;
  /** non-interactive fallback default (also seeds the browser's start dir). */
  default?: string;
  /** empty result is acceptable (Esc/back returns '' instead of cancelling). */
  optional?: boolean;
  fileFilter?: (name: string) => boolean;
  /** validation for the non-interactive text fallback. */
  validate?: (v: string) => boolean | string;
}

/** Ask for a path. Interactive → the filesystem browser (pickPath); otherwise a
 *  plain text prompt, so scripted / non-TTY use is unchanged. Backing out throws
 *  PromptCancelError (like every other prompt) unless `optional`, where it
 *  returns the default (or ''). The returned path is expanded/absolute. */
export async function promptPath(opts: PromptPathOptions): Promise<string> {
  if (isInteractive()) {
    const picked = await pickPath({
      message: opts.message,
      start: opts.start ?? opts.default,
      select: opts.select,
      allowCreate: opts.allowCreate,
      fileFilter: opts.fileFilter,
    });
    if (picked === BACK) {
      if (opts.optional) return opts.default ? expandHome(opts.default) : '';
      throw new PromptCancelError();
    }
    return picked;
  }
  const v = (
    await text({ message: opts.message, default: opts.default, validate: opts.validate })
  ).trim();
  return v ? expandHome(v) : v;
}

export async function pause(message = tr.ui.pause): Promise<void> {
  // Esc dismisses the pause just like Enter — it only waits for acknowledgement,
  // so a soft cancel means "go on", while Ctrl+C still aborts up the stack.
  try {
    await askWithEscape((ctx) => _input({ message }, ctx));
  } catch (e) {
    if (e instanceof PromptCancelError) return;
    throw e;
  }
}
