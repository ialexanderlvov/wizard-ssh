import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshHome } from './helpers.js';
import { findSshKeys } from '../src/ssh/keys.js';

describe('findSshKeys', () => {
  beforeEach(() => freshHome());

  it('finds private keys, skips pub/known_hosts/config/non-keys', () => {
    const ssh = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(path.join(ssh, 'sub'), { recursive: true });
    const priv = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n';
    fs.writeFileSync(path.join(ssh, 'id_rsa'), priv);
    fs.writeFileSync(path.join(ssh, 'id_rsa.pub'), 'ssh-rsa AAAA');
    fs.writeFileSync(path.join(ssh, 'known_hosts'), 'h ssh-rsa AAAA');
    fs.writeFileSync(path.join(ssh, 'config'), 'Host x');
    fs.writeFileSync(path.join(ssh, 'notes.txt'), 'just text');
    fs.writeFileSync(path.join(ssh, 'sub', 'id_sub'), priv);

    const keys = findSshKeys().map((k) => path.basename(k));
    expect(keys).toContain('id_rsa');
    expect(keys).toContain('id_sub'); // one level deep
    expect(keys).not.toContain('id_rsa.pub');
    expect(keys).not.toContain('known_hosts');
    expect(keys).not.toContain('config');
    expect(keys).not.toContain('notes.txt');
  });

  it('returns [] when ~/.ssh is absent', () => {
    expect(findSshKeys()).toEqual([]);
  });
});
