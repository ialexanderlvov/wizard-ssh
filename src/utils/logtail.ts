/** Tail + follow a log file. The SINGLE shared implementation for the background-
 *  tunnel and background-transfer log viewers so both behave — and are sanitized
 *  — identically. */

import fs from 'node:fs';

// Background logs capture a child's stdout/stderr, which includes the REMOTE
// server's banner / MOTD / ssh diagnostics — attacker-influenced text. Printing
// it raw lets a hostile server move the cursor, rewrite the window title, or
// spoof OSC-8 hyperlinks when the user later views the log. Strip every C0/C1
// control byte EXCEPT tab and newline (so the log still reads as lines); this
// also drops colour, an accepted trade for a diagnostic view. Built via the
// constructor so the source carries no literal control bytes.
// eslint-disable-next-line no-control-regex
const LOG_UNSAFE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]', 'g');

/** Make captured child output safe to write to the terminal. */
export const sanitizeLog = (s: string): string => s.replace(LOG_UNSAFE, '');

/** Last `n` lines of `content` (trailing newline ignored), each sanitized. A
 *  non-positive / non-integer `n` means "all lines". */
export function tailLines(content: string, n: number): string[] {
  const lines = sanitizeLog(content).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return Number.isInteger(n) && n > 0 ? lines.slice(-n) : lines;
}

/** Stream appended bytes of `file` to stdout (sanitized) until Ctrl+C. Handles
 *  truncation (rotation) by rewinding to 0. Resolves on SIGINT so callers can
 *  return. */
export function followLog(file: string): Promise<void> {
  return new Promise((resolve) => {
    let pos = fs.statSync(file).size;
    const flush = (): void => {
      try {
        const { size } = fs.statSync(file);
        if (size < pos) pos = 0; // file was truncated / rotated
        if (size <= pos) return;
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(size - pos);
          fs.readSync(fd, buf, 0, buf.length, pos);
          process.stdout.write(sanitizeLog(buf.toString('utf8')));
          pos = size;
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        /* best-effort */
      }
    };
    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(file, flush);
    } catch {
      resolve();
      return;
    }
    const onSigint = (): void => {
      watcher?.close();
      resolve();
    };
    process.once('SIGINT', onSigint);
  });
}
