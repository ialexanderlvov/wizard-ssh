import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Point HOME (and therefore ~/.wizard-ssh and ~/.ssh) at a fresh temp dir.
 * Combine with `vi.resetModules()` + dynamic `import()` so the path/store/vault
 * singletons re-evaluate against this isolated home. Returns the temp dir.
 */
export function freshHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wssh-test-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  delete process.env.WIZARD_SSH_HOME;
  return dir;
}

/** Strip ANSI colour codes for stable string assertions. */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

export interface PromptQueues {
  text: unknown[];
  choose: unknown[];
  confirm: unknown[];
  secret: unknown[];
  multi: unknown[];
  search: unknown[];
  /** Selections for the custom list prompt — see {@link listMock}. */
  pick?: unknown[];
}

/**
 * Scripted stand-in for src/ui/prompts. Crucially it *invokes* each prompt's
 * `validate`/`source` callback (so those closures are exercised + covered),
 * then returns the next queued answer.
 */
export function promptMock(q: PromptQueues) {
  return {
    isInteractive: () => true,
    ensureInteractive: () => {},
    // A queued Error is thrown rather than returned, so a test can enqueue a
    // PromptCancelError to simulate the user pressing Esc to back out of a prompt.
    text: async (o?: { validate?: (v: string) => unknown }) => {
      const v = q.text.shift();
      if (v instanceof Error) throw v;
      o?.validate?.(String(v ?? ''));
      return v;
    },
    secret: async (o?: { validate?: (v: string) => unknown }) => {
      const v = q.secret.shift();
      if (v instanceof Error) throw v;
      o?.validate?.(String(v ?? ''));
      return v;
    },
    choose: async () => {
      const v = q.choose.shift();
      if (v instanceof Error) throw v;
      return v;
    },
    confirm: async () => {
      const v = q.confirm.shift();
      if (v instanceof Error) throw v;
      return v;
    },
    multiChoose: async () => q.multi.shift(),
    searchChoose: async (o?: { source?: (t: string | undefined) => unknown }) => {
      await o?.source?.('');
      await o?.source?.(String((q.search[0] as string) ?? ''));
      return q.search.shift();
    },
    pause: async () => {},
  };
}

interface ListConfigLike {
  items?: unknown[];
  search?: (it: unknown) => string;
  render?: (it: unknown) => string;
}

/** Queue this to make the mocked picker return BACK (e.g. Esc / «← Назад»). */
export const PICK_BACK = '__BACK__';

/**
 * Scripted stand-in for src/ui/list-prompt.js (the custom filter/sort picker).
 * It MUST be doMock'd alongside promptMock so that `ui.BACK` resolves to the
 * very symbol this mock returns (both come from the same mocked module).
 *
 * Each queued `q.pick` entry resolves against the picker's `items`:
 *   • an Error          → thrown (simulate Ctrl+C via PromptAbortError)
 *   • a function        → called with `items`; its result is returned
 *   • PICK_BACK / empty → BACK (also how loop-menus terminate)
 *   • a string          → first item whose `.value` === it (menu/settings/vault
 *                         rows), else the first item whose search/render text
 *                         contains it (servers/tunnels/config hosts — i.e. match
 *                         by name or alias). No match → BACK.
 */
export function listMock(q: { pick?: unknown[] }) {
  const BACK = Symbol('mock-pickFromList-BACK');
  const pickFromList = async (config: ListConfigLike): Promise<unknown> => {
    const queue = (q.pick ??= []);
    const sel = queue.shift();
    if (sel instanceof Error) throw sel;
    if (sel === undefined || sel === PICK_BACK) return BACK;
    if (typeof sel === 'function') {
      const r = (sel as (items: unknown[]) => unknown)(config.items ?? []);
      return r === undefined ? BACK : r;
    }
    const items = config.items ?? [];
    const byValue = items.find(
      (it) =>
        it != null &&
        typeof it === 'object' &&
        'value' in it &&
        (it as { value: unknown }).value === sel,
    );
    if (byValue !== undefined) return byValue;
    const needle = String(sel).toLowerCase();
    const byText = items.find((it) => {
      const hay = config.search ? config.search(it) : config.render ? config.render(it) : '';
      return String(hay).toLowerCase().includes(needle);
    });
    return byText === undefined ? BACK : byText;
  };
  return { BACK, pickFromList };
}
