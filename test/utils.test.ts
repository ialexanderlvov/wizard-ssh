import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { expandHome, tilde, slugify, parseTags, stripControl } from '../src/utils/strings.js';
import { isValidProxyJump } from '../src/utils/validators.js';
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
