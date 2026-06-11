/** Shared submenu machinery for every interactive menu (main menu, ssh-agent,
 *  …): one navigation state machine, so pause/abort/clear semantics can't
 *  drift between hand-rolled copies. */

import { PromptAbortError } from '../core/errors.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

export interface MenuItem {
  label: string;
  value: string;
}

/** A navigation menu using the list prompt; returns the chosen value or BACK.
 *  `crumbs` are the ancestor titles shown before the active one. */
export async function menuChoose(
  message: string,
  items: MenuItem[],
  crumbs: string[] = [],
): Promise<string | typeof ui.BACK> {
  const res = await ui.pickFromList<MenuItem>({
    message,
    items,
    render: (i) => i.label,
    search: (i) => i.label,
    pageSize: 14,
    crumbs,
    indent: crumbs.length * 2,
  });
  return res === ui.BACK ? ui.BACK : res.value;
}

export interface LoopOptions {
  /** Re-rendered at the top of every pass (after the screen clear, before the
   *  picker) — for menus whose context changes between actions, e.g. the
   *  ssh-agent identity list or the keys table. */
  header?: () => void;
}

/** A submenu loop: PromptAbort inside an action returns to this menu, not exit.
 *  An action handler may return `true` to mark itself as pure NAVIGATION — it ran
 *  its own sub-view (a browse list or a nested menu) that already handled backing
 *  out and left nothing one-shot to read. The loop then skips the trailing
 *  "↩ Enter — назад" pause and drops straight back to this menu, so Esc out of a
 *  sub-list lands here immediately instead of on an extra press-Enter screen.
 *  One-shot actions (add/edit/status/…) return void and still pause so their
 *  output is readable before the screen clears. */
export async function loop(
  title: string,
  crumbs: string[],
  items: MenuItem[],
  run: (action: string) => Promise<boolean | void>,
  opts: LoopOptions = {},
): Promise<void> {
  for (;;) {
    ui.clearScreen();
    opts.header?.();
    let action: string | typeof ui.BACK;
    try {
      action = await menuChoose(title, items, crumbs);
    } catch (e) {
      if (e instanceof PromptAbortError) return;
      throw e;
    }
    if (action === ui.BACK) return;
    ui.clearScreen(); // wipe the menu before the action's own output
    let navigated = false;
    try {
      navigated = (await run(action)) === true;
    } catch (e) {
      // Esc / Ctrl+C out of an action → return straight to this menu, no extra
      // press-Enter pause (a real error still pauses so it can be read).
      if (e instanceof PromptAbortError) navigated = true;
      else ui.printError(tr.common.error(e instanceof Error ? e.message : String(e)));
    }
    if (!navigated) await ui.pause();
  }
}
