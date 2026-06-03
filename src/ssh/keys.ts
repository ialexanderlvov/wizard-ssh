/** Private SSH key discovery (no prompts — the picker lives in the UI layer). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function looksPrivate(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(80);
    const n = fs.readSync(fd, buf, 0, 80, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString('utf8').includes('PRIVATE KEY');
  } catch {
    return false;
  }
}

/** Private keys found in ~/.ssh (one level deep). */
export function findSshKeys(): string[] {
  const found: string[] = [];
  const scan = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) scan(full, depth - 1);
      } else if (e.isFile()) {
        if (/\.(pub|old|bak)$/.test(e.name)) continue;
        if (['known_hosts', 'config', 'authorized_keys'].includes(e.name)) continue;
        if (looksPrivate(full)) found.push(full);
      }
    }
  };
  scan(path.join(os.homedir(), '.ssh'), 1);
  return found;
}
