/** Backup / restore all lists (servers, tunnels, settings, encrypted vault). */

import fs from 'node:fs';
import path from 'node:path';
import type { Server, Settings, Tunnel } from '../core/types.js';
import { DATA_DIR, FILES } from '../core/paths.js';
import { readJson, writeJson } from '../store/json-file.js';
import { servers } from '../store/servers.store.js';
import { tunnels } from '../store/tunnels.store.js';
import { settings } from '../store/settings.store.js';
import * as ui from '../ui/index.js';

interface Bundle {
  app: 'wizard-ssh';
  version: 1;
  exportedAt: string;
  servers: Server[];
  tunnels: Tunnel[];
  settings: Settings;
  /** encrypted vault.json contents (safe — passwords stay encrypted) */
  vault?: unknown;
}

export function exportData(file?: string): string {
  const target = file
    ? path.resolve(file)
    : path.join(DATA_DIR, `wizard-ssh-export-${Date.now()}.json`);
  const bundle: Bundle = {
    app: 'wizard-ssh',
    version: 1,
    exportedAt: new Date().toISOString(),
    servers: servers.all(),
    tunnels: tunnels.all(),
    settings: settings.get(),
  };
  if (fs.existsSync(FILES.vault)) {
    bundle.vault = readJson<unknown>(FILES.vault, null).data;
  }
  writeJson(target, bundle);
  ui.printOk(`Экспортировано в ${target}`);
  ui.printInfo(
    `Серверов: ${bundle.servers.length} · туннелей: ${bundle.tunnels.length}${bundle.vault ? ' · хранилище включено (зашифровано)' : ''}`,
  );
  return target;
}

export async function importData(file: string, opts: { replace?: boolean } = {}): Promise<void> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    ui.printError(`Файл не найден: ${abs}`);
    process.exitCode = 1;
    return;
  }
  const { data } = readJson<Partial<Bundle>>(abs, {});
  if (data.app !== 'wizard-ssh' || !Array.isArray(data.servers)) {
    ui.printError('Это не файл экспорта wizard-ssh.');
    process.exitCode = 1;
    return;
  }

  let replace = opts.replace ?? false;
  if (!opts.replace && ui.isInteractive()) {
    replace = await ui.choose<boolean>({
      message: 'Как импортировать?',
      choices: [
        { name: '➕ Добавить к существующим (безопасно)', value: false },
        { name: '♻️ Заменить все списки', value: true },
      ],
    });
  }

  const importedServers = data.servers ?? [];
  const importedTunnels = data.tunnels ?? [];

  if (replace) {
    servers.replaceAll(importedServers);
    tunnels.replaceAll(importedTunnels);
  } else {
    for (const s of importedServers) {
      let name = s.name;
      let i = 2;
      while (servers.nameExists(name)) name = `${s.name}-${i++}`;
      servers.create({ ...s, name });
    }
    for (const t of importedTunnels) {
      let name = t.name;
      let i = 2;
      while (tunnels.nameExists(name)) name = `${t.name}-${i++}`;
      tunnels.create({ ...t, name });
    }
  }

  if (data.settings) settings.update(data.settings);

  // Restore the encrypted vault only when there is none locally (never clobber).
  if (data.vault && !fs.existsSync(FILES.vault)) {
    writeJson(FILES.vault, data.vault);
    ui.printInfo('Хранилище паролей восстановлено (нужна та же парольная фраза).');
  } else if (data.vault) {
    ui.printWarn(
      'Локальное хранилище уже есть — оно не перезаписано. Перенесите vault.json вручную при необходимости.',
    );
  }

  ui.printOk(
    `Импорт завершён (${replace ? 'замена' : 'добавление'}): серверов +${importedServers.length}, туннелей +${importedTunnels.length}.`,
  );
}

export async function importExportMenu(): Promise<void> {
  ui.ensureInteractive('Экспорт/импорт');
  const action = await ui.choose<string>({
    message: '📦 Экспорт / импорт',
    choices: [
      { name: '📤 Экспортировать всё в файл', value: 'export' },
      { name: '📥 Импортировать из файла', value: 'import' },
      { name: '↩ Назад', value: 'back' },
    ],
  });
  if (action === 'back') return;
  if (action === 'export') {
    const file = await ui.text({ message: 'Путь файла (Enter — по умолчанию)', default: '' });
    exportData(file.trim() || undefined);
  } else {
    const file = await ui.text({
      message: 'Путь к файлу экспорта',
      validate: (v) => v.trim().length > 0 || 'Укажите путь',
    });
    await importData(file.trim());
  }
}
