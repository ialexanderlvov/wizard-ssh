import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

function writeConfig(contents: string): void {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), contents);
}

const readConfig = (): string => fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');

const load = () => import('../src/ssh-config/index.js');

describe('ssh-config parser', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('lists hosts, skips wildcard/negation, reads metadata', async () => {
    writeConfig(
      [
        'Host alpha',
        '    HostName 10.0.0.1',
        '    User ada',
        '    Port 2222',
        '',
        'Host *.internal',
        '    User admin',
        '',
        'Host beta gamma',
        '    HostName 10.0.0.2',
      ].join('\n'),
    );
    const cfg = await load();
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('alpha');
    expect(aliases).toContain('beta');
    expect(aliases).toContain('gamma'); // multi-alias expands
    expect(aliases).not.toContain('*.internal');

    const alpha = cfg.getHost('alpha');
    expect(alpha?.hostName).toBe('10.0.0.1');
    expect(alpha?.user).toBe('ada');
    expect(alpha?.port).toBe('2222');
    expect(cfg.getHost('missing')).toBeNull();
    expect(cfg.hasConfig()).toBe(true);
  });

  it('follows Include directives', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(path.join(sshDir, 'conf.d'), { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'conf.d', 'extra'), 'Host included\n    HostName 9.9.9.9\n');
    writeConfig('Include conf.d/*\n\nHost main\n    HostName 1.1.1.1\n');
    const cfg = await load();
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('included');
    expect(aliases).toContain('main');
  });

  it('hasConfig is false without a file', async () => {
    const cfg = await load();
    expect(cfg.hasConfig()).toBe(false);
    expect(cfg.listHosts()).toEqual([]);
  });
});

describe('ssh-config writer', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('formatBlock skips empty keys/values', async () => {
    const cfg = await load();
    expect(
      cfg.formatBlock({
        alias: 'x',
        params: [
          { key: 'HostName', value: '1.2.3.4' },
          { key: '', value: 'skip' },
          { key: 'User', value: '' },
        ],
      }),
    ).toEqual(['Host x', '    HostName 1.2.3.4']);
  });

  it('add → edit → remove round-trip preserves other blocks', async () => {
    writeConfig('Host keep\n    HostName 10.0.0.1\n    User bob\n\nHost *.wild\n    User admin\n');
    const cfg = await load();

    const added = cfg.upsertHost({
      alias: 'newh',
      params: [
        { key: 'HostName', value: '1.2.3.4' },
        { key: 'User', value: 'root' },
        { key: 'Port', value: '2222' },
      ],
    });
    expect(added.created).toBe(true);
    expect(added.backup).toBeTruthy();
    expect(cfg.getHost('newh')?.port).toBe('2222');

    const edited = cfg.upsertHost({
      alias: 'newh',
      params: [{ key: 'HostName', value: '9.9.9.9' }],
    });
    expect(edited.created).toBe(false);
    expect(cfg.getHost('newh')?.hostName).toBe('9.9.9.9');
    expect(cfg.isManageable('newh')).toBe(true);

    const removed = cfg.removeHost('newh');
    expect(removed.removed).toBe(true);
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toEqual(['keep']); // wildcard excluded, newh gone, keep preserved
  });

  it('normalises CRLF input to LF on write', async () => {
    writeConfig('Host crlf\r\n    HostName 1.1.1.1\r\n');
    const cfg = await load();
    cfg.upsertHost({ alias: 'added', params: [{ key: 'HostName', value: '2.2.2.2' }] });
    expect(readConfig()).not.toContain('\r');
  });

  it('multi-alias / wildcard blocks are not manageable', async () => {
    writeConfig('Host a b\n    HostName 1.1.1.1\n');
    const cfg = await load();
    expect(cfg.isManageable('a')).toBe(false);
    expect(cfg.removeHost('a').removed).toBe(false);
  });

  it('backupConfig returns null without a config, path with one', async () => {
    const cfg = await load();
    expect(cfg.backupConfig()).toBeNull();
    writeConfig('Host z\n    HostName 1.1.1.1\n');
    const backup = cfg.backupConfig();
    expect(backup).toBeTruthy();
    expect(fs.existsSync(backup as string)).toBe(true);
  });

  it('upsert creates the file when none exists', async () => {
    const cfg = await load();
    const res = cfg.upsertHost({ alias: 'first', params: [{ key: 'HostName', value: '1.1.1.1' }] });
    expect(res.created).toBe(true);
    expect(cfg.getHost('first')?.hostName).toBe('1.1.1.1');
  });
});
