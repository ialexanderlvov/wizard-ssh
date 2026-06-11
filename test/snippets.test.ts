// Tests for store/snippets.store.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshHome } from './helpers.js';

describe('snippets store', () => {
  beforeEach(() => {
    vi.resetModules();
    freshHome();
  });

  it('add / find / forServer / remove round-trip', async () => {
    const { snippets } = await import('../src/store/snippets.store.js');
    const global = snippets.add({ name: 'uptime', command: 'uptime', server: null });
    snippets.add({ name: 'deploy', command: 'git pull', server: 'prod' });

    expect(snippets.all()).toHaveLength(2);
    expect(snippets.nameExists('UPTIME')).toBe(true); // case-insensitive
    expect(snippets.findByName('deploy')?.server).toBe('prod');

    // per-server view: own + global, never another server's
    expect(snippets.forServer('prod').map((s) => s.name)).toEqual(['uptime', 'deploy']);
    expect(snippets.forServer('staging').map((s) => s.name)).toEqual(['uptime']);

    snippets.remove(global.id);
    expect(snippets.all().map((s) => s.name)).toEqual(['deploy']);
  });

  it('drops malformed records on load instead of crashing', async () => {
    const fs = await import('node:fs');
    const { FILES, ensureDataDir } = await import('../src/core/paths.js');
    ensureDataDir();
    fs.writeFileSync(
      FILES.snippets,
      JSON.stringify({
        version: 1,
        snippets: [
          { id: '1', name: 'ok', command: 'ls', server: null },
          { id: '2', name: '', command: 'broken', server: null }, // empty name
          { nope: true }, // wrong shape
        ],
      }),
    );
    const { snippets } = await import('../src/store/snippets.store.js');
    expect(snippets.all().map((s) => s.name)).toEqual(['ok']);
  });
});
