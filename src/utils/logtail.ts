/** Tail + follow a log file. Shared by the background-tunnel and background-
 *  transfer log viewers so both behave identically. */

import fs from 'node:fs';

/** Last `n` lines of `content` (trailing newline ignored). n<=0 → all lines. */
export function tailLines(content: string, n: number): string[] {
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return n > 0 ? lines.slice(-n) : lines;
}

/** Stream appended bytes of `file` to stdout until Ctrl+C. Handles truncation
 *  (rotation) by rewinding to 0. Resolves on SIGINT so callers can return. */
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
          process.stdout.write(buf.toString('utf8'));
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
