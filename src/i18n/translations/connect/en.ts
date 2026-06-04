import type { Dict } from './ru.js';

const en: Dict = {
  nothingYet: 'Nothing here yet. Add a server or tunnel.',
  ensureQuickConnect: 'Quick connect',
  pickMessage: 'What to connect to',
  notFound: (name) => `"${name}" not found among servers and tunnels.`,
  ensurePickConnect: 'Pick connection',
  multipleMatches: (name) => `Multiple matches for "${name}"`,
  sortRecent: 'recent',
  sortName: 'name',
};

export default en;
