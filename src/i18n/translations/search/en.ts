import type { Dict } from './ru.js';

const en: Dict = {
  jsonNeedsQuery: 'For --json, provide a query: wssh search <query> --json',
  ensureLabel: 'Search',
  prompt: 'Search servers and tunnels',
  notFound: (q) => `Nothing found for "${q}".`,
  serversSection: (n) => `Servers (${n})`,
  tunnelsSection: (n) => `Tunnels (${n})`,
  connectPrompt: 'Connect (Esc — just browse)',
};

export default en;
