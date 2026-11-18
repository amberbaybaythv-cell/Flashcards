import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots, stableSnapshot, emptySnapshot } from '../docs/js/lib/sync-merge.js';

const snap = (o = {}) => ({ ...emptySnapshot(), ...o });
const mod = (uid, updated = 1, extra = {}) => ({ uid, updated, name: uid, ...extra });
const topic = (uid, module_uid, updated = 1) => ({ uid, updated, module_uid, name: uid });
const card = (uid, topic_uid, updated = 1, pupdated = 1, extra = {}) => ({ uid, updated, pupdated, topic_uid, block_uid: null, term: uid, definition: 'd', box: 1, learned: 0, next_review: '2026-01-01', correct_count: 0, wrong_count: 0, ...extra });
const NOW = 1_000_000;

test('merge: пустое облако — всё локальное сохраняется', () => {
  const l = snap({ modules: [mod('m')], topics: [topic('t', 'm')], cards: [card('c', 't')] });
  const m = mergeSnapshots(l, null, NOW);
  assert.equal(stableSnapshot(m), stableSnapshot(l));
});

test('merge: записи с разных устройств объединяются', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const a = snap({ ...base, cards: [card('a', 't')] });
  const b = snap({ ...base, cards: [card('b', 't')] });
  const m = mergeSnapshots(a, b, NOW);
  assert.deepEqual(m.cards.map((c) => c.uid).sort(), ['a', 'b']);
});

test('merge: побеждает последняя правка содержимого', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const a = snap({ ...base, cards: [card('c', 't', 10, 1, { term: 'старое' })] });
  const b = snap({ ...base, cards: [card('c', 't', 20, 1, { term: 'новое' })] });
  assert.equal(mergeSnapshots(a, b, NOW).cards[0].term, 'новое');
  assert.equal(mergeSnapshots(b, a, NOW).cards[0].term, 'новое');
});

test('merge: содержимое и прогресс не затирают друг друга', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const a = snap({ ...base, cards: [card('c', 't', 20, 5, { term: 'правка текста', box: 1 })] });
  const b = snap({ ...base, cards: [card('c', 't', 5, 30, { term: 'старый текст', box: 4, next_review: '2026-02-02' })] });
  const c = mergeSnapshots(a, b, NOW).cards[0];
  assert.equal(c.term, 'правка текста');
  assert.equal(c.box, 4);
  assert.equal(c.next_review, '2026-02-02');
  assert.equal(c.pupdated, 30);
});

test('merge: удаление новее правки уничтожает запись и её детей', () => {
  const base = { modules: [mod('m')] };
  const a = snap({ ...base, topics: [topic('t', 'm', 5)], cards: [card('c', 't', 5, 5)] });
  const b = snap({ ...base, tombstones: [['t', 'topics', 50]] });
  const m = mergeSnapshots(a, b, NOW);
  assert.equal(m.topics.length, 0);
  assert.equal(m.cards.length, 0);
  assert.ok(m.tombstones.some(([uid]) => uid === 'c'), 'у карточки удалённой темы появилось своё надгробие');
});

test('merge: правка новее удаления воскрешает запись', () => {
  const a = snap({ modules: [mod('m', 100)] });
  const b = snap({ tombstones: [['m', 'modules', 50]] });
  const m = mergeSnapshots(a, b, NOW);
  assert.equal(m.modules.length, 1);
  assert.equal(m.tombstones.length, 0);
});

test('merge: удалённая карточка не возвращается со старого устройства', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const old = snap({ ...base, cards: [card('c', 't', 5, 5)] });
  const fresh = snap({ ...base, tombstones: [['c', 'cards', 99]] });
  assert.equal(mergeSnapshots(old, fresh, NOW).cards.length, 0);
  assert.equal(mergeSnapshots(fresh, old, NOW).cards.length, 0);
});

test('merge: удалённый блок обнуляет ссылку у карточек', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const a = snap({ ...base, blocks: [{ uid: 'b', updated: 1, topic_uid: 't', name: 'B' }], cards: [card('c', 't', 1, 1, { block_uid: 'b' })] });
  const b = snap({ ...base, tombstones: [['b', 'blocks', 10]], cards: [card('c', 't', 1, 1, { block_uid: 'b' })] });
  const m = mergeSnapshots(a, b, NOW);
  assert.equal(m.blocks.length, 0);
  assert.equal(m.cards[0].block_uid, null);
});

test('merge: история ответов объединяется без дублей и без удалённых карточек', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')], cards: [card('c', 't')] };
  const a = snap({ ...base, reviews: [['r1', 'c', '2026-01-01', 1], ['r2', 'c', '2026-01-02', 0]] });
  const b = snap({ ...base, reviews: [['r2', 'c', '2026-01-02', 0], ['r3', 'c', '2026-01-03', 1], ['r4', 'gone', '2026-01-03', 1]] });
  assert.deepEqual(mergeSnapshots(a, b, NOW).reviews.map((r) => r[0]).sort(), ['r1', 'r2', 'r3']);
});

test('merge: идемпотентность и коммутативность', () => {
  const base = { modules: [mod('m')], topics: [topic('t', 'm')] };
  const a = snap({ ...base, cards: [card('a', 't', 10), card('x', 't', 5, 5, { term: 'A' })], reviews: [['r1', 'a', 'd', 1]] });
  const b = snap({ ...base, cards: [card('b', 't', 10), card('x', 't', 9, 9, { term: 'B' })], tombstones: [['gone', 'cards', 3]] });
  const ab = mergeSnapshots(a, b, NOW), ba = mergeSnapshots(b, a, NOW);
  assert.equal(stableSnapshot(ab), stableSnapshot(ba));
  assert.equal(stableSnapshot(mergeSnapshots(ab, ab, NOW)), stableSnapshot(ab));
  assert.equal(stableSnapshot(mergeSnapshots(ab, a, NOW)), stableSnapshot(ab));
});
