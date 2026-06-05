/** Registry of background tunnel sessions: which tunnel is running, under what
 *  PID, and where its log goes. Dead PIDs are reaped on every read so the list
 *  always reflects reality (a process can die without telling us). */

import fs from 'node:fs';
import { FILES } from '../core/paths.js';
import { nowIso } from '../utils/time.js';
import { capture } from '../utils/exec.js';
import { readJson, writeJson } from './json-file.js';

// `ps -o lstart` formats the start time in the LOCAL timezone, so the captured
// token would change if the machine's TZ changes (travel, a shell with a
// different TZ, a corrected clock) — list() would then prune and orphan a still-
// running tunnel. Pin TZ=UTC for both the launch-time capture and the later probe
// so the comparison is timezone-stable while still catching reboot/PID reuse.
const PS_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, TZ: 'UTC' });

export interface TunnelSession {
  /** the running tunnel's id (one live session per tunnel) */
  tunnelId: string;
  name: string;
  pid: number;
  /** 'main' or 'temp' — which collection the tunnel belongs to */
  store: 'main' | 'temp';
  /** short forward description, e.g. "8080→127.0.0.1:80" */
  forward: string;
  target: string;
  logFile: string;
  startedAt: string;
  /** the process start-time captured at launch — a PID-reuse guard so we never
   *  treat (or kill) an unrelated process that recycled our ssh's PID. */
  startToken?: string;
}

/** A stable per-process identity token (its start time, via `ps`) to tell OUR
 *  ssh apart from a foreign process that later reused the same PID. Empty when
 *  ps is unavailable — callers then fall back to a plain liveness check. */
export function processStartToken(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const res = capture('ps', ['-o', 'lstart=', '-p', String(pid)], undefined, { env: PS_ENV() });
  return res.status === 0 ? res.stdout.trim() : '';
}

/** Start-time tokens for many pids in ONE `ps` call (vs one spawn per session on
 *  every list()). Returns pid → lstart; pids absent from the output are omitted
 *  (dead, or ps unavailable → empty map, callers then fall back to a liveness
 *  check). */
export function processStartTokens(pids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const valid = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (!valid.length) return out;
  const res = capture('ps', ['-o', 'pid=,lstart=', '-p', valid.join(',')], undefined, {
    env: PS_ENV(),
  });
  if (res.status !== 0) return out;
  for (const line of res.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) out.set(Number(m[1]), (m[2] ?? '').trim());
  }
  return out;
}

interface SessionsFile {
  version: 1;
  sessions: TunnelSession[];
}

/** True if a process with `pid` is currently alive (signal 0 probes liveness).
 *  EPERM (exists but not signalable) is treated as NOT-ours: our own detached
 *  ssh always runs as the same user and is signalable, so EPERM means a foreign
 *  process — better to drop the stale session than risk signalling a stranger. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A session is live only if its PID is alive AND still the same process we
 *  launched (start-time token matches) — guards against PID reuse. Exported so a
 *  caller can RE-verify immediately before signalling a PID (the list() snapshot
 *  may be stale after a long interactive prompt — PID-reuse TOCTOU). */
export function sessionAlive(s: TunnelSession): boolean {
  if (!pidAlive(s.pid)) return false;
  if (!s.startToken) return true; // legacy session without a token — best effort
  const token = processStartToken(s.pid);
  // An empty token means the `ps` probe itself failed (ps missing on PATH, the
  // 30s timeout, any transient error) — that's inconclusive, NOT a PID-reuse
  // mismatch. The PID is alive, so keep the session rather than permanently
  // pruning (and orphaning) a still-running tunnel; mirror the launch-time
  // tolerance of an absent token above.
  if (!token) return true;
  return token === s.startToken;
}

class SessionsStore {
  private cache: SessionsFile | null = null;
  /** signature (mtime+size) of the file when last read — re-read when another
   *  `wssh` process wrote meanwhile, so a long-lived menu can't clobber a
   *  concurrently-added session and orphan its background tunnel. */
  private sig = '';

  private fileSig(): string {
    try {
      const st = fs.statSync(FILES.sessions);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  private load(): SessionsFile {
    const s = this.fileSig();
    if (this.cache && s === this.sig) return this.cache;
    const { data } = readJson<SessionsFile>(FILES.sessions, { version: 1, sessions: [] });
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    this.cache = { version: 1, sessions };
    this.sig = s;
    return this.cache;
  }

  private persist(f: SessionsFile): void {
    this.cache = f;
    writeJson(FILES.sessions, f);
    this.sig = this.fileSig();
  }

  /** Live sessions only — prunes any whose PID is gone or was reused by another
   *  process, persisting the result. */
  list(): TunnelSession[] {
    const f = this.load();
    // Batch the start-token probe into ONE `ps` call for all live pids, instead of
    // spawning `ps` per session inside sessionAlive().
    const livePids = f.sessions.filter((s) => pidAlive(s.pid)).map((s) => s.pid);
    const tokens = livePids.length ? processStartTokens(livePids) : new Map<number, string>();
    const alive = f.sessions.filter((s) => {
      if (!pidAlive(s.pid)) return false;
      if (!s.startToken) return true; // legacy session without a token — best effort
      const token = tokens.get(s.pid);
      // No token for an alive pid is inconclusive (ps missing/failed) — keep it,
      // mirroring sessionAlive()'s tolerance, rather than orphaning a live tunnel.
      return token === undefined || token === '' || token === s.startToken;
    });
    if (alive.length !== f.sessions.length) this.persist({ version: 1, sessions: alive });
    return alive.slice();
  }

  find(tunnelId: string): TunnelSession | null {
    return this.list().find((s) => s.tunnelId === tunnelId) ?? null;
  }

  add(session: Omit<TunnelSession, 'startedAt' | 'startToken'>): TunnelSession {
    const f = this.load();
    const next = f.sessions.filter((s) => s.tunnelId !== session.tunnelId);
    const full: TunnelSession = {
      ...session,
      startedAt: nowIso(),
      startToken: processStartToken(session.pid),
    };
    next.push(full);
    this.persist({ version: 1, sessions: next });
    return full;
  }

  remove(tunnelId: string): void {
    const f = this.load();
    const next = f.sessions.filter((s) => s.tunnelId !== tunnelId);
    if (next.length !== f.sessions.length) this.persist({ version: 1, sessions: next });
  }
}

export const sessions = new SessionsStore();
