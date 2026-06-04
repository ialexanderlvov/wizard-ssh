/** Registry of background tunnel sessions: which tunnel is running, under what
 *  PID, and where its log goes. Dead PIDs are reaped on every read so the list
 *  always reflects reality (a process can die without telling us). */

import { FILES } from '../core/paths.js';
import { nowIso } from '../utils/time.js';
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
}

interface SessionsFile {
  version: 1;
  sessions: TunnelSession[];
}

/** True if a process with `pid` is currently alive (signal 0 probes liveness). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but we may not signal it — still alive.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
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

  /** Live sessions only — prunes any whose PID is gone, persisting the result. */
  list(): TunnelSession[] {
    const f = this.load();
    const alive = f.sessions.filter((s) => pidAlive(s.pid));
    if (alive.length !== f.sessions.length) this.persist({ version: 1, sessions: alive });
    return alive.slice();
  }

  find(tunnelId: string): TunnelSession | null {
    return this.list().find((s) => s.tunnelId === tunnelId) ?? null;
  }

  add(session: Omit<TunnelSession, 'startedAt'>): TunnelSession {
    const f = this.load();
    const next = f.sessions.filter((s) => s.tunnelId !== session.tunnelId);
    const full: TunnelSession = { ...session, startedAt: nowIso() };
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
