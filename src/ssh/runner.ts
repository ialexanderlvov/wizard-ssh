/** Spawn `ssh` (optionally wrapped in `sshpass`) for interactive connects and
 *  for tunnels, with careful lifecycle + fast-fail diagnostics. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import boxen from 'boxen';
import type { ConnectionTarget, Server, Tunnel } from '../core/types.js';
import { commandExists } from '../utils/exec.js';
import { expandHome } from '../utils/strings.js';
import { isValidPort } from '../utils/validators.js';
import { openInBrowser } from '../utils/platform.js';
import { chalk, accent } from '../ui/theme.js';
import { printSection, printInfo, printWarn, printError } from '../ui/messages.js';
import { targetSummary } from '../ui/format.js';
import { buildConnectArgs, buildTunnelArgs } from './args.js';

export interface PreflightOptions {
  /** tunnels need valid forward ports */
  forwardPorts?: { local: number; remote: number | null; type: string };
}

/** Validate a target before spawning. Returns null when OK, else a message. */
export function preflight(t: ConnectionTarget, opts: PreflightOptions = {}): string | null {
  if (!commandExists('ssh')) return 'ssh не найден в PATH.';

  if (t.hostMode === 'sshconfig') {
    if (!t.sshHost.trim()) return 'Не задан алиас ~/.ssh/config.';
  } else if (!t.host.trim()) {
    return 'Не задан IP/домен.';
  }

  if (opts.forwardPorts) {
    const { local, remote, type } = opts.forwardPorts;
    if (!isValidPort(local)) return `Некорректный локальный порт: ${local}`;
    if (type !== 'dynamic' && !isValidPort(remote)) return `Некорректный удалённый порт: ${remote}`;
  }

  if (t.auth === 'key') {
    if (!t.keyPath) return 'Авторизация по ключу выбрана, но путь к ключу не задан.';
    if (!fs.existsSync(expandHome(t.keyPath)))
      return `SSH-ключ не найден: ${expandHome(t.keyPath)}`;
  }
  if (t.auth === 'password' && !commandExists('sshpass')) {
    return 'sshpass не установлен — нужен для парольной авторизации.\n  brew install hudochenkov/sshpass/sshpass · apt install sshpass';
  }
  return null;
}

function writeTempPass(pw: string): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-'));
  const file = path.join(dir, 'pw');
  fs.writeFileSync(file, pw, { mode: 0o600 });
  const cleanup = (): void => {
    try {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    } catch {
      /* noop */
    }
  };
  process.on('exit', cleanup);
  return { file, cleanup };
}

interface SpawnResult {
  code: number;
  startedAt: number;
}

/** Core spawn: wraps in sshpass when a password is given. stdio inherited.
 *  `program` is normally `ssh`, but `scp`/`ssh-copy-id` reuse this too. */
function spawnPass(
  program: string,
  programArgs: string[],
  password: string | undefined,
  onSpawn?: () => void,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let cmd = program;
    let args = programArgs;
    let cleanup = (): void => {};

    if (password !== undefined) {
      const tmp = writeTempPass(password);
      cleanup = tmp.cleanup;
      cmd = 'sshpass';
      args = ['-f', tmp.file, program, ...programArgs];
    }

    const startedAt = Date.now();
    const child = spawn(cmd, args, { stdio: 'inherit' });
    onSpawn?.();

    const onSigint = (): void => {
      if (!child.killed) child.kill('SIGINT');
    };
    process.on('SIGINT', onSigint);

    const done = (code: number): void => {
      cleanup();
      process.removeListener('SIGINT', onSigint);
      resolve({ code, startedAt });
    };

    child.on('error', (e: Error) => {
      printError(`Не удалось запустить ${cmd}: ${e.message}`);
      done(1);
    });
    child.on('close', (code) => done(code ?? 0));
  });
}

/** Run ssh with the given args (stdio inherited); resolve with exit code. */
export async function runSshInherit(args: string[], password?: string): Promise<number> {
  const { code } = await spawnPass('ssh', args, password);
  return code;
}

/** Run an arbitrary program (scp, ssh-copy-id) optionally via sshpass. */
export async function runProgram(
  program: string,
  args: string[],
  password?: string,
): Promise<number> {
  const { code } = await spawnPass(program, args, password);
  return code;
}

/** Interactive shell session to a server. Resolves with the exit code. */
export async function runInteractive(server: Server, password?: string): Promise<number> {
  const err = preflight(server);
  if (err) {
    printError(err);
    return 1;
  }
  printSection('▶', `Подключение → ${server.name}`);
  console.log(chalk.dim('  ' + targetSummary(server)) + '\n');
  const { code } = await spawnPass('ssh', buildConnectArgs(server), password);
  console.log('');
  if (code === 0 || code === 130 || code === 255) printInfo(chalk.dim('Сессия завершена.'));
  else printError(`ssh завершился с кодом ${code}.`);
  return code && code !== 130 ? code : 0;
}

/** Bring up a tunnel and keep it running until Ctrl+C. */
export async function runTunnel(tunnel: Tunnel, password?: string): Promise<number> {
  const err = preflight(tunnel, {
    forwardPorts: { local: tunnel.localPort, remote: tunnel.remotePort, type: tunnel.type },
  });
  if (err) {
    printError(err);
    return 1;
  }

  const localUrl = `http://localhost:${tunnel.localPort}`;
  const sshArgs = buildTunnelArgs(tunnel);
  printSection('▶', `Поднимаю туннель → ${tunnel.name}`);
  console.log(chalk.dim('  $ ') + chalk.cyan('ssh') + ' ' + chalk.gray(sshArgs.join(' ')));

  let opened = false;
  let upTimer: NodeJS.Timeout | undefined;
  const { code, startedAt } = await spawnPass('ssh', sshArgs, password, () => {
    upTimer = setTimeout(() => {
      const lines = [chalk.bold.green('🚇 Туннель поднят'), ''];
      if (tunnel.type === 'local')
        lines.push(chalk.white((tunnel.description || tunnel.name) + ':  ') + accent(localUrl));
      else if (tunnel.type === 'dynamic')
        lines.push(chalk.white('SOCKS5 proxy:  ') + accent(`localhost:${tunnel.localPort}`));
      else
        lines.push(
          chalk.white('Reverse-форвард активен') +
            chalk.dim(`  (server:${tunnel.remotePort} → ${tunnel.remoteHost}:${tunnel.localPort})`),
        );
      lines.push(
        chalk.dim(`→ ${targetSummary(tunnel)}`),
        '',
        chalk.dim('Ctrl+C — закрыть туннель.'),
      );
      console.log(
        '\n' + boxen(lines.join('\n'), { padding: 1, borderStyle: 'round', borderColor: 'green' }),
      );
      if (tunnel.type === 'local' && tunnel.openBrowser && !opened) {
        opened = true;
        openInBrowser(localUrl);
      }
    }, 1500);
  });
  if (upTimer) clearTimeout(upTimer);

  const fast = Date.now() - startedAt < 2500;
  console.log('');
  if (code === 0 || code === 130 || code === 255) printInfo(chalk.dim('Туннель закрыт.'));
  else printError(`ssh завершился с кодом ${code}.`);
  if (fast && code && code !== 130) {
    printWarn(
      `Похоже на ошибку подключения/форварда. Проверь SSH-доступ и что локальный порт ${tunnel.localPort} свободен.`,
    );
  }
  return code && code !== 130 ? code : 0;
}
