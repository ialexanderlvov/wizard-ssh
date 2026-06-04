import type { Dict } from './ru.js';

const en: Dict = {
  notInteractiveSubject: 'This operation',
  notInteractive: (what) =>
    `${what} requires an interactive terminal. Use command flags or run it in a TTY.`,
  cancelled: 'Cancelled.',
  vaultLocked: 'Password vault is locked.',
  unexpected: (detail) => `Unexpected error: ${detail}`,
};

export default en;
