import { spawn, spawnSync } from 'node:child_process';

/** Is an executable available on PATH? Cross-platform. */
export function commandExists(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

export interface CaptureResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run a command and capture its output (no shell). */
export function capture(cmd: string, args: string[], input?: string): CaptureResult {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    input,
    timeout: 30_000,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/** Pure: does this `rsync --version` banner indicate rsync >= 3.1.0, i.e. support
 *  for `--info=progress2` (a single overall progress bar) and `-h` as
 *  human-readable sizes? Apple's `/usr/bin/rsync` is openrsync ("rsync version
 *  2.6.9 compatible") and the old samba rsync 2.6.9 BOTH reject `--info` (and
 *  2.6.9 treats `-h` as `--help`), so anything we can't parse as >= 3.1 is "no". */
export function rsyncVersionHasInfoProgress(versionOutput: string): boolean {
  const m = /rsync\s+version\s+v?(\d+)\.(\d+)/i.exec(versionOutput);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 3 || (major === 3 && minor >= 1);
}

let rsyncInfoProgressCache: boolean | undefined;

/** Whether the installed rsync supports `--info=progress2` (cached per process).
 *  Probes `rsync --version` once; on any failure assumes "no" so we fall back to
 *  the universally-supported `--progress`. */
export function rsyncSupportsInfoProgress(): boolean {
  if (rsyncInfoProgressCache === undefined) {
    const res = capture('rsync', ['--version']);
    rsyncInfoProgressCache = res.status === 0 && rsyncVersionHasInfoProgress(res.stdout);
  }
  return rsyncInfoProgressCache;
}

/** Reset the cached rsync capability probe (tests only). */
export function resetExecCaps(): void {
  rsyncInfoProgressCache = undefined;
}

/** Async variant of {@link capture}: runs a command without blocking the event
 *  loop, so many can run concurrently (e.g. resolving config hosts in parallel). */
export function captureAsync(
  cmd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ status: 1, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (status: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code));
  });
}
