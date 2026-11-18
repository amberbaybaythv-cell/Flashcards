// Проверка ответов при вводе: нормализация, несколько допустимых ответов, 1 опечатка.

export function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s ]+/g, ' ')
    .replace(/^[\s.,!?;:"'«»()\-–—]+|[\s.,!?;:"'«»()\-–—]+$/g, '')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Допустимые ответы: вся строка целиком и её части, разделённые «/», «,», «;». */
export function acceptedAnswers(expected) {
  const full = normalize(expected);
  const parts = String(expected).split(/[\/,;]/).map(normalize).filter(Boolean);
  return [...new Set([full, ...parts])].filter(Boolean);
}

/** @returns {'exact'|'close'|'wrong'} */
export function checkAnswer(input, expected) {
  const given = normalize(input);
  if (!given) return 'wrong';
  const accepted = acceptedAnswers(expected);
  if (accepted.includes(given)) return 'exact';
  for (const a of accepted) {
    if (a.length > 5 && levenshtein(given, a) <= 1) return 'close';
  }
  return 'wrong';
}
