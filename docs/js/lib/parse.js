// Разбор сплошного текста «термин - определение» в список карточек.

export const TERM_SEPS = {
  dash: { label: 'Тире ( - )' },
  colon: { label: 'Двоеточие ( : )' },
  tab: { label: 'Tab' },
  semicolon: { label: 'Точка с запятой ( ; )' },
  custom: { label: 'Свой символ' },
};

function findSep(text, kind, custom) {
  let idx = -1, len = 0;
  if (kind === 'dash') {
    const m = /\s[-–—]\s/.exec(text) || /[–—]/.exec(text);
    if (m) { idx = m.index; len = m[0].length; }
  } else {
    const sep = { colon: ':', tab: '\t', semicolon: ';', custom }[kind];
    if (sep) { idx = text.indexOf(sep); len = sep.length; }
  }
  return idx < 0 ? null : [idx, len];
}

/**
 * @param {string} text
 * @param {{termSep?: string, customSep?: string, cardSep?: 'newline'|'blank'}} opts
 * @returns {{term: string, definition: string, valid: boolean}[]}
 */
const BLOCK_HEAD = /^###\s+(.+?)\s*$/;

/**
 * @param {string} text
 * @param {{termSep?: string, customSep?: string, cardSep?: 'newline'|'blank'}} opts
 * @returns {({term: string, definition: string, valid: boolean, block: string|null} | {header: true, block: string, valid: true})[]}
 *   Строка «### Название» открывает блок: карточки после неё получают block = «Название».
 */
export function parseCards(text, { termSep = 'dash', customSep = '', cardSep = 'newline' } = {}) {
  const norm = String(text).replace(/\r\n?/g, '\n');
  const chunks = cardSep === 'blank' ? norm.split(/\n[ \t]*\n/) : norm.split('\n');
  const out = [];
  let block = null;
  for (const raw of chunks) {
    let chunk = raw.trim();
    // заголовки блоков в начале фрагмента (в режиме «пустая строка» они могут стоять прямо над первой карточкой)
    for (let m = BLOCK_HEAD.exec(chunk.split('\n')[0]); m; m = BLOCK_HEAD.exec(chunk.split('\n')[0])) {
      block = m[1];
      out.push({ header: true, block, valid: true });
      chunk = chunk.split('\n').slice(1).join('\n').trim();
    }
    if (!chunk) continue;
    const pos = findSep(chunk, termSep, customSep);
    if (!pos) { out.push({ term: chunk, definition: '', valid: false, block }); continue; }
    const term = chunk.slice(0, pos[0]).trim();
    const definition = chunk.slice(pos[0] + pos[1]).trim();
    out.push({ term, definition, valid: !!(term && definition), block });
  }
  return out;
}

/** Разбор текстового экспорта модуля: блоки с заголовками «## Тема» (и «### Блок» внутри темы). */
export function parseSections(text, opts) {
  const norm = String(text).replace(/\r\n?/g, '\n');
  if (!/^##\s+/m.test(norm)) return null;
  const sections = [];
  let cur = null;
  for (const line of norm.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { cur = { name: h[1].trim(), lines: [] }; sections.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return sections.map((s) => ({
    name: s.name,
    cards: parseCards(s.lines.join('\n'), opts).filter((c) => !c.header && c.valid).map(({ term, definition, block }) => ({ term, definition, block })),
  }));
}
