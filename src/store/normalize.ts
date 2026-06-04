/** Coercion helpers + normalizers so on-disk records are always well-formed,
 *  whatever an older version or a hand-edit left behind. */

import type {
  AuthMethod,
  BaseEntity,
  ConnectionTarget,
  ForwardType,
  HostMode,
} from '../core/types.js';
import { newId } from '../utils/id.js';
import { nowIso, safeIso } from '../utils/time.js';
import { stripControl } from '../utils/strings.js';

type Raw = Record<string, unknown>;

export const asRaw = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => {
  // Number('') and Number('   ') are 0 (finite), which would silently override
  // the default with 0 for an empty/whitespace field — treat those as absent.
  if (typeof v === 'string' && v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;

const HOST_MODES: readonly HostMode[] = ['manual', 'sshconfig'];
const AUTHS: readonly AuthMethod[] = ['agent', 'key', 'password'];
const FORWARDS: readonly ForwardType[] = ['local', 'remote', 'dynamic'];

// A stored id is interpolated into a filesystem path (the detached-tunnel log
// file, src/ssh/runner.ts), so an imported/hand-edited record must not be able
// to smuggle path traversal (`../`) or separators through it. Accept only a safe
// token verbatim; anything else (incl. an empty id) gets a fresh one. newId()
// (randomUUID) and any legacy alphanumeric id always pass, so this never churns
// a well-formed id.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeBase(raw: Raw): BaseEntity {
  const created = safeIso(raw.createdAt, nowIso());
  const rawId = str(raw.id);
  return {
    id: SAFE_ID.test(rawId) ? rawId : newId(),
    // name is printed by the renderers too — strip control/escape bytes (see desc).
    name: stripControl(str(raw.name)).trim(),
    // desc/tags are free text printed by the renderers — strip control/escape
    // bytes so an imported/hand-edited record can't emit terminal escapes.
    description: stripControl(str(raw.description)),
    tags: strArr(raw.tags).map(stripControl).filter(Boolean),
    createdAt: created,
    updatedAt: safeIso(raw.updatedAt, created),
    lastUsedAt: safeIso(raw.lastUsedAt, null),
    useCount: num(raw.useCount, 0),
  };
}

export function normalizeConnection(raw: Raw): ConnectionTarget {
  return {
    hostMode: oneOf(raw.hostMode, HOST_MODES, 'manual'),
    // host/user/keyPath/sshHost are printed by the list & detail renderers; strip
    // control/escape bytes so a hand-edited/imported record can't emit terminal
    // escapes (mirrors desc/tags in normalizeBase). The argv/forward-spec paths
    // are guarded separately (buildConnectArgs / normalizeTunnel.remoteHost).
    sshHost: stripControl(str(raw.sshHost)),
    host: stripControl(str(raw.host)),
    user: stripControl(str(raw.user)),
    sshPort: num(raw.sshPort, 22),
    auth: oneOf(raw.auth, AUTHS, 'agent'),
    keyPath: raw.keyPath ? stripControl(str(raw.keyPath)) : null,
    secretId: raw.secretId ? str(raw.secretId) : null,
  };
}

export { str, num, numOrNull, bool, strArr, oneOf, FORWARDS };
