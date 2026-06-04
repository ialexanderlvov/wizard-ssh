import { describe, it, expect } from 'vitest';
import { render } from '@inquirer/testing';
import { pickFromList, BACK } from '../src/ui/list-prompt.js';

interface Row {
  name: string;
  uses: number;
}
const rows: Row[] = [
  { name: 'alpha', uses: 1 },
  { name: 'beta', uses: 9 },
  { name: 'gamma', uses: 5 },
];

const base = {
  message: 'Pick',
  items: rows,
  render: (r: Row) => `${r.name} (${r.uses})`,
  search: (r: Row) => r.name,
  sorts: [
    { label: 'имя', compare: (a: Row, b: Row) => a.name.localeCompare(b.name) },
    { label: 'использования', compare: (a: Row, b: Row) => b.uses - a.uses },
  ],
};

describe('pickFromList', () => {
  it('selects the active item on Enter', async () => {
    const { answer, events, getScreen } = await render(pickFromList, base);
    expect(getScreen()).toContain('alpha');
    events.keypress('down'); // move to beta
    events.keypress('enter');
    await expect(answer).resolves.toEqual({ name: 'beta', uses: 9 });
  });

  it('filters as you type, then selects the match', async () => {
    const { answer, events, getScreen } = await render(pickFromList, base);
    events.type('gam');
    expect(getScreen()).toContain('gamma');
    expect(getScreen()).not.toContain('alpha');
    events.keypress('enter');
    await expect(answer).resolves.toEqual({ name: 'gamma', uses: 5 });
  });

  it('Esc returns BACK', async () => {
    const { answer, events } = await render(pickFromList, base);
    events.keypress('escape');
    await expect(answer).resolves.toBe(BACK);
  });

  it('a lone ESC byte backs out immediately (no escapeCodeTimeout wait)', async () => {
    // The fast path resolves on the raw 0x1b byte rather than waiting ~500ms for
    // readline to surface the keypress, so backing out of a menu is instant.
    const { answer, events } = await render(pickFromList, base);
    events.type('\u001b'); // a bare ESC byte
    await expect(answer).resolves.toBe(BACK);
  });

  it('under a TTY, ignores a byte-less Esc echo but honors a real (byte-backed) Esc', async () => {
    // In a real terminal a previous inquirer prompt can re-emit a held Esc as a
    // byte-less keypress after closing; that echo must NOT back this list out.
    const desc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const { answer, events, getScreen } = await render(pickFromList, base);
      events.keypress('escape'); // echo: no preceding input byte → ignored
      expect(getScreen()).toContain('alpha'); // still open, did not back out
      events.type('z'); // a real keystroke writes a byte (sets lastByteAt)
      events.keypress('escape'); // now a byte-backed Esc → backs out
      await expect(answer).resolves.toBe(BACK);
    } finally {
      if (desc) Object.defineProperty(process.stdin, 'isTTY', desc);
      else delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
    }
  });

  it('the trailing back row returns BACK', async () => {
    const { answer, events } = await render(pickFromList, base);
    events.keypress('up'); // wrap to the "← Назад" row (it is last)
    events.keypress('enter');
    await expect(answer).resolves.toBe(BACK);
  });

  it('Ctrl+C is converted to PromptAbortError (clean cancel, not a raw crash)', async () => {
    const { PromptAbortError } = await import('../src/core/errors.js');
    const { answer, events } = await render(pickFromList, base);
    events.keypress({ name: 'c', ctrl: true });
    await expect(answer).rejects.toBeInstanceOf(PromptAbortError);
  });

  it('Tab cycles the sort mode (footer reflects it)', async () => {
    const { answer, events, getScreen } = await render(pickFromList, base);
    expect(getScreen()).toContain('имя');
    events.keypress('tab');
    expect(getScreen()).toContain('использования');
    events.keypress('escape');
    await answer.catch(() => {});
  });

  it('shows a breadcrumb + indented rows for depth', async () => {
    const { answer, events, getScreen } = await render(pickFromList, {
      ...base,
      crumbs: ['Главное меню', 'Серверы'],
      indent: 4,
    });
    const screen = getScreen();
    expect(screen).toContain('wssh');
    expect(screen).toContain('Главное меню');
    expect(screen).toContain('Серверы');
    expect(screen).toMatch(/\n {4}.*alpha/); // body rows indented by 4
    events.keypress('escape');
    await answer;
  });
});
