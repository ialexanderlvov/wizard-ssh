/** Boot-time autostart for background tunnels: generates a launchd LaunchAgent
 *  (macOS) or a systemd user unit (Linux) that runs `ssh -N <forward>` directly
 *  and lets the OS keep it alive (KeepAlive / Restart=always). The unit embeds
 *  the ssh argv frozen at install time — editing the tunnel later requires a
 *  re-install (`wssh tunnel autostart add` again), which the flows point out. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tunnel } from '../core/types.js';
import { FILES, ensureDir } from '../core/paths.js';
import { capture, commandExists } from '../utils/exec.js';
import { atomicWrite } from '../utils/atomic.js';
import { isMac, isLinux } from '../utils/platform.js';
import { buildTunnelArgs } from './args.js';

const LABEL_PREFIX = 'com.wizard-ssh.tunnel.';
const UNIT_PREFIX = 'wssh-tunnel-';

export const autostartSupported = (): boolean => isMac || isLinux;

const launchAgentsDir = (): string => path.join(os.homedir(), 'Library', 'LaunchAgents');
const systemdUserDir = (): string => path.join(os.homedir(), '.config', 'systemd', 'user');

export const autostartLabel = (id: string): string =>
  isMac ? `${LABEL_PREFIX}${id}` : `${UNIT_PREFIX}${id}.service`;

export const autostartFile = (id: string): string =>
  isMac
    ? path.join(launchAgentsDir(), `${LABEL_PREFIX}${id}.plist`)
    : path.join(systemdUserDir(), `${UNIT_PREFIX}${id}.service`);

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resolve the absolute ssh path — launchd/systemd units must not rely on PATH. */
export function sshAbsolutePath(): string {
  const res = capture('which', ['ssh']);
  const p = res.status === 0 ? (res.stdout.split('\n')[0] ?? '').trim() : '';
  return p || '/usr/bin/ssh';
}

/** launchd property list: RunAtLoad + KeepAlive restart the ssh on any exit,
 *  throttled so a misconfig can't hot-loop. */
export function buildLaunchdPlist(tunnel: Tunnel, ssh: string, logFile: string): string {
  const args = [ssh, ...buildTunnelArgs(tunnel)];
  const argXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LABEL_PREFIX + tunnel.id)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

/** systemd-quote one ExecStart token: double-quoted with \ and " escaped. */
const sdQuote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function buildSystemdUnit(tunnel: Tunnel, ssh: string): string {
  const exec = [ssh, ...buildTunnelArgs(tunnel)].map(sdQuote).join(' ');
  return `[Unit]
Description=wizard-ssh tunnel ${tunnel.name}
Wants=network-online.target
After=network-online.target

[Service]
Type=exec
ExecStart=${exec}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export interface AutostartResult {
  ok: boolean;
  file: string;
  /** raw tool stderr/stdout when ok=false (for the error message) */
  detail?: string;
}

/** Write the unit and activate it now (idempotent — reinstall replaces). */
export function installAutostart(tunnel: Tunnel): AutostartResult {
  const file = autostartFile(tunnel.id);
  if (isMac) {
    fs.mkdirSync(launchAgentsDir(), { recursive: true });
    ensureDir(FILES.logsDir);
    const logFile = path.join(FILES.logsDir, `autostart-${tunnel.id}.log`);
    atomicWrite(file, buildLaunchdPlist(tunnel, sshAbsolutePath(), logFile), 0o600);
    const uid = process.getuid?.() ?? 0;
    // Re-installs must drop the old job first; ignore "not loaded" failures.
    capture('launchctl', ['bootout', `gui/${uid}/${LABEL_PREFIX}${tunnel.id}`]);
    let res = capture('launchctl', ['bootstrap', `gui/${uid}`, file]);
    // Older macOS: fall back to the legacy load API.
    if (res.status !== 0) res = capture('launchctl', ['load', '-w', file]);
    return { ok: res.status === 0, file, detail: res.stderr || res.stdout };
  }
  if (isLinux) {
    if (!commandExists('systemctl')) return { ok: false, file, detail: 'systemctl not found' };
    fs.mkdirSync(systemdUserDir(), { recursive: true });
    atomicWrite(file, buildSystemdUnit(tunnel, sshAbsolutePath()), 0o600);
    capture('systemctl', ['--user', 'daemon-reload']);
    const res = capture('systemctl', ['--user', 'enable', '--now', autostartLabel(tunnel.id)]);
    return { ok: res.status === 0, file, detail: res.stderr || res.stdout };
  }
  return { ok: false, file, detail: 'unsupported platform' };
}

/** Stop, deactivate and delete the unit. ok=true also when nothing was installed. */
export function uninstallAutostart(id: string): AutostartResult {
  const file = autostartFile(id);
  const existed = fs.existsSync(file);
  if (isMac) {
    const uid = process.getuid?.() ?? 0;
    const res = capture('launchctl', ['bootout', `gui/${uid}/${LABEL_PREFIX}${id}`]);
    if (res.status !== 0) capture('launchctl', ['unload', '-w', file]); // legacy fallback
  } else if (isLinux && commandExists('systemctl')) {
    capture('systemctl', ['--user', 'disable', '--now', autostartLabel(id)]);
  }
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* best effort */
  }
  if (isLinux && commandExists('systemctl')) capture('systemctl', ['--user', 'daemon-reload']);
  return { ok: existed, file };
}

export interface AutostartEntry {
  /** tunnel id extracted from the unit filename */
  id: string;
  file: string;
  /** OS reports the job loaded/active; null when undeterminable */
  active: boolean | null;
}

export function listAutostart(): AutostartEntry[] {
  const dir = isMac ? launchAgentsDir() : systemdUserDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries: AutostartEntry[] = [];
  for (const n of names) {
    let id: string | null = null;
    if (isMac && n.startsWith(LABEL_PREFIX) && n.endsWith('.plist'))
      id = n.slice(LABEL_PREFIX.length, -'.plist'.length);
    if (isLinux && n.startsWith(UNIT_PREFIX) && n.endsWith('.service'))
      id = n.slice(UNIT_PREFIX.length, -'.service'.length);
    if (!id) continue;
    let active: boolean | null = null;
    if (isMac) {
      const uid = process.getuid?.() ?? 0;
      const res = capture('launchctl', ['print', `gui/${uid}/${LABEL_PREFIX}${id}`]);
      active = res.status === null ? null : res.status === 0;
    } else if (commandExists('systemctl')) {
      const res = capture('systemctl', ['--user', 'is-active', autostartLabel(id)]);
      active = res.status === null ? null : res.status === 0;
    }
    entries.push({ id, file: path.join(dir, n), active });
  }
  return entries;
}
