/** wizard-ssh entry point. Builds the commander program; no args → menu. */

import { Command } from 'commander';
import { APP_BIN, APP_VERSION } from './core/constants.js';
import { DATA_DIR, ensureDataDir } from './core/paths.js';
import { PromptAbortError, WizardError } from './core/errors.js';
import { runMigration } from './store/migrate.js';
import { migrateServersToConfig } from './store/migrate-servers.js';
import { registerCommands } from './commands/index.js';
import { mainMenu } from './commands/menu.js';
import * as ui from './ui/index.js';
import { initI18n, tr } from './i18n/index.js';

async function main(): Promise<void> {
  ensureDataDir();
  // Resolve + load the UI language (env / settings / OS) before anything renders.
  await initI18n();
  const migrated = runMigration();
  const serverMigration = migrateServersToConfig();

  const program = new Command();
  program.enablePositionalOptions(); // lets `run <name> -- <cmd>` pass flags through
  program
    .name(APP_BIN)
    .description(tr.cli.programDescription)
    .version(APP_VERSION, '-v, --version', tr.cli.versionDescription)
    .helpOption('-h, --help', tr.cli.helpDescription)
    .addHelpText('after', tr.cli.helpAfter(DATA_DIR));

  registerCommands(program);

  // No subcommand at all → interactive menu. (We don't register a default
  // `program.action`, so unknown commands still produce a proper error.)
  const serverNote = serverMigration?.count
    ? tr.cli.serversMigrated(serverMigration.count, serverMigration.backup ?? '')
    : '';

  if (process.argv.slice(2).length === 0) {
    ui.printBanner();
    if (migrated) ui.printInfo(tr.cli.importedFromOldVersion(migrated));
    if (serverNote) ui.printInfo(serverNote);
    await mainMenu();
    return;
  }

  // Command mode: report the one-time server migration on stderr so it never
  // pollutes stdout (e.g. `wssh server ls --json`).
  if (serverNote) console.error(serverNote);
  await program.parseAsync(process.argv);
}

main().then(
  () => {
    /* keep any process.exitCode set by a command */
  },
  (err: unknown) => {
    if (err instanceof PromptAbortError) {
      console.log('\n' + tr.errors.cancelled);
      process.exit(130);
    }
    if (err instanceof WizardError) {
      ui.printError(err.message);
      process.exit(err.exitCode);
    }
    // Show only the message by default; the full stack (file paths / internals)
    // is gated behind WSSH_DEBUG so it isn't leaked in normal use.
    const debug = Boolean(process.env.WSSH_DEBUG);
    const detail =
      err instanceof Error ? (debug ? (err.stack ?? err.message) : err.message) : String(err);
    ui.printError(tr.errors.unexpected(detail));
    process.exit(1);
  },
);
