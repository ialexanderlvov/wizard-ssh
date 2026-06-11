import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome, listMock, promptMock } from './helpers.js';
import { splitTokens } from '../src/ssh-config/parser.js';

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

  it('a wildcard+alias block (Host * prod) is never spliced/clobbered', async () => {
    // The `*` is filtered from the alias list, leaving a single alias "prod" — the
    // old single-alias check would have rewritten the block and dropped the `Host *`
    // global defaults. patternCount must keep it non-manageable.
    writeConfig('Host * prod\n    ForwardAgent yes\n    User admin\n');
    const cfg = await load();
    expect(cfg.getHost('prod')?.manageable).toBe(false);
    expect(cfg.isManageable('prod')).toBe(false);
    expect(cfg.removeHost('prod').removed).toBe(false);
    cfg.upsertHost({ alias: 'prod', params: [{ key: 'HostName', value: '9.9.9.9' }] });
    // The global block is preserved (a fresh single-alias block is appended instead).
    expect(readConfig()).toContain('Host * prod');
    expect(readConfig()).toContain('ForwardAgent yes');
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

describe('ssh-config tokens', () => {
  it('respects quoted paths with spaces', () => {
    expect(splitTokens('"~/My Confs/a" b c')).toEqual(['~/My Confs/a', 'b', 'c']);
  });
});

describe('ssh-config parser branches', () => {
  it('filters wildcard/negated aliases and reads extra params', async () => {
    vi.resetModules();
    freshHome();
    writeConfig(
      [
        'Host real !nope srv?',
        '    HostName 1.1.1.1',
        '    IdentityFile ~/.ssh/id',
        '    ProxyJump bastion',
        'Host=eqstyle',
        '    User x',
      ].join('\n'),
    );
    const cfg = await import('../src/ssh-config/index.js');
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('real');
    expect(aliases).toContain('eqstyle'); // "Host=value" syntax
    expect(aliases).not.toContain('!nope');
    expect(aliases).not.toContain('srv?');
    const real = cfg.getHost('real');
    expect(real?.identityFile).toBe('~/.ssh/id');
    expect(real?.proxyJump).toBe('bastion');
  });

  it('expands a ~/ Include glob', async () => {
    vi.resetModules();
    freshHome();
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(path.join(sshDir, 'c.d'), { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'c.d', 'extra.conf'), 'Host inc\n    HostName 2.2.2.2\n');
    writeConfig('Include ~/.ssh/c.d/*.conf\nHost base\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toContain('inc');
  });
});

describe('parser branches', () => {
  // Scaffolding from branches4.test.ts (file-level beforeEach), scoped here.
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('skips params before any Host and resolves relative + absolute Include', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, 'rel.conf'), 'Host relhost\n    HostName 3.3.3.3\n');
    writeConfig(
      'ForwardAgent yes\nInclude rel.conf\nInclude /no/such/abs/path\nHost base\n    HostName 1.1.1.1\n',
    );
    const cfg = await import('../src/ssh-config/index.js');
    const aliases = cfg.listHosts().map((h) => h.alias);
    expect(aliases).toContain('relhost'); // relative include resolved against ~/.ssh
    expect(aliases).toContain('base');
  });
});

describe('ssh-config parser extras', () => {
  it('handles Match blocks + exposes mainBlocks', async () => {
    vi.resetModules();
    freshHome();
    writeConfig('# c\n\nMatch host *\n    ForwardAgent yes\n\nHost real\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toContain('real');
    expect(cfg.mainBlocks().some((b) => b.aliases.includes('real'))).toBe(true);
  });

  it('ignores Include globs that match nothing', async () => {
    vi.resetModules();
    freshHome();
    writeConfig('Include /no/such/dir/*\nHost x\n    HostName 1.1.1.1\n');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.listHosts().map((h) => h.alias)).toEqual(['x']);
  });
});

// Scaffolding from audit-fixes.test.ts — like writeConfig, but can also write a
// sibling file next to the main config (for Include targets).
function writeSshConfig(text: string, file = 'config'): string {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, text);
  return p;
}

describe('#5 upsertHost refuses to shadow an Include-only alias', () => {
  // Scaffolding from audit-fixes.test.ts (file-level beforeEach), scoped here.
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('throws instead of appending a duplicate block, leaving the main config clean', async () => {
    writeSshConfig('Host inconly\n    HostName 7.7.7.7\n', 'sub');
    const mainPath = writeSshConfig('Include sub\n');
    const { upsertHost } = await import('../src/ssh-config/writer.js');
    expect(() =>
      upsertHost({ alias: 'inconly', params: [{ key: 'HostName', value: '8.8.8.8' }], wssh: {} }),
    ).toThrow();
    expect(fs.readFileSync(mainPath, 'utf8')).not.toMatch(/Host inconly/);
  });

  it('replace-import skips the Include-only collision without crashing or duplicating', async () => {
    writeSshConfig('Host inconly\n    HostName 7.7.7.7\n', 'sub');
    const mainPath = writeSshConfig('Include sub\n');
    const { servers } = await import('../src/store/servers.store.js');
    expect(() =>
      servers.replaceAll([
        {
          kind: 'server',
          id: 'inconly',
          name: 'inconly',
          hostMode: 'sshconfig',
          host: '8.8.8.8',
          user: 'x',
          sshPort: 22,
          auth: 'agent',
          keyPath: null,
        } as never,
      ]),
    ).not.toThrow();
    const occurrences = (fs.readFileSync(mainPath, 'utf8').match(/Host inconly/g) ?? []).length;
    expect(occurrences).toBe(0);
  });
});

// Scaffolding from branches4.test.ts for the command-flow tests below.
const q = {
  text: [] as unknown[],
  choose: [] as unknown[],
  confirm: [] as unknown[],
  secret: [] as unknown[],
  multi: [] as unknown[],
  search: [] as unknown[],
  pick: [] as unknown[],
};
const resetQ = (): void => (Object.keys(q) as Array<keyof typeof q>).forEach((k) => (q[k] = []));
function cmdMocks(): void {
  vi.doMock('../src/ui/prompts.js', () => promptMock(q));
  vi.doMock('../src/ui/list-prompt.js', () => listMock(q));
  vi.doMock('../src/ssh/runner.js', () => ({
    runInteractive: async () => 0,
    runTunnel: async () => 0,
    runSshInherit: async () => 0,
    runProgram: async () => 0,
    preflight: () => null,
  }));
  vi.doMock('../src/vault/touchid.js', () => ({
    isSupported: () => false,
    authenticate: () => false,
    storeKey: () => false,
    loadKey: () => null,
    deleteKey: () => {},
  }));
}

describe('writer trim/swallow branches', () => {
  // Scaffolding from branches4.test.ts (file-level beforeEach), scoped here.
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    resetQ();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cmdMocks();
  });

  it('upsert trims trailing comment/blank lines of a block', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n\n# trailing\n');
    q.text = ['2.2.2.2', 'u', '', '', ''];
    const { editConfigHost } = await import('../src/commands/config.js');
    await editConfigHost('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')?.hostName).toBe('2.2.2.2');
  });

  it('remove swallows the trailing blank line between blocks', async () => {
    writeConfig('Host h1\n    HostName 1.1.1.1\n\nHost h2\n    HostName 2.2.2.2\n');
    q.confirm = [true];
    const { removeConfigHostFlow } = await import('../src/commands/config.js');
    await removeConfigHostFlow('h1');
    const cfg = await import('../src/ssh-config/index.js');
    expect(cfg.getHost('h1')).toBeNull();
    expect(cfg.getHost('h2')?.hostName).toBe('2.2.2.2');
  });
});
