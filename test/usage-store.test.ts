import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('usage store', () => {
  it('defaults, touch, set, remove, rename', async () => {
    const { usage } = await import('../src/store/usage.store.js');
    expect(usage.get('a')).toEqual({ lastUsedAt: null, useCount: 0 });

    usage.touch('a');
    const e = usage.get('a');
    expect(e.useCount).toBe(1);
    expect(typeof e.lastUsedAt).toBe('string');
    usage.touch('a');
    expect(usage.get('a').useCount).toBe(2);

    usage.set('b', { useCount: 7, lastUsedAt: '2026-01-01T00:00:00.000Z' });
    expect(usage.get('b').useCount).toBe(7);

    usage.rename('b', 'c');
    expect(usage.get('b')).toEqual({ lastUsedAt: null, useCount: 0 });
    expect(usage.get('c').useCount).toBe(7);
    usage.rename('missing', 'x'); // no-op, no throw
    usage.rename('c', 'c'); // same alias → no-op

    usage.remove('c');
    expect(usage.get('c').useCount).toBe(0);
    usage.remove('nope'); // no-op
  });

  it('persists across a reload', async () => {
    const m1 = await import('../src/store/usage.store.js');
    m1.usage.set('srv', { useCount: 3, lastUsedAt: '2026-02-02T00:00:00.000Z' });
    vi.resetModules();
    const m2 = await import('../src/store/usage.store.js');
    expect(m2.usage.get('srv').useCount).toBe(3);
  });
});
