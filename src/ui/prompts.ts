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
import { NotInteractiveError, PromptAbortError } from '../core/errors.js';

export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export function ensureInteractive(what?: string): void {
  if (!isInteractive()) throw new NotInteractiveError(what);
}

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
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
  return guard(_input({ message: opts.message, default: opts.default, validate: opts.validate }));
}

export function secret(opts: {
  message: string;
  validate?: (v: string) => boolean | string;
}): Promise<string> {
  return guard(_password({ message: opts.message, mask: '•', validate: opts.validate }));
}

export function confirm(opts: { message: string; default?: boolean }): Promise<boolean> {
  return guard(_confirm({ message: opts.message, default: opts.default }));
}

export function choose<V>(opts: {
  message: string;
  choices: Array<Choice<V>>;
  pageSize?: number;
  default?: V;
}): Promise<V> {
  return guard(
    _select<V>({
      message: opts.message,
      choices: opts.choices,
      pageSize: opts.pageSize ?? 12,
      ...(opts.default !== undefined ? { default: opts.default } : {}),
    }),
  );
}

export function multiChoose<V>(opts: {
  message: string;
  choices: Array<Choice<V>>;
  pageSize?: number;
}): Promise<V[]> {
  return guard(
    _checkbox<V>({ message: opts.message, choices: opts.choices, pageSize: opts.pageSize ?? 14 }),
  );
}

/** Fuzzy autocomplete: `source` is called with the live search term. */
export function searchChoose<V>(opts: {
  message: string;
  source: (term: string | undefined) => Promise<Array<Choice<V>>> | Array<Choice<V>>;
  pageSize?: number;
}): Promise<V> {
  return guard(
    _search<V>({
      message: opts.message,
      pageSize: opts.pageSize ?? 12,
      source: async (term) => opts.source(term),
    }),
  );
}

export async function pause(message = '↩ Enter — назад'): Promise<void> {
  await guard(_input({ message }));
}
