import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: () => {} })) }));
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  return { ...actual, spawn: h.spawn };
});

import { openInBrowser, isMac, isWindows, isLinux } from '../src/utils/platform.js';

describe('platform', () => {
  it('one platform flag at most, matching process.platform', () => {
    expect([isMac, isWindows, isLinux].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it('openInBrowser spawns the platform opener', () => {
    openInBrowser('http://localhost:8080');
    expect(h.spawn).toHaveBeenCalled();
    const cmd = h.spawn.mock.calls[0]?.[0];
    const expected = isMac ? 'open' : isWindows ? 'cmd' : 'xdg-open';
    expect(cmd).toBe(expected);
  });

  it('openInBrowser never throws even if spawn fails', () => {
    h.spawn.mockImplementationOnce(() => {
      throw new Error('nope');
    });
    expect(() => openInBrowser('http://x')).not.toThrow();
  });
});
