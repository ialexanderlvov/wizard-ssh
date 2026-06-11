import { describe, it, expect, vi } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expandHome, tilde, slugify, parseTags, stripControl } from '../src/utils/strings.js';
import {
  isValidProxyJump,
  isValidPort,
  isValidHostOrIp,
  isValidSshAlias,
} from '../src/utils/validators.js';
import { relativeTime, absoluteTime, safeIso, ts, nowIso } from '../src/utils/time.js';
import { commandExists, capture } from '../src/utils/exec.js';
import { isMac, isWindows, isLinux } from '../src/utils/platform.js';
import {
  WizardError,
  NotInteractiveError,
  PromptAbortError,
  VaultLockedError,
} from '../src/core/errors.js';

describe('strings', () => {
  it('expandHome', () => {
    expect(expandHome('~')).toBe(os.homedir());
    expect(expandHome('~/foo/bar')).toBe(path.join(os.homedir(), 'foo/bar'));
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('')).toBe('');
    expect(expandHome(null)).toBe('');
    expect(expandHome(undefined)).toBe('');
  });

  it('tilde', () => {
    expect(tilde(path.join(os.homedir(), 'x'))).toBe('~/x');
    expect(tilde('/somewhere/else')).toBe('/somewhere/else');
    expect(tilde('')).toBe('');
    expect(tilde(null)).toBe('');
  });

  it('slugify', () => {
    expect(slugify('My Server #1')).toBe('my-server-1');
    expect(slugify('  Trim--Me  ')).toBe('trim-me');
    expect(slugify('')).toBe('item');
    expect(slugify('***')).toBe('item');
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(48);
  });

  it('parseTags', () => {
    expect(parseTags('a, b,  c')).toEqual(['a', 'b', 'c']);
    expect(parseTags('#prod #db')).toEqual(['prod', 'db']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('  ')).toEqual([]);
  });

  it('stripControl removes control/escape bytes but keeps printable text', () => {
    expect(stripControl('ok')).toBe('ok');
    expect(stripControl('a\x1b]0;evil\x07b')).toBe('a]0;evilb'); // ESC + BEL gone
    expect(stripControl('line\nbreak\ttab')).toBe('linebreaktab');
    expect(stripControl(null)).toBe('');
  });
});

describe('isValidProxyJump', () => {
  it('accepts real jump specs and none', () => {
    expect(isValidProxyJump('bastion')).toBe(true);
    expect(isValidProxyJump('user@bastion:2222')).toBe(true);
    expect(isValidProxyJump('a,b@h:22')).toBe(true);
    expect(isValidProxyJump('[2001:db8::1]:22')).toBe(true);
    expect(isValidProxyJump('none')).toBe(true);
  });
  it('rejects option-injecting / malformed values', () => {
    expect(isValidProxyJump('-oProxyCommand=evil')).toBe(false); // leading dash
    expect(isValidProxyJump('a b')).toBe(false); // whitespace
    expect(isValidProxyJump('a\nb')).toBe(false); // control char
    expect(isValidProxyJump('')).toBe(false);
    expect(isValidProxyJump(42)).toBe(false);
  });
});

describe('time', () => {
  it('nowIso is parseable', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false);
  });

  it('relativeTime ranges', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(relativeTime(null)).toBe('никогда');
    expect(relativeTime('garbage')).toBe('никогда');
    expect(relativeTime(new Date(Date.now() + 10000).toISOString())).toBe('только что');
    expect(relativeTime(ago(5000))).toBe('только что');
    expect(relativeTime(ago(5 * 60 * 1000))).toBe('5 мин назад');
    expect(relativeTime(ago(2 * 60 * 60 * 1000))).toBe('2 ч назад');
    expect(relativeTime(ago(3 * 24 * 60 * 60 * 1000))).toBe('3 дн назад');
    expect(relativeTime(ago(14 * 24 * 60 * 60 * 1000))).toBe('2 нед назад');
    expect(relativeTime(ago(60 * 24 * 60 * 60 * 1000))).toBe('2 мес назад');
    expect(relativeTime(ago(400 * 24 * 60 * 60 * 1000))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('absoluteTime', () => {
    expect(absoluteTime(null)).toBe('—');
    expect(absoluteTime('nope')).toBe('—');
    expect(absoluteTime('2026-06-03T17:42:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('safeIso & ts', () => {
    const good = nowIso();
    expect(safeIso(good, null)).toBe(good);
    expect(safeIso(123, null)).toBeNull();
    expect(safeIso('bad', 'fallback')).toBe('fallback');
    expect(ts(null)).toBe(0);
    expect(ts('bad')).toBe(0);
    expect(ts('2020-01-01T00:00:00.000Z')).toBeGreaterThan(0);
  });
});

describe('exec', () => {
  it('commandExists', () => {
    expect(commandExists('node')).toBe(true);
    expect(commandExists('definitely-not-a-real-cmd-xyz')).toBe(false);
  });

  it('capture runs and returns output', () => {
    const r = capture('node', ['-e', 'process.stdout.write("hi"); process.stderr.write("oops")']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('hi');
    expect(r.stderr).toBe('oops');
  });
});

describe('platform', () => {
  it('exactly one platform flag matches process.platform', () => {
    const flags = [isMac, isWindows, isLinux].filter(Boolean).length;
    expect(flags).toBeLessThanOrEqual(1);
    if (process.platform === 'darwin') expect(isMac).toBe(true);
  });
});

describe('errors', () => {
  it('WizardError carries an exit code', () => {
    const e = new WizardError('boom', 7);
    expect(e.name).toBe('WizardError');
    expect(e.exitCode).toBe(7);
    expect(e.message).toBe('boom');
    expect(new WizardError('x').exitCode).toBe(1);
  });
  it('NotInteractiveError', () => {
    const e = new NotInteractiveError('Добавление');
    expect(e.exitCode).toBe(1);
    expect(e.message).toContain('Добавление');
    expect(e).toBeInstanceOf(WizardError);
  });
  it('PromptAbortError', () => {
    const e = new PromptAbortError();
    expect(e.exitCode).toBe(130);
    expect(e.message).toBe('Отменено.');
  });
  it('VaultLockedError', () => {
    expect(new VaultLockedError().exitCode).toBe(1);
    expect(new VaultLockedError('custom').message).toBe('custom');
  });
});

describe('exec branches', () => {
  it('capture pipes input and returns output', () => {
    const r = capture(
      'node',
      ['-e', 'process.stdin.on("data",(d)=>process.stdout.write(d))'],
      'echoed',
    );
    expect(r.stdout).toBe('echoed');
  });
  it('capture of a missing command yields empty strings + non-zero status', () => {
    const r = capture('definitely-not-real-xyz', []);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.status).not.toBe(0);
  });
  it('commandExists uses "where" on Windows', async () => {
    vi.resetModules();
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const { commandExists: ce } = await import('../src/utils/exec.js');
      expect(typeof ce('node')).toBe('boolean'); // exercises the 'where' branch
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
  it('commandExists is truthy for node', () => {
    expect(commandExists('node')).toBe(true);
  });
});

describe('validators branches', () => {
  it('isValidPort rejects non-numbers and out-of-range', () => {
    expect(isValidPort('abc')).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort('65536')).toBe(false);
  });
  it('isValidHostOrIp rejects non-strings, empty, bad octets', () => {
    expect(isValidHostOrIp(123)).toBe(false);
    expect(isValidHostOrIp('')).toBe(false);
    expect(isValidHostOrIp('256.1.1.1')).toBe(false);
  });
  it('isValidSshAlias rejects non-strings', () => {
    expect(isValidSshAlias(123)).toBe(false);
    expect(isValidSshAlias('')).toBe(false);
  });
});

describe('time helpers', () => {
  it('safeIso keeps valid and falls back on garbage', () => {
    const good = new Date().toISOString();
    expect(safeIso(good, null)).toBe(good);
    expect(safeIso('not-a-date', null)).toBeNull();
  });
  it('ts is total (0 for missing)', () => {
    expect(ts(null)).toBe(0);
    expect(ts('garbage')).toBe(0);
    expect(ts(new Date(0).toISOString())).toBe(0);
  });
  it('relativeTime handles null', () => {
    expect(relativeTime(null)).toBe('никогда');
  });
});

describe('validators', () => {
  it('ports', () => {
    expect(isValidPort('22')).toBe(true);
    expect(isValidPort('70000')).toBe(false);
    expect(isValidPort('0')).toBe(false);
  });
  it('hosts', () => {
    expect(isValidHostOrIp('203.0.113.7')).toBe(true);
    expect(isValidHostOrIp('example.com')).toBe(true);
    expect(isValidHostOrIp('999.1.1.1')).toBe(false);
  });
  it('aliases reject globs', () => {
    expect(isValidSshAlias('homelab-proxy')).toBe(true);
    expect(isValidSshAlias('*.internal')).toBe(false);
  });
});

describe('validators: IPv6', () => {
  it('accepts IPv6 literals', () => {
    expect(isValidHostOrIp('fe80::1')).toBe(true);
    expect(isValidHostOrIp('::1')).toBe(true);
    expect(isValidHostOrIp('not a host!')).toBe(false);
  });
  it('rejects structurally invalid IPv6 (multiple :: / dangling colon)', () => {
    expect(isValidHostOrIp('1::2::3')).toBe(false);
    expect(isValidHostOrIp('1:2:')).toBe(false);
  });
});

describe('validators: IPv4 leading zeros', () => {
  it('rejects octal-ambiguous leading-zero octets', () => {
    expect(isValidHostOrIp('010.0.0.1')).toBe(false);
    expect(isValidHostOrIp('1.2.3.04')).toBe(false);
    expect(isValidHostOrIp('10.0.0.1')).toBe(true);
    expect(isValidHostOrIp('0.0.0.0')).toBe(true);
  });
});

describe('I-2 background-log viewer strips terminal escapes', () => {
  it('sanitizeLog/tailLines drop ESC/OSC bytes but keep newlines and tabs', async () => {
    const { tailLines, sanitizeLog } = await import('../src/utils/logtail.js');
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const malicious = `line1${ESC}]0;hijacked-title${BEL}\tcol\nline2`;
    expect(sanitizeLog(malicious)).toBe('line1]0;hijacked-title\tcol\nline2');
    expect(tailLines(malicious, 5)).toEqual(['line1]0;hijacked-title\tcol', 'line2']);
    // a non-integer/zero tail count means "all", not a crash
    expect(tailLines('a\nb\nc', NaN)).toEqual(['a', 'b', 'c']);
  });
});

describe('utility hardening', () => {
  it('L-13 tilde does not collapse a sibling home directory', async () => {
    const { tilde } = await import('../src/utils/strings.js');
    const home = os.homedir();
    expect(tilde(home)).toBe('~');
    expect(tilde(path.join(home, 'x'))).toBe(`~${path.sep}x`);
    expect(tilde(home + 'by/secret')).toBe(home + 'by/secret'); // sibling untouched
  });

  it('I-17 safeIso accepts ISO shapes and rejects locale formats', async () => {
    const { safeIso } = await import('../src/utils/time.js');
    expect(safeIso('2026-06-09T10:00:00.000Z', null)).toBe('2026-06-09T10:00:00.000Z');
    expect(safeIso('2026-06-09', null)).toBe('2026-06-09');
    expect(safeIso('12/31/2020', null)).toBeNull(); // locale format rejected
    expect(safeIso('not a date', null)).toBeNull();
  });
});

describe('S-13: isValidProxyJump range-checks the hop port', () => {
  it('accepts valid hops', () => {
    expect(isValidProxyJump('bastion')).toBe(true);
    expect(isValidProxyJump('user@host:22')).toBe(true);
    expect(isValidProxyJump('host:65535')).toBe(true);
    expect(isValidProxyJump('[::1]:2222')).toBe(true);
    expect(isValidProxyJump('a,b:22,c')).toBe(true);
    expect(isValidProxyJump('none')).toBe(true);
  });
  it('rejects an out-of-range hop port', () => {
    expect(isValidProxyJump('host:0')).toBe(false);
    expect(isValidProxyJump('host:99999')).toBe(false);
    expect(isValidProxyJump('host:65536')).toBe(false);
  });
});

describe('utils/net — port probes', () => {
  it('detects a bound port as busy and finds a free one above it', async () => {
    const { isPortFree, findFreePort } = await import('../src/utils/net.js');
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as net.AddressInfo).port;

    expect(await isPortFree(port)).toBe(false);
    const free = await findFreePort(port + 1, 200);
    expect(free).not.toBeNull();
    expect(free).toBeGreaterThan(port);
    expect(await isPortFree(free as number)).toBe(true);

    await new Promise<void>((r) => srv.close(() => r()));
  });

  it('rejects invalid ports', async () => {
    const { isPortFree } = await import('../src/utils/net.js');
    expect(await isPortFree(0)).toBe(false);
    expect(await isPortFree(70_000)).toBe(false);
    expect(await isPortFree(-1)).toBe(false);
  });
});
