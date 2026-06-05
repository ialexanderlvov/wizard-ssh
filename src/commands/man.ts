/** Man page for wssh, generated from the live commander program (so it never
 *  drifts from the real command set). `wssh man` renders it via `man`; `wssh man
 *  --roff` prints the raw roff for installation:
 *    wssh man --roff | sudo tee /usr/local/share/man/man1/wssh.1   # then: man wssh
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { APP_BIN, APP_NAME, APP_VERSION } from '../core/constants.js';
import { DATA_DIR } from '../core/paths.js';
import { commandExists } from '../utils/exec.js';
import { tr } from '../i18n/index.js';

const isHidden = (c: Command): boolean => (c as unknown as { _hidden?: boolean })._hidden === true;

/** Escape a value for roff body text: backslashes only (other chars render fine
 *  in modern groff). Control lines are emitted by us, not from user data. */
const esc = (s: string): string => s.replace(/\\/g, '\\\\');

/** A command's positional usage without the boilerplate "[options]". */
const usageArgs = (c: Command): string =>
  c
    .usage()
    .replace(/\[options\]/g, '')
    .trim();

/** The example lines from the shared help block (drop the "Examples:" header). */
function exampleLines(): string[] {
  return tr.cmd.helpExamples
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^(Examples|Примеры):/.test(l.trim()));
}

/** Build the roff (man) source for the whole CLI. */
export function manRoff(program: Command): string {
  const date = new Date().toISOString().slice(0, 10);
  const bin = APP_BIN;
  const out: string[] = [];
  out.push(`.TH ${bin.toUpperCase()} 1 "${date}" "${APP_NAME} ${APP_VERSION}" "User Commands"`);
  out.push('.SH NAME');
  out.push(`${esc(bin)} \\- ${esc(tr.cli.programDescription)}`);
  out.push('.SH SYNOPSIS');
  out.push(`.B ${esc(bin)}`);
  out.push('[\\fIcommand\\fR] [\\fIoptions\\fR]');
  out.push('.SH DESCRIPTION');
  out.push(esc(tr.cmd.manIntro));

  out.push('.SH COMMANDS');
  for (const cmd of program.commands.filter((c) => !isHidden(c))) {
    const args = usageArgs(cmd);
    out.push('.TP');
    out.push(`.B ${esc(args ? `${cmd.name()} ${args}` : cmd.name())}`);
    out.push(esc(cmd.description() || ''));
    const subs = cmd.commands.filter((c) => !isHidden(c));
    if (subs.length) {
      out.push('.RS 4');
      for (const sub of subs) {
        const sargs = usageArgs(sub);
        out.push('.TP');
        out.push(`.B ${esc(sargs ? `${sub.name()} ${sargs}` : sub.name())}`);
        out.push(esc(sub.description() || ''));
      }
      out.push('.RE');
    }
  }

  out.push('.SH "GLOBAL OPTIONS"');
  out.push('.TP', '.B \\-y, \\-\\-yes', esc(tr.cmd.optYes));
  out.push('.TP', '.B \\-\\-non\\-interactive', esc(tr.cmd.optNonInteractive));

  out.push('.SH ENVIRONMENT');
  const env: Array<[string, string]> = [
    ['WSSH_LANG', tr.cmd.manEnvLang],
    ['WIZARD_SSH_HOME', tr.cmd.manEnvHome],
    ['WSSH_VAULT_PASSPHRASE[_FILE|_CMD]', tr.cmd.manEnvVault],
    ['WSSH_DEBUG', tr.cmd.manEnvDebug],
  ];
  for (const [name, desc] of env) out.push('.TP', `.B ${esc(name)}`, esc(desc));

  out.push('.SH FILES');
  out.push('.TP', `.I ${esc(DATA_DIR)}`, esc(tr.cmd.manFilesData));
  out.push('.TP', '.I ~/.ssh/config', esc(tr.cmd.manFilesSsh));

  out.push('.SH EXAMPLES');
  out.push('.nf');
  for (const line of exampleLines()) out.push('\\&' + esc(line));
  out.push('.fi');

  return out.join('\n') + '\n';
}

/** A plain-text rendering of the roff, for when `man` isn't available. */
function stripRoff(roff: string): string {
  return roff
    .split('\n')
    .filter((l) => !/^\.(TH|nf|fi|RS|RE)\b/.test(l))
    .map((l) =>
      l
        .replace(/^\.SH\s+"?(.+?)"?$/, '\n$1')
        .replace(/^\.TP$/, '')
        .replace(/^\.B\s+/, '  ')
        .replace(/^\.I\s+/, '  ')
        .replace(/\\f[BIR]/g, '')
        .replace(/\\&/g, '')
        .replace(/\\-/g, '-')
        .replace(/\\\\/g, '\\'),
    )
    .filter((l, i, a) => !(l === '' && a[i - 1] === '')) // collapse blank runs
    .join('\n');
}

/** `wssh man [--roff]`: render the page via `man`, or print roff with --roff. */
export function manFlow(program: Command, opts: { roff?: boolean } = {}): number {
  const roff = manRoff(program);
  if (opts.roff) {
    process.stdout.write(roff);
    return 0;
  }
  if (!commandExists('man')) {
    process.stdout.write(stripRoff(roff));
    return 0;
  }
  const tmp = path.join(os.tmpdir(), `${APP_BIN}-${process.pid}.1`);
  try {
    fs.writeFileSync(tmp, roff, { mode: 0o600 });
    const res = spawnSync('man', [tmp], { stdio: 'inherit' });
    if (res.error) {
      process.stdout.write(stripRoff(roff)); // man present but failed to launch
      return 0;
    }
    return res.status ?? 0;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}
