/** wizard-ssh entry point. Builds the commander program; no args → menu. */

import { Command } from 'commander';
import { APP_BIN, APP_VERSION } from './core/constants.js';
import { DATA_DIR, ensureDataDir } from './core/paths.js';
import { PromptAbortError, WizardError } from './core/errors.js';
import { runMigration } from './store/migrate.js';
import { registerCommands } from './commands/index.js';
import { mainMenu } from './commands/menu.js';
import * as ui from './ui/index.js';

async function main(): Promise<void> {
  ensureDataDir();
  const migrated = runMigration();

  const program = new Command();
  program.enablePositionalOptions(); // lets `run <name> -- <cmd>` pass flags through
  program
    .name(APP_BIN)
    .description(
      'Wizard SSH — серверы, туннели и ~/.ssh/config: CRUD, поиск, мгновенное подключение.',
    )
    .version(APP_VERSION, '-v, --version', 'показать версию')
    .helpOption('-h, --help', 'показать помощь')
    .addHelpText('after', `\nБез аргументов — интерактивное меню.\nДанные: ${DATA_DIR}`);

  registerCommands(program);

  // No subcommand at all → interactive menu. (We don't register a default
  // `program.action`, so unknown commands still produce a proper error.)
  if (process.argv.slice(2).length === 0) {
    ui.printBanner();
    if (migrated) ui.printInfo(`Импортировано из прежней версии: туннелей — ${migrated}.`);
    await mainMenu();
    return;
  }

  await program.parseAsync(process.argv);
}

main().then(
  () => {
    /* keep any process.exitCode set by a command */
  },
  (err: unknown) => {
    if (err instanceof PromptAbortError) {
      console.log('\nОтменено.');
      process.exit(130);
    }
    if (err instanceof WizardError) {
      ui.printError(err.message);
      process.exit(err.exitCode);
    }
    ui.printError(
      `Неожиданная ошибка: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(1);
  },
);
