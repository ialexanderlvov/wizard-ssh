import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Point HOME (and therefore ~/.wizard-ssh and ~/.ssh) at a fresh temp dir.
 * Combine with `vi.resetModules()` + dynamic `import()` so the path/store/vault
 * singletons re-evaluate against this isolated home. Returns the temp dir.
 */
export function freshHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wssh-test-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  delete process.env.WIZARD_SSH_HOME;
  return dir;
}

/** Strip ANSI colour codes for stable string assertions. */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

export interface PromptQueues {
  text: unknown[];
  choose: unknown[];
  confirm: unknown[];
  secret: unknown[];
  multi: unknown[];
  search: unknown[];
}

/**
 * Scripted stand-in for src/ui/prompts. Crucially it *invokes* each prompt's
 * `validate`/`source` callback (so those closures are exercised + covered),
 * then returns the next queued answer.
 */
export function promptMock(q: PromptQueues) {
  return {
    isInteractive: () => true,
    ensureInteractive: () => {},
    text: async (o?: { validate?: (v: string) => unknown }) => {
      const v = q.text.shift();
      o?.validate?.(String(v ?? ''));
      return v;
    },
    secret: async (o?: { validate?: (v: string) => unknown }) => {
      const v = q.secret.shift();
      o?.validate?.(String(v ?? ''));
      return v;
    },
    choose: async () => q.choose.shift(),
    confirm: async () => q.confirm.shift(),
    multiChoose: async () => q.multi.shift(),
    searchChoose: async (o?: { source?: (t: string | undefined) => unknown }) => {
      await o?.source?.('');
      await o?.source?.(String((q.search[0] as string) ?? ''));
      return q.search.shift();
    },
    pause: async () => {},
  };
}
