/** Process-wide UI runtime flags, set once from global CLI options (a preAction
 *  hook in commands/index.ts) and read by the prompt wrappers. Keeps the prompt
 *  layer scriptable without threading flags through every call. */

interface Runtime {
  /** `--yes`/`-y`: auto-confirm every yes/no prompt (assume "yes"). */
  assumeYes: boolean;
  /** `--non-interactive`: never open a prompt; fail fast instead. */
  nonInteractive: boolean;
}

export const runtime: Runtime = {
  assumeYes: false,
  nonInteractive: false,
};

export function setRuntime(patch: Partial<Runtime>): void {
  Object.assign(runtime, patch);
}
