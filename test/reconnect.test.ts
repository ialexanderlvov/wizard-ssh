import { describe, it, expect } from 'vitest';
import { decideReconnect, tunnelBackoffMs } from '../src/ssh/runner.js';
import { buildConnectArgs } from '../src/ssh/args.js';
import { buildKeygenArgs } from '../src/ssh/keys.js';
import type { ConnectionTarget } from '../src/core/types.js';

const manual = (o: Partial<ConnectionTarget> = {}): ConnectionTarget => ({
  hostMode: 'manual',
  sshHost: '',
  host: '10.0.0.1',
  user: 'root',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  ...o,
});

describe('decideReconnect', () => {
  it('never reconnects on user interrupt (130) or clean exit (0)', () => {
    expect(decideReconnect(130, 100000, 0).reconnect).toBe(false);
    expect(decideReconnect(130, 100000, 0).reason).toBe('interrupted');
    expect(decideReconnect(0, 100000, 0).reconnect).toBe(false);
    expect(decideReconnect(0, 100000, 0).reason).toBe('clean-exit');
  });

  it('reconnects (and resets backoff) after a long-lived drop', () => {
    const d = decideReconnect(255, 60_000, 3);
    expect(d.reconnect).toBe(true);
    expect(d.reason).toBe('dropped');
    expect(d.nextAttempt).toBe(1);
    expect(d.delayMs).toBe(1000);
  });

  it('retries fast failures with backoff, then gives up after the cap', () => {
    expect(decideReconnect(255, 500, 0)).toMatchObject({ reconnect: true, nextAttempt: 1 });
    expect(decideReconnect(255, 500, 4)).toMatchObject({ reconnect: true, nextAttempt: 5 });
    const giveUp = decideReconnect(255, 500, 5);
    expect(giveUp.reconnect).toBe(false);
    expect(giveUp.reason).toBe('gave-up');
  });
});

describe('tunnelBackoffMs', () => {
  it('doubles and caps at 30s', () => {
    expect(tunnelBackoffMs(1)).toBe(1000);
    expect(tunnelBackoffMs(2)).toBe(2000);
    expect(tunnelBackoffMs(3)).toBe(4000);
    expect(tunnelBackoffMs(10)).toBe(30_000);
  });
});

describe('buildConnectArgs tmux', () => {
  it('plain connect ends at the destination', () => {
    const a = buildConnectArgs(manual({ user: 'deploy', host: 'h' }));
    expect(a[a.length - 1]).toBe('deploy@h');
    expect(a).not.toContain('tmux');
  });

  it('--tmux requests a tty and attaches/creates a named session', () => {
    const a = buildConnectArgs(manual({ user: 'deploy', host: 'h' }), { tmux: true });
    expect(a).toContain('-t');
    expect(a.slice(-6)).toEqual(['deploy@h', 'tmux', 'new-session', '-A', '-s', 'wssh']);
  });

  it('--tmux <name> uses the given session name', () => {
    const a = buildConnectArgs(manual(), { tmux: 'dev' });
    expect(a.join(' ')).toContain('tmux new-session -A -s dev');
  });
});

describe('buildKeygenArgs', () => {
  it('defaults to ed25519, passphraseless (-N "")', () => {
    const a = buildKeygenArgs({ path: '/tmp/k', comment: 'c' });
    expect(a.slice(0, 2)).toEqual(['-t', 'ed25519']);
    expect(a).toContain('-f');
    expect(a).toContain('/tmp/k');
    expect(a.join(' ')).toContain('-C c');
    expect(a).toContain('-N');
    expect(a[a.indexOf('-N') + 1]).toBe('');
  });

  it('rsa adds -b 4096; withPassphrase omits -N', () => {
    expect(buildKeygenArgs({ path: '/tmp/k', type: 'rsa' }).join(' ')).toContain('-b 4096');
    expect(buildKeygenArgs({ path: '/tmp/k', withPassphrase: true })).not.toContain('-N');
  });

  it('security-key types pass -t <type>-sk without -b', () => {
    const a = buildKeygenArgs({ path: '/tmp/k', type: 'ed25519-sk' });
    expect(a.slice(0, 2)).toEqual(['-t', 'ed25519-sk']);
    expect(a).not.toContain('-b');
    expect(a).toContain('-N');
    expect(buildKeygenArgs({ path: '/tmp/k', type: 'ecdsa-sk' }).slice(0, 2)).toEqual([
      '-t',
      'ecdsa-sk',
    ]);
  });
});
