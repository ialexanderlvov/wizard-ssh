/** Shell completion for bash / zsh / fish.
 *
 *  The shell scripts are intentionally tiny: on <TAB> they call the hidden
 *  `wssh complete -- <words>` and feed back whatever it prints (one candidate per
 *  line). All the logic lives here in Node, so completion never drifts from the
 *  real command tree and can offer DYNAMIC values (server / tunnel / config-host /
 *  tag names) the shell could never know on its own.
 *
 *  Static candidates (commands, subcommands, flags) are read straight off the
 *  commander program, so any command added later is completed automatically. */

import type { Command } from 'commander';
import { servers } from '../store/servers.store.js';
import { tunnels, tempTunnels } from '../store/tunnels.store.js';
import * as sshConfig from '../ssh-config/index.js';

export type Shell = 'bash' | 'zsh' | 'fish';

/** Which entity names a leaf command's positional argument accepts. Keyed by the
 *  canonical command path (space-joined). This is the one bit of app knowledge
 *  commander can't give us. */
type NameKind = 'server' | 'tunnel' | 'both' | 'config' | 'tag';
const NAME_KIND: Record<string, NameKind> = {
  connect: 'both',
  check: 'both',
  'copy-id': 'server',
  run: 'server',
  transfer: 'server',
  'forget-host': 'server',
  'server connect': 'server',
  'server edit': 'server',
  'server remove': 'server',
  'server duplicate': 'server',
  'tunnel connect': 'tunnel',
  'tunnel edit': 'tunnel',
  'tunnel remove': 'tunnel',
  'tunnel clone': 'tunnel',
  'tunnel start': 'tunnel',
  'tunnel down': 'tunnel',
  'tunnel logs': 'tunnel',
  'config connect': 'config',
  'config edit': 'config',
  'config remove': 'config',
  'group check': 'tag',
};

const isHidden = (c: Command): boolean => (c as unknown as { _hidden?: boolean })._hidden === true;

/** Visible subcommand names of a command (canonical names, no aliases/hidden). */
function subNames(cmd: Command): string[] {
  return cmd.commands.filter((c) => !isHidden(c)).map((c) => c.name());
}

/** Long flags available on a command, plus the program's global flags + --help. */
function flagsFor(cmd: Command, program: Command): string[] {
  const own = cmd.options.map((o) => o.long).filter((l): l is string => Boolean(l));
  const global = program.options.map((o) => o.long).filter((l): l is string => Boolean(l));
  return [...new Set([...own, ...global, '--help'])];
}

/** Dynamic entity names for a kind. Names with whitespace are dropped — they'd
 *  word-split in a shell completion (they can still be typed by hand). */
function namesFor(kind: NameKind): string[] {
  let out: string[] = [];
  if (kind === 'server' || kind === 'both') out.push(...servers.all().map((s) => s.name));
  if (kind === 'tunnel' || kind === 'both')
    out.push(...tunnels.all().map((t) => t.name), ...tempTunnels.all().map((t) => t.name));
  if (kind === 'config') out = sshConfig.listHosts().map((h) => h.alias);
  if (kind === 'tag') {
    const tags = new Set<string>();
    for (const e of servers.all()) e.tags.forEach((t) => tags.add(t));
    for (const e of tunnels.all()) e.tags.forEach((t) => tags.add(t));
    out = [...tags];
  }
  return out.filter((n) => n && !/\s/.test(n));
}

/** Compute completion candidates for `words` (the tokens typed after the program
 *  name, the last being the partial under the cursor). The shell filters them by
 *  the partial, so we return the full candidate set for the position. */
export function completeFromProgram(program: Command, words: string[]): string[] {
  const partial = words.length ? (words[words.length - 1] ?? '') : '';
  const ctx = words.slice(0, -1); // committed tokens

  // Descend the command tree as far as the committed tokens match.
  let cmd = program;
  const path: string[] = [];
  let consumed = 0;
  while (consumed < ctx.length) {
    const tok = ctx[consumed];
    const next = cmd.commands.find(
      (c) => !isHidden(c) && (c.name() === tok || c.aliases().includes(tok ?? '')),
    );
    if (!next) break;
    cmd = next;
    path.push(next.name());
    consumed++;
  }
  const key = path.join(' ');

  if (partial.startsWith('-')) return flagsFor(cmd, program);
  // Right after a command that still has subcommands → complete those.
  if (consumed === ctx.length && cmd.commands.some((c) => !isHidden(c))) return subNames(cmd);
  // Otherwise a positional slot: complete entity names when this command takes one.
  const kind = NAME_KIND[key];
  return kind ? namesFor(kind) : [];
}

/** The completion script for a shell. Includes a one-line install hint up top. */
export function completionScript(shell: Shell): string {
  if (shell === 'bash') {
    return `# wizard-ssh bash completion.
# Install:  wssh completion bash | sudo tee /etc/bash_completion.d/wssh
#       or:  echo 'source <(wssh completion bash)' >> ~/.bashrc
_wssh_complete() {
  local cur words cands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  cands="$(wssh complete -- "\${words[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "\${cands}" -- "\${cur}"))
}
complete -F _wssh_complete wssh wizard-ssh
`;
  }
  if (shell === 'zsh') {
    // Autoload form: save as a file named `_wssh` somewhere on $fpath. The file
    // body IS the completion function (the #compdef line wires it to the commands).
    return `#compdef wssh wizard-ssh
# wizard-ssh zsh completion.
# Install:  wssh completion zsh > "\${fpath[1]}/_wssh"   (then: compinit / restart zsh)
local -a w cands
w=("\${(@)words[2,$CURRENT]}")
cands=("\${(@f)$(command wssh complete -- "\${w[@]}" 2>/dev/null)}")
compadd -- "\${cands[@]}"
`;
  }
  return `# wizard-ssh fish completion.
# Install:  wssh completion fish > ~/.config/fish/completions/wssh.fish
function __wssh_complete
    set -l toks (commandline -opc) (commandline -ct)
    set -e toks[1]
    command wssh complete -- $toks 2>/dev/null
end
complete -c wssh -f -a '(__wssh_complete)'
complete -c wizard-ssh -f -a '(__wssh_complete)'
`;
}
