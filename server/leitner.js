// Система Лейтнера: 5 коробок, интервалы повторения в днях.
export const INTERVALS = [1, 2, 4, 8, 16];
export const MAX_BOX = INTERVALS.length;

const pad = (n) => String(n).padStart(2, '0');

/** Локальная дата в формате YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/**
 * Применяет ответ к карточке.
 * Верно: коробка +1; верный ответ в коробке 5 — карточка выучена.
 * Неверно: возврат в коробку 1, статус «выучена» сбрасывается.
 */
export function applyAnswer({ box, learned }, correct, today = localDate()) {
  let nb = box;
  let nl = learned ? 1 : 0;
  if (correct) {
    if (box >= MAX_BOX) nl = 1;
    else nb = box + 1;
  } else {
    nb = 1;
    nl = 0;
  }
  return { box: nb, learned: nl, next_review: addDays(today, INTERVALS[nb - 1]) };
}
