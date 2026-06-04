const ru = {
  jsonNeedsQuery: 'Для --json укажите запрос: wssh search <query> --json',
  ensureLabel: 'Поиск',
  prompt: 'Поиск по серверам и туннелям',
  notFound: (q: string) => `Ничего не найдено по «${q}».`,
  serversSection: (n: number) => `Серверы (${n})`,
  tunnelsSection: (n: number) => `Туннели (${n})`,
  connectPrompt: 'Подключиться (Esc — просто посмотреть)',
};

export default ru;
export type Dict = typeof ru;
