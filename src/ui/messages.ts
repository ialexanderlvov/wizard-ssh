/** Banner, section headers, and one-line status messages. */

import boxen from 'boxen';
import figlet from 'figlet';
import { chalk, brand, accent, danger, warn } from './theme.js';

export function printBanner(): void {
  let art: string;
  try {
    art = figlet.textSync('wizard ssh', { font: 'ANSI Shadow' });
  } catch {
    art = 'WIZARD SSH';
  }
  console.log('\n' + brand.multiline(art));
  console.log(
    boxen(
      chalk.bold('Wizard SSH') +
        '\n' +
        chalk.dim('Серверы · туннели · ~/.ssh/config — CRUD, поиск и мгновенное подключение.'),
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 0, bottom: 1, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
        float: 'left',
      },
    ),
  );
}

export function printSection(emoji: string, title: string): void {
  const line = '─'.repeat(Math.max(2, 50 - title.length - 3));
  console.log('\n' + chalk.cyan(`${emoji}  ${chalk.bold(title)} ${chalk.dim(line)}`) + '\n');
}

export const printInfo = (m: string): void => console.log(chalk.cyan('ℹ '), m);
export const printOk = (m: string): void => console.log(accent('✔ '), chalk.green(m));
export const printWarn = (m: string): void => console.log(warn('⚠ '), chalk.yellow(m));
export const printError = (m: string): void => console.log(danger('✖ '), chalk.red(m));
