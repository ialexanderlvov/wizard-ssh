import { spawn } from 'node:child_process';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

export function openInBrowser(url: string): void {
  try {
    if (isMac) {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (isWindows) {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    /* best effort */
  }
}
