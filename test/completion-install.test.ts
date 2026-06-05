import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { freshHome } from './helpers.js';

/** Re-import fresh so the module re-reads env each test. */
async function load() {
  return import('../src/commands/completion-install.js');
}

const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('completion install', () => {
  let HOME: string;
  const savedShell = process.env.SHELL;
  const savedZsh = process.env.ZSH;
  const savedZshCustom = process.env.ZSH_CUSTOM;
  const savedXdgC = process.env.XDG_CONFIG_HOME;
  const savedXdgD = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    HOME = freshHome();
    delete process.env.ZSH;
    delete process.env.ZSH_CUSTOM;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
  });
  afterEach(() => {
    process.env.SHELL = savedShell;
    if (savedZsh === undefined) delete process.env.ZSH;
    else process.env.ZSH = savedZsh;
    if (savedZshCustom === undefined) delete process.env.ZSH_CUSTOM;
    else process.env.ZSH_CUSTOM = savedZshCustom;
    if (savedXdgC === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdgC;
    if (savedXdgD === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdgD;
  });

  it('detects the shell from $SHELL, undefined for unknown', async () => {
    const { detectShell } = await load();
    process.env.SHELL = '/usr/bin/zsh';
    expect(detectShell()).toBe('zsh');
    process.env.SHELL = '/opt/homebrew/bin/fish';
    expect(detectShell()).toBe('fish');
    process.env.SHELL = '/bin/dash';
    expect(detectShell()).toBeUndefined();
  });

  it('bash: writes a source file and a guarded block in ~/.bashrc', async () => {
    const { installCompletion } = await load();
    const r = installCompletion('bash');
    expect(fs.existsSync(r.file)).toBe(true);
    expect(read(r.file)).toContain('complete -F _wssh_complete');
    expect(r.rcEdited).toBe(true);
    const rc = read(path.join(HOME, '.bashrc'));
    expect(rc).toContain('# >>> wizard-ssh completion >>>');
    expect(rc).toContain(`source "${r.file}"`);
  });

  it('bash: re-running is idempotent (one block, no duplicate source line)', async () => {
    const { installCompletion } = await load();
    installCompletion('bash');
    const r2 = installCompletion('bash');
    const rc = read(path.join(HOME, '.bashrc'));
    expect(rc.match(/# >>> wizard-ssh completion >>>/g)).toHaveLength(1);
    expect(r2.rcEdited).toBe(false); // nothing changed the second time
  });

  it('plain zsh: writes _wssh under ~/.zsh and wires fpath+compinit in ~/.zshrc', async () => {
    const { installCompletion } = await load();
    const r = installCompletion('zsh');
    expect(r.ohMyZsh).toBe(false);
    expect(r.file).toBe(path.join(HOME, '.zsh', 'completions', '_wssh'));
    expect(read(r.file)).toContain('#compdef wssh');
    const rc = read(path.join(HOME, '.zshrc'));
    expect(rc).toContain('fpath=(');
    expect(rc).toContain('compinit');
  });

  it('oh-my-zsh: drops _wssh on its fpath and does NOT edit ~/.zshrc', async () => {
    const { installCompletion } = await load();
    const zsh = path.join(HOME, '.oh-my-zsh');
    fs.mkdirSync(zsh, { recursive: true });
    process.env.ZSH = zsh;
    const r = installCompletion('zsh');
    expect(r.ohMyZsh).toBe(true);
    expect(r.file).toBe(path.join(zsh, 'custom', 'completions', '_wssh'));
    expect(r.rcEdited).toBe(false);
    expect(fs.existsSync(path.join(HOME, '.zshrc'))).toBe(false);
  });

  it('zsh: clears stale .zcompdump caches but leaves other dotfiles', async () => {
    const { installCompletion } = await load();
    fs.writeFileSync(path.join(HOME, '.zcompdump-host-5.9'), 'stale');
    fs.writeFileSync(path.join(HOME, '.zshrc'), '# mine\n');
    installCompletion('zsh');
    expect(fs.existsSync(path.join(HOME, '.zcompdump-host-5.9'))).toBe(false);
    expect(read(path.join(HOME, '.zshrc'))).toContain('# mine');
  });

  it('fish: writes wssh.fish under config completions, no rc edit', async () => {
    const { installCompletion } = await load();
    const r = installCompletion('fish');
    expect(r.rcEdited).toBe(false);
    expect(r.file).toBe(path.join(HOME, '.config', 'fish', 'completions', 'wssh.fish'));
    expect(read(r.file)).toContain('complete -c wssh');
  });

  it('respects XDG_CONFIG_HOME for fish', async () => {
    const { installCompletion } = await load();
    const xdg = path.join(HOME, 'xdgcfg');
    process.env.XDG_CONFIG_HOME = xdg;
    const r = installCompletion('fish');
    expect(r.file).toBe(path.join(xdg, 'fish', 'completions', 'wssh.fish'));
  });

  it('uninstall removes the file and the rc block', async () => {
    const { installCompletion, uninstallCompletion } = await load();
    installCompletion('bash');
    const before = read(path.join(HOME, '.bashrc'));
    expect(before).toContain('wizard-ssh completion');
    const r = uninstallCompletion('bash');
    expect(r.removed).toHaveLength(1);
    expect(r.rcEdited).toBe(true);
    expect(read(path.join(HOME, '.bashrc'))).not.toContain('wizard-ssh completion');
  });

  it('uninstall on a clean home reports nothing removed', async () => {
    const { uninstallCompletion } = await load();
    const r = uninstallCompletion('fish');
    expect(r.removed).toHaveLength(0);
    expect(r.rcEdited).toBe(false);
  });

  it('tildify shortens paths under $HOME', async () => {
    const { tildify } = await load();
    expect(tildify(path.join(HOME, '.zshrc'))).toBe('~/.zshrc');
    expect(tildify('/etc/hosts')).toBe('/etc/hosts');
  });

  it('uninstall preserves surrounding ~/.bashrc content', async () => {
    const { installCompletion, uninstallCompletion } = await load();
    const rc = path.join(HOME, '.bashrc');
    fs.writeFileSync(rc, 'export FOO=1\n');
    installCompletion('bash');
    uninstallCompletion('bash');
    const out = read(rc);
    expect(out).toContain('export FOO=1');
    expect(out).not.toContain('wizard-ssh');
  });
});
