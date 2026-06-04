import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { freshHome } from './helpers.js';

async function buildProgram(): Promise<Command> {
  const { registerCommands } = await import('../src/commands/index.js');
  const p = new Command();
  p.name('wssh').enablePositionalOptions();
  registerCommands(p);
  return p;
}

describe('man page', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('generates roff with the standard sections and the command set', async () => {
    const { manRoff } = await import('../src/commands/man.js');
    const r = manRoff(await buildProgram());
    expect(r).toMatch(/^\.TH WSSH 1 /m);
    for (const s of [
      '.SH NAME',
      '.SH SYNOPSIS',
      '.SH DESCRIPTION',
      '.SH COMMANDS',
      '.SH "GLOBAL OPTIONS"',
      '.SH ENVIRONMENT',
      '.SH FILES',
      '.SH EXAMPLES',
    ]) {
      expect(r).toContain(s);
    }
    expect(r).toMatch(/\.B connect/);
    expect(r).toMatch(/\.B server/);
    expect(r).toMatch(/\.B tunnel/);
    expect(r).toContain('WSSH_LANG');
    expect(r).toContain('~/.ssh/config');
  });

  it('--roff prints the roff source to stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { manFlow } = await import('../src/commands/man.js');
    const code = manFlow(await buildProgram(), { roff: true });
    expect(code).toBe(0);
    const out = write.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('.TH WSSH 1');
    expect(out).toContain('.SH COMMANDS');
    write.mockRestore();
  });
});
