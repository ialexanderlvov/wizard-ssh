// Tests for src/commands/remote-picker — parsing the remote directory listing.
import { describe, expect, it } from 'vitest';

describe('remote picker: parseRemoteListing', () => {
  it('reads pwd then entries, dirs first and stripped of the / suffix', async () => {
    const { parseRemoteListing } = await import('../src/commands/remote-picker.js');
    const res = parseRemoteListing('/home/user\nzeta.txt\napp/\n.config/\nREADME\n');
    expect(res).not.toBeNull();
    expect(res?.dir).toBe('/home/user');
    expect(res?.entries.map((e) => e.name)).toEqual(['.config', 'app', 'README', 'zeta.txt']);
    expect(res?.entries.map((e) => e.isDir)).toEqual([true, true, false, false]);
  });

  it('rejects output whose first line is not an absolute dir (pwd failed)', async () => {
    const { parseRemoteListing } = await import('../src/commands/remote-picker.js');
    expect(parseRemoteListing('sh: cd: no such directory\n')).toBeNull();
    expect(parseRemoteListing('')).toBeNull();
  });
});
