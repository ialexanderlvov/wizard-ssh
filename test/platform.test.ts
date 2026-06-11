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

describe('platform openInBrowser per-OS', () => {
  it('uses cmd on Windows and xdg-open on Linux', async () => {
    for (const [plat, expected] of [
      ['win32', 'cmd'],
      ['linux', 'xdg-open'],
    ] as const) {
      vi.resetModules();
      const spawn = vi.fn(() => ({ unref: () => {} }));
      vi.doMock('node:child_process', async (orig) => {
        const a = await orig<typeof import('node:child_process')>();
        return { ...a, spawn };
      });
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: plat, configurable: true });
      try {
        const { openInBrowser } = await import('../src/utils/platform.js');
        openInBrowser('http://x');
        expect(spawn.mock.calls[0]?.[0]).toBe(expected);
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true });
      }
    }
  });
});
