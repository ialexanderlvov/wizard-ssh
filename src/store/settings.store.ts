import fs from 'node:fs';
import type { Settings } from '../core/types.js';
import { DEFAULT_SETTINGS } from '../core/constants.js';
import { FILES } from '../core/paths.js';
import { readJson, writeJson } from './json-file.js';

class SettingsStore {
  private cache: Settings | null = null;
  /** signature (mtime+size) of the file when last read — re-read when another
   *  `wssh` process changed a setting, so a long-lived menu doesn't write back a
   *  stale snapshot over the newer value. */
  private sig = '';

  private fileSig(): string {
    try {
      const st = fs.statSync(FILES.settings);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  }

  private load(): Settings {
    const s = this.fileSig();
    if (this.cache && s === this.sig) return this.cache;
    const { data } = readJson<Partial<Settings>>(FILES.settings, {});
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...data,
      vault: { ...DEFAULT_SETTINGS.vault, ...(data.vault ?? {}) },
      transfer: { ...DEFAULT_SETTINGS.transfer, ...(data.transfer ?? {}) },
    };
    this.sig = s;
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
    this.sig = this.fileSig();
    return this.get();
  }
}

export const settings = new SettingsStore();
