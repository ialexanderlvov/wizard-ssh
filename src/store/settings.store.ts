import type { Settings } from '../core/types.js';
import { DEFAULT_SETTINGS } from '../core/constants.js';
import { FILES } from '../core/paths.js';
import { readJson, writeJson } from './json-file.js';

class SettingsStore {
  private cache: Settings | null = null;

  private load(): Settings {
    if (this.cache) return this.cache;
    const { data } = readJson<Partial<Settings>>(FILES.settings, {});
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...data,
      vault: { ...DEFAULT_SETTINGS.vault, ...(data.vault ?? {}) },
    };
    return this.cache;
  }

  get(): Settings {
    return { ...this.load(), vault: { ...this.load().vault } };
  }

  update(patch: Partial<Settings>): Settings {
    const current = this.load();
    this.cache = {
      ...current,
      ...patch,
      vault: { ...current.vault, ...(patch.vault ?? {}) },
    };
    writeJson(FILES.settings, this.cache);
    return this.get();
  }
}

export const settings = new SettingsStore();
