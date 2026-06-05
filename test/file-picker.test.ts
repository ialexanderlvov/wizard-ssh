import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@inquirer/testing';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickPath, BACK } from '../src/ui/file-picker.js';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wssh-fp-'));
  fs.mkdirSync(path.join(dir, 'alpha'));
  fs.writeFileSync(path.join(dir, 'alpha', 'inner.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'beta.txt'), 'bb');
  fs.writeFileSync(path.join(dir, 'gamma.txt'), 'gg');
  fs.writeFileSync(path.join(dir, '.hidden'), 'secret');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('file picker', () => {
  it('lists folders (with /) and files, hiding dotfiles by default', async () => {
    const { getScreen } = await render(pickPath, { message: 'Pick', start: dir, select: 'file' });
    const screen = getScreen();
    expect(screen).toContain('alpha/');
    expect(screen).toContain('beta.txt');
    expect(screen).not.toContain('.hidden');
  });

  it('selects a file with Enter and returns its absolute path', async () => {
    const { answer, events } = await render(pickPath, {
      message: 'Pick',
      start: dir,
      select: 'file',
    });
    // rows: [.. (parent), alpha/, beta.txt, gamma.txt, BACK]; step to beta.txt
    events.keypress('down'); // alpha/
    events.keypress('down'); // beta.txt
    events.keypress('enter');
    await expect(answer).resolves.toBe(path.join(dir, 'beta.txt'));
  });

  it('walks into a folder with → and selects a nested file', async () => {
    const { answer, events, getScreen } = await render(pickPath, {
      message: 'Pick',
      start: dir,
      select: 'file',
    });
    events.keypress('down'); // alpha/
    events.keypress('right'); // enter alpha/
    expect(getScreen()).toContain('inner.txt');
    events.keypress('down'); // inner.txt (after the parent row)
    events.keypress('enter');
    await expect(answer).resolves.toBe(path.join(dir, 'alpha', 'inner.txt'));
  });

  it('filters as you type', async () => {
    const { getScreen, events } = await render(pickPath, {
      message: 'Pick',
      start: dir,
      select: 'file',
    });
    events.type('gam');
    const screen = getScreen();
    expect(screen).toContain('gamma.txt');
    expect(screen).not.toContain('beta.txt');
  });

  it('Ctrl+H reveals hidden dotfiles', async () => {
    const { getScreen, events } = await render(pickPath, {
      message: 'Pick',
      start: dir,
      select: 'file',
    });
    expect(getScreen()).not.toContain('.hidden');
    events.keypress({ name: 'h', ctrl: true });
    expect(getScreen()).toContain('.hidden');
  });

  it('directory mode: the top row returns the current folder', async () => {
    const { answer, events, getScreen } = await render(pickPath, {
      message: 'Pick a folder',
      start: dir,
      select: 'directory',
    });
    expect(getScreen()).toContain('✅'); // the "choose this folder" row (locale-agnostic)
    events.keypress('enter'); // the chooseDir row is first
    await expect(answer).resolves.toBe(dir);
  });

  it('Esc backs out with BACK', async () => {
    const { answer, events } = await render(pickPath, {
      message: 'Pick',
      start: dir,
      select: 'file',
    });
    events.keypress('escape');
    await expect(answer).resolves.toBe(BACK);
  });

  it('allowCreate: Ctrl+G lets you type a new (non-existent) path', async () => {
    const { answer, events } = await render(pickPath, {
      message: 'Save as',
      start: dir,
      select: 'file',
      allowCreate: true,
    });
    events.keypress({ name: 'g', ctrl: true }); // manual path entry
    events.type('newkey');
    events.keypress('enter');
    await expect(answer).resolves.toBe(path.join(dir, 'newkey'));
  });

  it('start at a file opens its parent directory', async () => {
    const { getScreen } = await render(pickPath, {
      message: 'Pick',
      start: path.join(dir, 'beta.txt'),
      select: 'file',
    });
    expect(getScreen()).toContain('beta.txt');
    expect(getScreen()).toContain('gamma.txt');
  });
});
