// Tests for src/ssh/agent — parsing ssh-add -l output into identities.
import { describe, expect, it } from 'vitest';

describe('ssh-agent: parseAgentList', () => {
  it('parses ssh-add -l lines into identities', async () => {
    const { parseAgentList } = await import('../src/ssh/agent.js');
    const out = parseAgentList(
      '256 SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8 user@host (ED25519)\n' +
        '4096 SHA256:8sMd9Rhc7bztspbqLD40aaaab7YPMXRolIdLnASxqWg work key (RSA)\n',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ bits: 256, type: 'ED25519', comment: 'user@host' });
    expect(out[1]).toMatchObject({ bits: 4096, type: 'RSA', comment: 'work key' });
    expect(out[1]?.fingerprint).toMatch(/^SHA256:/);
  });

  it('returns [] for noise / empty output', async () => {
    const { parseAgentList } = await import('../src/ssh/agent.js');
    expect(parseAgentList('')).toEqual([]);
    expect(parseAgentList('The agent has no identities.\n')).toEqual([]);
  });
});
