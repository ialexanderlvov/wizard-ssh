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
