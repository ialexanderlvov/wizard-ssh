/** Interactive remote-path browser for transfers: step through the server's
 *  directories over ssh instead of typing the path blind. Each screen is one
 *  `cd && pwd && ls -1Ap` round-trip rendered with the standard searchable list
 *  picker. Agent/key auth only — a captured password run would need an sshpass
 *  lifecycle, so password servers keep the manual text prompt. */

import path from 'node:path';
import type { Server } from '../core/types.js';
import { buildRunArgs } from '../ssh/args.js';
import { captureAsync } from '../utils/exec.js';
import { shQuote } from '../utils/shell.js';
import * as ui from '../ui/index.js';
import { tr } from '../i18n/index.js';

export interface RemoteEntry {
  name: string;
  isDir: boolean;
}

export interface RemoteListing {
  /** canonical directory (`pwd` output) */
  dir: string;
  entries: RemoteEntry[];
}

/** Parse `pwd`-then-`ls -1Ap` output: first line is the canonical dir, the rest
 *  are entries (trailing `/` marks a directory). Filenames containing a newline
 *  are the one case this misreads — they're split into bogus rows, never crash. */
export function parseRemoteListing(stdout: string): RemoteListing | null {
  const lines = stdout.split('\n');
  const dir = (lines[0] ?? '').trim();
  if (!dir.startsWith('/')) return null; // pwd failed → no listing
  const entries: RemoteEntry[] = [];
  for (const raw of lines.slice(1)) {
    if (!raw) continue;
    const isDir = raw.endsWith('/');
    const name = isDir ? raw.slice(0, -1) : raw;
    if (name && name !== '.' && name !== '..') entries.push({ name, isDir });
  }
  // dirs first, then files, each alphabetically
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  return { dir, entries };
}

/** One listing round-trip. `dir === null` means the remote home (bare `cd`).
 *  BatchMode so an auth problem fails fast instead of hanging on a prompt. */
async function listRemoteDir(server: Server, dir: string | null): Promise<RemoteListing | null> {
  const cd = dir === null ? 'cd' : `cd -- ${shQuote(dir)}`;
  const script = `${cd} && pwd && ls -1Ap`;
  const args = ['-o', 'BatchMode=yes', ...buildRunArgs(server, ['sh', '-c', shQuote(script)])];
  const res = await captureAsync('ssh', args, 20_000);
  if (res.status !== 0 || !res.stdout) return null;
  return parseRemoteListing(res.stdout);
}

type Row =
  | { kind: 'chooseDir' }
  | { kind: 'manual' }
  | { kind: 'up' }
  | { kind: 'entry'; entry: RemoteEntry };

/** Browse the server's filesystem and return the chosen path (a file, or the
 *  current directory via its top row). Returns null when the user backs out or
 *  asks to type the path manually — the caller then falls back to a text prompt.
 *  Never throws on connectivity problems; it degrades to null with a warning. */
export async function pickRemotePath(
  server: Server,
  opts: { message: string },
): Promise<string | null> {
  let dir: string | null = null; // remote home
  for (;;) {
    const listing = await listRemoteDir(server, dir);
    if (!listing) {
      ui.printWarn(tr.actions.remoteBrowseFailed);
      return null;
    }
    const rows: Row[] = [
      { kind: 'chooseDir' },
      { kind: 'manual' },
      ...(listing.dir !== '/' ? [{ kind: 'up' } as Row] : []),
      ...listing.entries.map((entry) => ({ kind: 'entry' as const, entry })),
    ];
    const picked = await ui.pickFromList<Row>({
      message: `${opts.message} — ${listing.dir}`,
      items: rows,
      render: (r) =>
        r.kind === 'chooseDir'
          ? ui.chalk.green(tr.actions.remoteBrowseChooseDir(listing.dir))
          : r.kind === 'manual'
            ? ui.chalk.green(tr.actions.remoteBrowseManual)
            : r.kind === 'up'
              ? ui.chalk.cyan('📁 ..')
              : r.entry.isDir
                ? `📁 ${ui.chalk.bold(r.entry.name)}`
                : `   ${r.entry.name}`,
      search: (r) =>
        r.kind === 'entry' ? r.entry.name : r.kind === 'manual' ? tr.actions.manualSearch : '',
      pageSize: 14,
    });
    if (picked === ui.BACK || picked.kind === 'manual') return null;
    if (picked.kind === 'chooseDir') return listing.dir;
    if (picked.kind === 'up') {
      dir = path.posix.dirname(listing.dir);
      continue;
    }
    const full = path.posix.join(listing.dir, picked.entry.name);
    if (picked.entry.isDir) {
      dir = full;
      continue;
    }
    return full;
  }
}
