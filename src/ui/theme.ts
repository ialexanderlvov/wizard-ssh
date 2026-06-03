/** Colours & gradients — the visual identity, in one place. */

import chalk from 'chalk';
import gradient from 'gradient-string';

export { chalk };

export const brand = gradient(['#00d2ff', '#3a7bd5', '#a445b2']);
export const accent = gradient(['#11998e', '#38ef7d']);
export const danger = gradient(['#ff416c', '#ff4b2b']);
export const warn = gradient(['#f7971e', '#ffd200']);

/** Coloured badge per forward type. */
export const TYPE_BADGE: Record<string, string> = {
  local: chalk.green('-L'),
  remote: chalk.yellow('-R'),
  dynamic: chalk.blue('-D'),
};
