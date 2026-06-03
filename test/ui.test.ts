import { describe, it, expect, vi } from 'vitest';
import type { Server, SshConfigHost, Tunnel } from '../src/core/types.js';
import {
  targetSummary,
  forwardSummary,
  entityLine,
  detailBox,
  configHostLine,
} from '../src/ui/format.js';
import { renderEntityTable, renderConfigHostsTable } from '../src/ui/tables.js';
import {
  printSection,
  printInfo,
  printOk,
  printWarn,
  printError,
  printBanner,
} from '../src/ui/messages.js';
import { isInteractive, ensureInteractive } from '../src/ui/prompts.js';
import { NotInteractiveError } from '../src/core/errors.js';
import { stripAnsi } from './helpers.js';

const server: Server = {
  kind: 'server',
  id: 's1',
  name: 'web-prod',
  description: 'frontend',
  tags: ['prod', 'web'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastUsedAt: null,
  useCount: 3,
  hostMode: 'manual',
  sshHost: '',
  host: '203.0.113.7',
  user: 'deploy',
  sshPort: 2222,
  auth: 'key',
  keyPath: '/keys/id_ed25519',
  secretId: null,
  linkedSshHost: 'web-prod',
};

const tunnel: Tunnel = {
  kind: 'tunnel',
  id: 't1',
  name: 'npm-admin',
  description: '',
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-03T00:00:00.000Z',
  useCount: 0,
  hostMode: 'sshconfig',
  sshHost: 'homelab',
  host: '',
  user: '',
  sshPort: 22,
  auth: 'agent',
  keyPath: null,
  secretId: null,
  type: 'local',
  localPort: 8181,
  remoteHost: '127.0.0.1',
  remotePort: 81,
  openBrowser: true,
};

describe('format', () => {
  it('targetSummary', () => {
    expect(targetSummary(server)).toBe('deploy@203.0.113.7:2222');
    expect(stripAnsi(targetSummary(tunnel))).toBe('@homelab');
  });

  it('forwardSummary by type', () => {
    expect(forwardSummary(tunnel)).toBe('8181→127.0.0.1:81');
    expect(forwardSummary({ ...tunnel, type: 'dynamic', localPort: 1080 })).toBe(':1080 SOCKS');
    expect(
      forwardSummary({
        ...tunnel,
        type: 'remote',
        remotePort: 9000,
        remoteHost: 'localhost',
        localPort: 3000,
      }),
    ).toBe('9000→localhost:3000');
  });

  it('entityLine includes name + target', () => {
    expect(stripAnsi(entityLine(server))).toContain('web-prod');
    expect(stripAnsi(entityLine(server))).toContain('deploy@203.0.113.7');
    expect(stripAnsi(entityLine(tunnel))).toContain('npm-admin');
  });

  it('detailBox renders server fields', () => {
    const box = stripAnsi(detailBox(server));
    expect(box).toContain('web-prod');
    expect(box).toContain('deploy@203.0.113.7');
    expect(box).toContain('id_ed25519');
    expect(box).toContain('3'); // use count
  });

  it('detailBox renders tunnel forward + localhost url', () => {
    const box = stripAnsi(detailBox(tunnel));
    expect(box).toContain('npm-admin');
    expect(box).toContain('homelab');
    expect(box).toContain('http://localhost:8181');
  });

  it('configHostLine', () => {
    const h: SshConfigHost = {
      alias: 'srv',
      hostName: '1.2.3.4',
      user: 'ada',
      port: '22',
      identityFile: '',
      proxyJump: '',
      params: [],
      source: 'cfg',
    };
    expect(stripAnsi(configHostLine(h))).toContain('srv');
    expect(stripAnsi(configHostLine(h))).toContain('ada@1.2.3.4');
  });
});

describe('tables', () => {
  it('renderEntityTable lists names', () => {
    const out = stripAnsi(renderEntityTable([server, tunnel]));
    expect(out).toContain('web-prod');
    expect(out).toContain('npm-admin');
  });
  it('renderConfigHostsTable lists alias', () => {
    const out = stripAnsi(
      renderConfigHostsTable([
        {
          alias: 'h1',
          hostName: '1.1.1.1',
          user: 'u',
          port: '',
          identityFile: '',
          proxyJump: '',
          params: [],
          source: '',
        },
      ]),
    );
    expect(out).toContain('h1');
    expect(out).toContain('1.1.1.1');
  });
});

describe('messages', () => {
  it('helpers write to stdout and include their payload', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    try {
      printSection('🚀', 'My Section');
      printInfo('an info');
      printOk('all good');
      printWarn('careful');
      printError('boom');
      printBanner();
    } finally {
      spy.mockRestore();
    }
    const out = stripAnsi(logs.join('\n'));
    expect(out).toContain('My Section');
    expect(out).toContain('an info');
    expect(out).toContain('all good');
    expect(out).toContain('careful');
    expect(out).toContain('boom');
  });
});

describe('prompts guard', () => {
  it('isInteractive is false in the test runner', () => {
    expect(isInteractive()).toBe(false);
  });
  it('ensureInteractive throws NotInteractiveError', () => {
    expect(() => ensureInteractive('Действие')).toThrow(NotInteractiveError);
  });
});
