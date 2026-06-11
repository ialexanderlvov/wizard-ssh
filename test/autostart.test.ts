// Tests for src/ssh/autostart — systemd unit and launchd plist generation.
import { describe, expect, it } from 'vitest';

const TUNNEL = {
  id: 'abc123',
  name: 'db',
  description: '',
  tags: ['work'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  useCount: 0,
  kind: 'tunnel' as const,
  hostMode: 'manual' as const,
  sshHost: '',
  host: 'db.example.com',
  user: 'root',
  sshPort: 22,
  auth: 'key' as const,
  keyPath: '/tmp/key with space',
  secretId: null,
  type: 'local' as const,
  localPort: 5432,
  remoteHost: '127.0.0.1',
  remotePort: 5432,
  openBrowser: false,
};

describe('autostart unit generation', () => {
  it('systemd unit quotes every ExecStart token and restarts always', async () => {
    const { buildSystemdUnit } = await import('../src/ssh/autostart.js');
    const unit = buildSystemdUnit(TUNNEL, '/usr/bin/ssh');
    expect(unit).toContain('Description=wizard-ssh tunnel db');
    expect(unit).toContain('ExecStart="/usr/bin/ssh" "-N" "-L" "5432:127.0.0.1:5432"');
    // a key path with a space must survive as ONE token
    expect(unit).toContain('"/tmp/key with space"');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('launchd plist XML-escapes args and keeps the job alive', async () => {
    const { buildLaunchdPlist } = await import('../src/ssh/autostart.js');
    const evil = { ...TUNNEL, host: 'a&b<c>.example.com' };
    const plist = buildLaunchdPlist(evil, '/usr/bin/ssh', '/tmp/log');
    expect(plist).toContain('<string>root@a&amp;b&lt;c&gt;.example.com</string>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<string>com.wizard-ssh.tunnel.abc123</string>');
    expect(plist).not.toContain('a&b<c>'); // nothing unescaped leaks into the XML
  });
});
