/** Registry of background file-transfer processes (scp/rsync started with --bg).
 *  Mirrors the tunnel sessions registry: dead/PID-reused processes are reaped on
 *  every read, so the list always reflects what is actually still running. */

import fs from 'node:fs';
import { FILES } from '../core/paths.js';
import { nowIso } from '../utils/time.js';
import { readJson, writeJson } from './json-file.js';
import { pidAlive, processStartToken } from './sessions.store.js';

export interface TransferSession {
  /** stable id (also the log filename token) */
  id: string;
  /** server/target name */
  name: string;
  tool: 'scp' | 'rsync';
  direction: 'upload' | 'download';
  /** short human summary, e.g. "./a → host:/b" */
  summary: string;
  pid: number;
  logFile: string;
  startedAt: string;
  /** ps start-time token captured at launch — guards against PID reuse */
  startToken?: string;
}

interface TransferSessionsFile {
  version: 1;
  sessions: TransferSession[];
}

/** Still our running transfer? PID alive AND the same process we launched. An
 *  inconclusive ps probe keeps the session (don't orphan a live transfer). */
function alive(s: TransferSession): boolean {
  if (!pidAlive(s.pid)) return false;
  if (!s.startToken) return true;
  const token = processStartToken(s.pid);
  return !token || token === s.startToken;
}

class TransferSessionsStore {
  private cache: TransferSessionsFile | null = null;
  /** signature (mtime+size) of the file when last read — re-read on a concurrent
   *  write so a long-lived menu doesn't clobber another process's registry entry
   *  and orphan its background transfer. */
  private sig = '';

  private fileSig(): string {
    try {
      const st = fs.statSync(FILES.transferSessions);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  private load(): TransferSessionsFile {
    const s = this.fileSig();
    if (this.cache && s === this.sig) return this.cache;
    const { data } = readJson<TransferSessionsFile>(FILES.transferSessions, {
      version: 1,
      sessions: [],
    });
    this.cache = { version: 1, sessions: Array.isArray(data?.sessions) ? data.sessions : [] };
    this.sig = s;
    return this.cache;
  }

  private persist(f: TransferSessionsFile): void {
    this.cache = f;
    writeJson(FILES.transferSessions, f);
    this.sig = this.fileSig();
  }

  /** Running transfers only (prunes finished or PID-reused entries). */
  list(): TransferSession[] {
    const f = this.load();
    const live = f.sessions.filter(alive);
    if (live.length !== f.sessions.length) this.persist({ version: 1, sessions: live });
    return live.slice();
  }

  add(s: Omit<TransferSession, 'startedAt' | 'startToken'>): TransferSession {
    const f = this.load();
    const full: TransferSession = {
      ...s,
      startedAt: nowIso(),
      startToken: processStartToken(s.pid),
    };
    this.persist({ version: 1, sessions: [...f.sessions, full] });
    return full;
  }

  remove(id: string): void {
    const f = this.load();
    const next = f.sessions.filter((s) => s.id !== id);
    if (next.length !== f.sessions.length) this.persist({ version: 1, sessions: next });
  }
}

export const transferSessions = new TransferSessionsStore();
