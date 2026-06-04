/** Shared words reused across the whole UI (the `ru` module is the source of
 *  truth: its shape defines `Dict`, which every other locale must satisfy). */

const ru = {
  cancelled: 'Отменено.',
  error: (message: string) => `Ошибка: ${message}`,
  listEmpty: 'Список пуст.',
  notEmpty: 'Не может быть пустым',
  empty: 'Пусто',
  back: '← Назад',
  nothingHere: 'ничего нет',
  yes: 'да',
  no: 'нет',
  present: 'есть',
  absent: 'нет',
  server: 'сервер',
  tunnel: 'туннель',
  dash: '—',
  time: {
    never: 'никогда',
    justNow: 'только что',
    minutesAgo: (n: number) => `${n} мин назад`,
    hoursAgo: (n: number) => `${n} ч назад`,
    daysAgo: (n: number) => `${n} дн назад`,
    weeksAgo: (n: number) => `${n} нед назад`,
    monthsAgo: (n: number) => `${n} мес назад`,
  },
};

export default ru;
export type Dict = typeof ru;
