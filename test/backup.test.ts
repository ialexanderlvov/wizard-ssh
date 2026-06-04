import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { freshHome } from './helpers.js';

describe('backup ~/.ssh', () => {
  let home: string;
  beforeEach(() => {
    vi.resetModules();
    home = freshHome(); // sets HOME → SSH_DIR/backups resolve under a temp dir
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('archives the whole ~/.ssh — private keys included — into a 0600 tar.gz', async () => {
    const ssh = path.join(home, '.ssh');
    fs.mkdirSync(ssh, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(ssh, 'config'), 'Host x\n  HostName 1.1.1.1\n');
    fs.writeFileSync(path.join(ssh, 'id_ed25519'), 'PRIVATE-KEY', { mode: 0o600 });
    fs.writeFileSync(path.join(ssh, 'known_hosts'), '1.1.1.1 ssh-ed25519 AAAA\n');

    const { backupSshDir } = await import('../src/commands/backup.js');
    const res = backupSshDir();

    expect(res).not.toBeNull();
    expect(fs.existsSync(res!.path)).toBe(true);
    expect(res!.path).toMatch(/[/\\]\.wizard-ssh[/\\]backups[/\\]ssh-.*\.tar\.gz$/);
    expect(fs.statSync(res!.path).mode & 0o777).toBe(0o600); // owner-only (holds keys)

    const list = execFileSync('tar', ['-tzf', res!.path], { encoding: 'utf8' });
    expect(list).toContain('.ssh/config');
    expect(list).toContain('.ssh/id_ed25519'); // private key archived
    expect(list).toContain('.ssh/known_hosts');
  });

  it('honors a custom destination directory', async () => {
    const ssh = path.join(home, '.ssh');
    fs.mkdirSync(ssh, { recursive: true });
    fs.writeFileSync(path.join(ssh, 'config'), 'Host y\n');
    const dest = path.join(home, 'mybackups');

    const { backupSshDir } = await import('../src/commands/backup.js');
    const res = backupSshDir(dest);
    expect(res).not.toBeNull();
    expect(path.dirname(res!.path)).toBe(dest);
  });

  it('returns null (no crash) when ~/.ssh does not exist', async () => {
    const { backupSshDir } = await import('../src/commands/backup.js');
    expect(backupSshDir()).toBeNull(); // home has no .ssh
  });
});
