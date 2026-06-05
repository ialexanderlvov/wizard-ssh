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
      transfer: { ...DEFAULT_SETTINGS.transfer, ...(data.transfer ?? {}) },
    };
    return this.cache;
  }

  get(): Settings {
    const s = this.load();
    return { ...s, vault: { ...s.vault }, transfer: { ...s.transfer } };
  }

  update(patch: Partial<Settings>): Settings {
    const current = this.load();
    const next: Settings = {
      ...current,
      ...patch,
      vault: { ...current.vault, ...(patch.vault ?? {}) },
      transfer: { ...current.transfer, ...(patch.transfer ?? {}) },
    };
    // Persist FIRST, then adopt into the cache — so a failed write doesn't leave
    // the in-memory cache holding state that never reached disk (a session-long
    // desync between what the UI shows and what's stored).
    writeJson(FILES.settings, next);
    this.cache = next;
    return this.get();
  }
}

export const settings = new SettingsStore();
