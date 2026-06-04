const ru = {
  nothingYet: 'Пока ничего нет. Добавьте сервер или туннель.',
  ensureQuickConnect: 'Быстрое подключение',
  pickMessage: 'К чему подключаемся',
  notFound: (name: string) => `«${name}» не найдено среди серверов и туннелей.`,
  ensurePickConnect: 'Выбор подключения',
  multipleMatches: (name: string) => `Несколько совпадений по «${name}»`,
  sortRecent: 'недавние',
  sortName: 'имя',
};

export default ru;
export type Dict = typeof ru;
