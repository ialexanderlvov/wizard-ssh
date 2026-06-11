import { spawn, spawnSync } from 'node:child_process';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

/** Copy text to the system clipboard. Returns the tool used, or null if none
 *  worked (no pbcopy/clip/xclip/wl-copy, or the write failed). Best-effort. */
export function copyToClipboard(text: string): string | null {
  const candidates: Array<[string, string[]]> = isMac
    ? [['pbcopy', []]]
    : isWindows
      ? [['clip', []]]
      : [
          ['wl-copy', []],
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['--clipboard', '--input']],
        ];
  for (const [cmd, args] of candidates) {
    try {
      const res = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      if (res.status === 0) return cmd;
    } catch {
      /* try the next tool */
    }
  }
  return null;
}

/** Best-effort desktop notification (osascript on macOS, notify-send on Linux).
 *  Used for rare, important events only (e.g. a tunnel that gave up reconnecting)
 *  — never for routine progress. Silently a no-op when no tool is available. */
export function notifyDesktop(title: string, body: string): void {
  try {
    if (isMac) {
      // JSON.stringify produces valid AppleScript string literals (escapes " and \).
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
      spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
    } else if (isLinux) {
      spawn('notify-send', ['--', title, body], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    /* best effort */
  }
}

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
