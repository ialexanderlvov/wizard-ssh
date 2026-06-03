import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  password: vi.fn(),
  checkbox: vi.fn(),
  search: vi.fn(),
}));

import * as inq from '@inquirer/prompts';
import {
  text,
  choose,
  confirm,
  secret,
  multiChoose,
  searchChoose,
  pause,
  isInteractive,
  ensureInteractive,
} from '../src/ui/prompts.js';
import { NotInteractiveError, PromptAbortError } from '../src/core/errors.js';

const mock = inq as unknown as Record<string, Mock>;

beforeEach(() => {
  Object.values(mock).forEach((m) => m.mockReset());
});

describe('prompt wrappers delegate to @inquirer', () => {
  it('text → input', async () => {
    mock.input.mockResolvedValue('hello');
    expect(await text({ message: 'm' })).toBe('hello');
    expect(mock.input).toHaveBeenCalled();
  });
  it('choose → select', async () => {
    mock.select.mockResolvedValue('v');
    expect(await choose({ message: 'm', choices: [{ name: 'n', value: 'v' }], default: 'v' })).toBe(
      'v',
    );
  });
  it('confirm → confirm', async () => {
    mock.confirm.mockResolvedValue(true);
    expect(await confirm({ message: 'm', default: true })).toBe(true);
  });
  it('secret → password', async () => {
    mock.password.mockResolvedValue('pw');
    expect(await secret({ message: 'm' })).toBe('pw');
  });
  it('multiChoose → checkbox', async () => {
    mock.checkbox.mockResolvedValue(['a', 'b']);
    expect(await multiChoose({ message: 'm', choices: [] })).toEqual(['a', 'b']);
  });
  it('searchChoose → search with a source', async () => {
    mock.search.mockResolvedValue('picked');
    const out = await searchChoose<string>({
      message: 'm',
      source: () => [{ name: 'x', value: 'x' }],
    });
    expect(out).toBe('picked');
    expect(mock.search).toHaveBeenCalled();
  });
  it('pause → input', async () => {
    mock.input.mockResolvedValue('');
    await expect(pause()).resolves.toBeUndefined();
  });
});

describe('guard converts abort errors', () => {
  it('ExitPromptError → PromptAbortError', async () => {
    mock.input.mockRejectedValue(Object.assign(new Error('closed'), { name: 'ExitPromptError' }));
    await expect(text({ message: 'm' })).rejects.toBeInstanceOf(PromptAbortError);
  });
  it('ERR_USE_AFTER_CLOSE → PromptAbortError', async () => {
    mock.select.mockRejectedValue(Object.assign(new Error('x'), { code: 'ERR_USE_AFTER_CLOSE' }));
    await expect(choose({ message: 'm', choices: [] })).rejects.toBeInstanceOf(PromptAbortError);
  });
  it('readline-closed message → PromptAbortError', async () => {
    mock.confirm.mockRejectedValue(new Error('readline was closed'));
    await expect(confirm({ message: 'm' })).rejects.toBeInstanceOf(PromptAbortError);
  });
  it('other errors propagate unchanged', async () => {
    mock.password.mockRejectedValue(new Error('boom'));
    await expect(secret({ message: 'm' })).rejects.toThrow('boom');
  });
});

describe('interactivity guard', () => {
  it('isInteractive false in tests; ensureInteractive throws', () => {
    expect(isInteractive()).toBe(false);
    expect(() => ensureInteractive()).toThrow(NotInteractiveError);
  });
});
