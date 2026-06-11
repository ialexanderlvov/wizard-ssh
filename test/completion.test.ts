import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

async function buildProgram(): Promise<Command> {
  const { registerCommands } = await import('../src/commands/index.js');
  const p = new Command();
  p.name('wssh').enablePositionalOptions(); // mirror cli.ts (run uses passThroughOptions)
  registerCommands(p);
  return p;
}

describe('shell completion', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('top level → command names (the hidden `complete` is not offered)', async () => {
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const c = completeFromProgram(await buildProgram(), ['']);
    expect(c).toEqual(
      expect.arrayContaining(['connect', 'server', 'tunnel', 'status', 'completion']),
    );
    expect(c).not.toContain('complete');
  });

  it('a group → its subcommands', async () => {
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const c = completeFromProgram(await buildProgram(), ['server', '']);
    expect([...c].sort()).toEqual(['add', 'connect', 'duplicate', 'edit', 'list', 'remove'].sort());
  });

  it('a name-taking command → entity names (scoped by kind)', async () => {
    const { servers } = await import('../src/store/servers.store.js');
    const { tunnels } = await import('../src/store/tunnels.store.js');
    servers.create({ name: 'box', host: '1.1.1.1', kind: 'server' });
    tunnels.create({ name: 'tnl', type: 'local', localPort: 8080, remotePort: 80, kind: 'tunnel' });
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const p = await buildProgram();
    expect(completeFromProgram(p, ['connect', ''])).toEqual(expect.arrayContaining(['box', 'tnl']));
    const srvOnly = completeFromProgram(p, ['server', 'connect', '']);
    expect(srvOnly).toContain('box');
    expect(srvOnly).not.toContain('tnl'); // server-scoped, no tunnels
  });

  it('a flag context → command flags plus globals', async () => {
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const c = completeFromProgram(await buildProgram(), ['status', '--']);
    expect(c).toEqual(
      expect.arrayContaining([
        '--json',
        '--servers',
        '--tunnels',
        '--tag',
        '--help',
        '--non-interactive',
      ]),
    );
  });

  it('emits a script with the right hooks for each shell', async () => {
    const { completionScript } = await import('../src/commands/completion.js');
    expect(completionScript('bash')).toContain('complete -F _wssh_complete');
    expect(completionScript('zsh')).toContain('#compdef wssh');
    expect(completionScript('fish')).toContain('complete -c wssh');
    for (const s of ['bash', 'zsh', 'fish'] as const) {
      expect(completionScript(s)).toContain('wssh complete --');
    }
  });
});

// Scaffolding from audit-fixes2.test.ts (buildProgram merged with the identical
// helper above).
function writeSshConfig(text: string): void {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config'), text);
}

describe('C-1 bash completion is injection-safe', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('the bash wrapper never re-expands candidates (no compgen -W)', async () => {
    const { completionScript } = await import('../src/commands/completion.js');
    const bash = completionScript('bash');
    expect(bash).not.toContain('compgen -W');
    expect(bash).toContain('while IFS= read -r line'); // literal, prefix-matched
  });

  it('a hostile config-host alias is dropped from completion candidates', async () => {
    writeSshConfig(
      'Host $(touch_pwned)\n  HostName 1.1.1.1\n\nHost prod-web\n  HostName 2.2.2.2\n',
    );
    const { completeFromProgram } = await import('../src/commands/completion.js');
    const cands = completeFromProgram(await buildProgram(), ['connect', '']);
    expect(cands).toContain('prod-web');
    expect(cands.some((c) => c.includes('$('))).toBe(false);
    expect(cands.some((c) => c.includes('`'))).toBe(false);
  });
});
