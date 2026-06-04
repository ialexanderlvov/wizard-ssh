import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('listKnownHosts', () => {
  it('parses host tokens + key types, skips comments and hashed entries', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    fs.writeFileSync(
      path.join(ssh, 'known_hosts'),
      [
        '# a comment',
        '1.2.3.4 ssh-ed25519 AAAAC3Nz',
        '[example.com]:2222 ecdsa-sha2-nistp256 AAAAE2Vj',
        'host1,host2 ssh-rsa AAAAB3Nz',
        '|1|aGFzaGVk|aGFzaA== ssh-ed25519 AAAAC3Nz', // hashed → skipped
        '@cert-authority *.corp ssh-ed25519 AAAAC3Nz',
      ].join('\n'),
    );

    const { listKnownHosts } = await import('../src/ssh/hostkey.js');
    const list = listKnownHosts();
    const hosts = list.map((e) => e.host);

    expect(hosts).toContain('1.2.3.4');
    expect(hosts).toContain('[example.com]:2222');
    expect(hosts).toContain('host1');
    expect(hosts).toContain('host2');
    expect(hosts).toContain('*.corp');
    expect(hosts.some((h) => h.startsWith('|1|'))).toBe(false); // hashed skipped
    expect(list.find((e) => e.host === '1.2.3.4')?.keyTypes).toEqual(['ssh-ed25519']);
    expect(list.find((e) => e.host === '[example.com]:2222')?.keyTypes).toEqual([
      'ecdsa-sha2-nistp256',
    ]);
  });

  it('returns [] when known_hosts is absent', async () => {
    const { listKnownHosts } = await import('../src/ssh/hostkey.js');
    expect(listKnownHosts()).toEqual([]);
  });
});
