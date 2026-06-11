/** Command-snippet CRUD: a named shell line (optionally bound to one server)
 *  that `wssh run` can replay instead of retyping the command. */

import { snippets, type Snippet } from '../store/snippets.store.js';
import { servers } from '../store/servers.store.js';
import { WizardError } from '../core/errors.js';
import { isValidName } from '../utils/validators.js';
import * as ui from '../ui/index.js';
import { pickEntity } from './helpers.js';
import { tr } from '../i18n/index.js';

export function listSnippetsFlow(opts: { json?: boolean } = {}): void {
  const list = snippets.all();
  if (opts.json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  if (!list.length) {
    ui.printWarn(tr.actions.snippetsEmpty);
    return;
  }
  ui.printSection('📌', tr.actions.snippetsSection(list.length));
  for (const s of list) {
    const scope = s.server ? ui.chalk.cyan(`  @${s.server}`) : '';
    console.log(`  ${ui.chalk.bold(s.name)}${scope}  ${ui.chalk.dim(s.command)}`);
  }
}

export async function addSnippetFlow(
  name?: string,
  opts: { command?: string; server?: string } = {},
): Promise<void> {
  const interactive = ui.isInteractive() && !ui.runtime.nonInteractive;

  let snName = name?.trim() ?? '';
  if (snName) {
    if (!isValidName(snName)) throw new WizardError(tr.actions.snippetBadName);
    if (snippets.nameExists(snName)) throw new WizardError(tr.actions.snippetNameTaken(snName));
  } else {
    if (!interactive) throw new WizardError(tr.actions.snippetNeedName);
    snName = (
      await ui.text({
        message: tr.actions.snippetNamePrompt,
        validate: (v) =>
          !isValidName(v.trim())
            ? tr.actions.snippetBadName
            : snippets.nameExists(v.trim())
              ? tr.actions.snippetNameTaken(v.trim())
              : true,
      })
    ).trim();
  }

  let command = opts.command?.trim() ?? '';
  if (!command) {
    if (!interactive) throw new WizardError(tr.actions.snippetNeedCommand);
    command = (
      await ui.text({
        message: tr.actions.snippetCommandPrompt,
        validate: (v) => v.trim().length > 0 || tr.common.empty,
      })
    ).trim();
  }

  // Optional binding to one server. Under --yes don't route through confirm —
  // it would force-bind every scripted add; the flag (--server) is the explicit
  // path there.
  let server: string | null = opts.server?.trim() || null;
  if (server) {
    // Validate the binding now — a dangling name would silently hide the
    // snippet from every run picker forever. Adopt the canonical casing.
    const bound = servers.findByName(server);
    if (!bound) throw new WizardError(tr.actions.snippetServerUnknown(server));
    server = bound.name;
  }
  if (!server && interactive && !ui.runtime.assumeYes && servers.all().length) {
    const bind = await ui.confirm({ message: tr.actions.snippetBindQuestion, default: false });
    if (bind) {
      const picked = await pickEntity(servers.all(), tr.actions.snippetPickServer);
      if (picked) server = picked.name;
    }
  }

  snippets.add({ name: snName, command, server });
  ui.printOk(tr.actions.snippetSaved(snName));
}

export async function removeSnippetFlow(name?: string): Promise<number> {
  const list = snippets.all();
  if (!list.length) {
    ui.printWarn(tr.actions.snippetsEmpty);
    return 0;
  }
  let target: Snippet | null = null;
  if (name) {
    target = snippets.findByName(name);
    if (!target) {
      ui.printError(tr.actions.snippetNotFound(name));
      return 1;
    }
  } else {
    ui.ensureInteractive(tr.actions.snippetsEnsure);
    const picked = await ui.pickFromList<Snippet>({
      message: tr.actions.snippetPickRemove,
      items: list,
      render: (s) =>
        `${ui.chalk.bold(s.name)}${s.server ? ui.chalk.cyan('  @' + s.server) : ''}  ${ui.chalk.dim(s.command)}`,
      search: (s) => `${s.name} ${s.command}`,
      pageSize: 14,
    });
    if (picked === ui.BACK) return 0;
    target = picked;
  }
  const ok = await ui.confirm({
    message: tr.actions.snippetConfirmRemove(target.name),
    default: false,
  });
  if (!ok) {
    ui.printInfo(tr.common.cancelled);
    return 0;
  }
  snippets.remove(target.id);
  ui.printOk(tr.actions.snippetRemoved(target.name));
  return 0;
}
