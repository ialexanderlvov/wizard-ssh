import { spawnSync } from 'node:child_process';

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
