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
});
