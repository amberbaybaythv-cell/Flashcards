import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, parseSections } from '../docs/js/lib/parse.js';
import { checkAnswer, levenshtein } from '../docs/js/lib/fuzzy.js';
import { applyAnswer, addDays } from '../docs/js/lib/leitner.js';

test('parse: тире, двоеточие, tab, свой символ', () => {
  assert.deepEqual(parseCards('cat - кошка\ndog – собака').map((c) => [c.term, c.definition]), [['cat', 'кошка'], ['dog', 'собака']]);
  assert.equal(parseCards('well-known - известный')[0].term, 'well-known');
  assert.equal(parseCards('a: б', { termSep: 'colon' })[0].definition, 'б');
  assert.equal(parseCards('a\tб', { termSep: 'tab' })[0].definition, 'б');
  assert.equal(parseCards('a=>b', { termSep: 'custom', customSep: '=>' })[0].definition, 'b');
});

test('parse: невалидные строки и многострочные определения', () => {
  const r = parseCards('без разделителя\nok - да');
  assert.equal(r[0].valid, false);
  assert.equal(r[1].valid, true);
  const m = parseCards('run - бежать\nидти быстро\n\nsit - сидеть', { cardSep: 'blank' });
  assert.equal(m.length, 2);
  assert.equal(m[0].definition, 'бежать\nидти быстро');
});

test('parse: секции модуля', () => {
  assert.equal(parseSections('a - б'), null);
  const s = parseSections('## T1\na - б\n## T2\nc - д\ne - ж');
  assert.deepEqual(s.map((x) => [x.name, x.cards.length]), [['T1', 1], ['T2', 2]]);
});

test('fuzzy: ответы', () => {
  assert.equal(checkAnswer('  Кошка. ', 'кошка'), 'exact');
  assert.equal(checkAnswer('елка', 'ёлка'), 'exact');
  assert.equal(checkAnswer('собака', 'пёс / собака'), 'exact');
  assert.equal(checkAnswer('beautifull', 'beautiful'), 'close');
  assert.equal(checkAnswer('cat', 'cut'), 'wrong');
  assert.equal(checkAnswer('', 'x'), 'wrong');
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('leitner: коробки и интервалы', () => {
  assert.deepEqual(applyAnswer({ box: 1, learned: 0 }, true, '2026-01-01'), { box: 2, learned: 0, next_review: '2026-01-03' });
  assert.deepEqual(applyAnswer({ box: 4, learned: 0 }, true, '2026-01-01'), { box: 5, learned: 0, next_review: '2026-01-17' });
  assert.deepEqual(applyAnswer({ box: 5, learned: 0 }, true, '2026-01-01'), { box: 5, learned: 1, next_review: '2026-01-17' });
  assert.deepEqual(applyAnswer({ box: 5, learned: 1 }, false, '2026-01-01'), { box: 1, learned: 0, next_review: '2026-01-02' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('sw.js: кеш содержит все файлы приложения (запустите npm run build:sw, если тест упал)', () => {
  const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
  const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
  const listed = new Set(JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(sw)[1]));
  const all = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (!['sw.js', '.nojekyll'].includes(e.name)) all.push('./' + path.relative(docs, p).split(path.sep).join('/'));
    }
  })(docs);
  assert.deepEqual(all.filter((f) => !listed.has(f)), []);
  assert.deepEqual([...listed].filter((f) => f !== './' && !all.includes(f)), []);
});
