import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshHome } from './helpers.js';

beforeEach(() => {
  vi.resetModules();
  freshHome();
});

describe('doctor', () => {
  it('collects checks including ssh and returns 0/2', async () => {
    const { collectChecks, doctor } = await import('../src/commands/doctor.js');
    const checks = collectChecks();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.find((c) => c.label === 'ssh')).toBeTruthy();
    expect(checks.every((c) => ['ok', 'warn', 'fail'].includes(c.status))).toBe(true);
    const code = doctor({ json: true });
    expect([0, 2]).toContain(code);
  });
});

describe('info', () => {
  it('runs and reports inventory counts without unlocking the vault', async () => {
    const { info } = await import('../src/commands/info.js');
    expect(() => info({ json: true })).not.toThrow();
    expect(() => info()).not.toThrow();
  });
});
