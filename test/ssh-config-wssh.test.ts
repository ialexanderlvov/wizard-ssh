import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

const configPath = (): string => path.join(os.homedir(), '.ssh', 'config');
const writeConfig = (c: string): void => {
  fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true });
  fs.writeFileSync(configPath(), c);
};
const readConfig = (): string => fs.readFileSync(configPath(), 'utf8');

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('#wssh serialize/parse helpers', () => {
  it('round-trips metadata and drops empty/default fields', async () => {
    const { serializeWssh, parseWsshComment, isEmptyMeta } =
      await import('../src/ssh-config/wssh.js');
    expect(serializeWssh(null)).toBeNull();
    expect(serializeWssh({})).toBeNull();
    expect(isEmptyMeta({ tags: [] })).toBe(true);

    const line = serializeWssh({
      desc: 'web box',
      tags: ['prod', 'eu'],
      auth: 'password',
      secretId: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(line).toMatch(/^#wssh \{/);
    const back = parseWsshComment(line!);
    expect(back).toEqual({
      desc: 'web box',
      tags: ['prod', 'eu'],
      auth: 'password',
      secretId: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('ignores non-wssh comments and malformed json', async () => {
    const { parseWsshComment } = await import('../src/ssh-config/wssh.js');
    expect(parseWsshComment('# just a note')).toBeNull();
    expect(parseWsshComment('#wsshX {}')).toBeNull();
    expect(parseWsshComment('#wssh not-json')).toBeNull();
    expect(parseWsshComment('#wssh {bad')).toBeNull();
    expect(parseWsshComment('#wssh {}')).toEqual({});
  });
});

describe('parser attaches #wssh + manageability', () => {
  it('reads a #wssh annotation above a single-alias host', async () => {
    writeConfig(
      '#wssh {"desc":"my web","tags":["prod"],"secretId":"s1"}\n' +
        'Host web\n    HostName 1.2.3.4\n    User root\n',
    );
    const { listHosts, getHost } = await import('../src/ssh-config/index.js');
    const web = getHost('web');
    expect(web?.wssh).toEqual({ desc: 'my web', tags: ['prod'], secretId: 's1' });
    expect(web?.manageable).toBe(true);
    expect(web?.hostName).toBe('1.2.3.4');
    expect(listHosts()).toHaveLength(1);
  });

  it('un-annotated host has null meta but is still manageable; multi-alias is not', async () => {
    writeConfig('Host plain\n    HostName 9.9.9.9\nHost a b\n    HostName 8.8.8.8\n');
    const { getHost } = await import('../src/ssh-config/index.js');
    expect(getHost('plain')?.wssh).toBeNull();
    expect(getHost('plain')?.manageable).toBe(true);
    expect(getHost('a')?.manageable).toBe(false); // multi-alias block
    expect(getHost('b')?.manageable).toBe(false);
  });
});

describe('writer round-trips #wssh', () => {
  it('writes the annotation above a freshly created Host', async () => {
    const { upsertHost, getHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'box',
      params: [
        { key: 'HostName', value: '1.1.1.1' },
        { key: 'User', value: 'root' },
      ],
      wssh: { desc: 'hello', tags: ['x'], createdAt: '2026-02-02T00:00:00.000Z' },
    });
    const text = readConfig();
    expect(text).toContain('#wssh ');
    expect(text.indexOf('#wssh')).toBeLessThan(text.indexOf('Host box'));
    expect(getHost('box')?.wssh).toEqual({
      desc: 'hello',
      tags: ['x'],
      createdAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('updates an annotation in place without duplicating it', async () => {
    const { upsertHost, getHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'box',
      params: [{ key: 'HostName', value: '1.1.1.1' }],
      wssh: { desc: 'one' },
    });
    upsertHost({
      alias: 'box',
      params: [{ key: 'HostName', value: '2.2.2.2' }],
      wssh: { desc: 'two' },
    });
    const text = readConfig();
    expect(text.match(/#wssh /g)?.length).toBe(1); // not duplicated
    expect(getHost('box')?.wssh?.desc).toBe('two');
    expect(getHost('box')?.hostName).toBe('2.2.2.2');
  });

  it('clearing the meta removes the #wssh line on update', async () => {
    const { upsertHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'box',
      params: [{ key: 'HostName', value: '1.1.1.1' }],
      wssh: { desc: 'one' },
    });
    upsertHost({ alias: 'box', params: [{ key: 'HostName', value: '1.1.1.1' }], wssh: null });
    expect(readConfig()).not.toContain('#wssh');
  });

  it('removeHost also deletes the leading #wssh annotation', async () => {
    const { upsertHost, removeHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'a',
      params: [{ key: 'HostName', value: '1.1.1.1' }],
      wssh: { desc: 'one' },
    });
    upsertHost({ alias: 'b', params: [{ key: 'HostName', value: '2.2.2.2' }] });
    removeHost('a');
    const text = readConfig();
    expect(text).not.toContain('#wssh');
    expect(text).not.toContain('Host a');
    expect(text).toContain('Host b');
  });

  it('keeps #wssh on the SECOND and later hosts (multi-block round-trip)', async () => {
    const { upsertHost, getHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'alpha',
      params: [{ key: 'HostName', value: '1.1.1.1' }],
      wssh: { desc: 'A' },
    });
    upsertHost({
      alias: 'beta',
      params: [{ key: 'HostName', value: '2.2.2.2' }],
      wssh: { desc: 'B', tags: ['x'] },
    });
    upsertHost({
      alias: 'gamma',
      params: [{ key: 'HostName', value: '3.3.3.3' }],
      wssh: { auth: 'password', secretId: 's3' },
    });
    expect(getHost('alpha')?.wssh?.desc).toBe('A');
    expect(getHost('beta')?.wssh).toEqual({ desc: 'B', tags: ['x'] });
    expect(getHost('gamma')?.wssh).toEqual({ auth: 'password', secretId: 's3' });
    expect(readConfig().match(/#wssh /g)?.length).toBe(3); // exactly one per host
  });

  it('preserves a hand-written user comment that is not #wssh', async () => {
    writeConfig('# my own note\nHost keep\n    HostName 3.3.3.3\n');
    const { upsertHost } = await import('../src/ssh-config/index.js');
    upsertHost({
      alias: 'keep',
      params: [{ key: 'HostName', value: '3.3.3.3' }],
      wssh: { desc: 'd' },
    });
    const text = readConfig();
    expect(text).toContain('# my own note'); // untouched
    expect(text).toContain('#wssh ');
  });
});
