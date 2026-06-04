/** Registry of background tunnel sessions: which tunnel is running, under what
 *  PID, and where its log goes. Dead PIDs are reaped on every read so the list
 *  always reflects reality (a process can die without telling us). */

import { FILES } from '../core/paths.js';
import { nowIso } from '../utils/time.js';
import { capture } from '../utils/exec.js';
import { readJson, writeJson } from './json-file.js';

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
function processStartToken(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const res = capture('ps', ['-o', 'lstart=', '-p', String(pid)]);
  return res.status === 0 ? res.stdout.trim() : '';
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
 *  launched (start-time token matches) — guards against PID reuse. */
function sessionAlive(s: TunnelSession): boolean {
  if (!pidAlive(s.pid)) return false;
  if (!s.startToken) return true; // legacy session without a token — best effort
  return processStartToken(s.pid) === s.startToken;
}

class SessionsStore {
  private cache: SessionsFile | null = null;

  private load(): SessionsFile {
    if (this.cache) return this.cache;
    const { data } = readJson<SessionsFile>(FILES.sessions, { version: 1, sessions: [] });
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    this.cache = { version: 1, sessions };
    return this.cache;
  }

  private persist(f: SessionsFile): void {
    this.cache = f;
    writeJson(FILES.sessions, f);
  }

  /** Live sessions only — prunes any whose PID is gone or was reused by another
   *  process, persisting the result. */
  list(): TunnelSession[] {
    const f = this.load();
    const alive = f.sessions.filter((s) => sessionAlive(s));
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
