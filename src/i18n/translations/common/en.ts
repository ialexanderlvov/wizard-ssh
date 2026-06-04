import type { Dict } from './ru.js';

const en: Dict = {
  cancelled: 'Cancelled.',
  error: (message) => `Error: ${message}`,
  listEmpty: 'The list is empty.',
  notEmpty: 'Cannot be empty',
  empty: 'Empty',
  back: '← Back',
  nothingHere: 'nothing here',
  yes: 'yes',
  no: 'no',
  present: 'yes',
  absent: 'no',
  server: 'server',
  tunnel: 'tunnel',
  dash: '—',
  time: {
    never: 'never',
    justNow: 'just now',
    minutesAgo: (n) => `${n}m ago`,
    hoursAgo: (n) => `${n}h ago`,
    daysAgo: (n) => `${n}d ago`,
    weeksAgo: (n) => `${n}w ago`,
    monthsAgo: (n) => `${n}mo ago`,
  },
};

export default en;
