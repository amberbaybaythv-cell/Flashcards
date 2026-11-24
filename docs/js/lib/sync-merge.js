// Слияние данных двух устройств (чистая функция, без обращений к браузеру).
//
// Снимок (snapshot): { modules, topics, blocks, cards, reviews, tombstones }.
// У каждой записи есть uid (единый для всех устройств) и updated (мс, время последней правки содержимого);
// у карточек ещё pupdated: время последнего изменения прогресса. Содержимое и прогресс сливаются отдельно,
// поэтому правка текста на одном устройстве и ответ на карточку на другом не затирают друг друга.
// Побеждает последняя правка. Удаление побеждает, если оно новее последней правки записи.

export const PROGRESS_FIELDS = ['box', 'learned', 'next_review', 'correct_count', 'wrong_count'];
const KEEP_TOMBSTONES_MS = 365 * 24 * 3600 * 1000;

const last = (x) => Math.max(x.updated || 0, x.pupdated || 0);

/** Объединяет локальный и облачный снимки. remote может быть null (облако ещё пустое). */
export function mergeSnapshots(local, remote, now = Date.now()) {
  remote = remote || { modules: [], topics: [], blocks: [], cards: [], reviews: [], tombstones: [] };

  // 1. надгробия: берём самое позднее по каждой записи
  const tomb = new Map();
  for (const [uid, kind, t] of [...(local.tombstones || []), ...(remote.tombstones || [])]) {
    const cur = tomb.get(uid);
    if (!cur || t > cur.t) tomb.set(uid, { kind, t });
  }

  // 2. по каждому виду записей выбираем победителя
  const pick = (kind, withProgress) => {
    const L = new Map((local[kind] || []).map((x) => [x.uid, x]));
    const R = new Map((remote[kind] || []).map((x) => [x.uid, x]));
    const out = [];
    for (const uid of new Set([...L.keys(), ...R.keys()])) {
      const l = L.get(uid), r = R.get(uid);
      let m;
      if (l && r) {
        m = { ...(r.updated > l.updated ? r : l) };
        if (withProgress) {
          const p = (r.pupdated || 0) > (l.pupdated || 0) ? r : l;
          for (const k of PROGRESS_FIELDS) m[k] = p[k];
          m.pupdated = p.pupdated;
        }
      } else m = { ...(l || r) };
      const t = tomb.get(uid);
      if (t) {
        if (t.t >= last(m)) continue; // удалено позже последней правки
        tomb.delete(uid);             // правка новее удаления: запись остаётся
      }
      out.push(m);
    }
    return out;
  };
  const modules = pick('modules');
  const topics = pick('topics');
  const blocks = pick('blocks');
  const cards = pick('cards', true);

  // 3. целостность: дети удалённых родителей уходят вместе с ними (и получают свои надгробия)
  const drop = (kind, uid, t) => { if (!tomb.has(uid)) tomb.set(uid, { kind, t }); };
  const parentTime = (uid) => tomb.get(uid)?.t ?? now;
  const modUids = new Set(modules.map((x) => x.uid));
  const topicsOk = topics.filter((x) => modUids.has(x.module_uid) || (drop('topics', x.uid, parentTime(x.module_uid)), false));
  const topicUids = new Set(topicsOk.map((x) => x.uid));
  const blocksOk = blocks.filter((x) => topicUids.has(x.topic_uid) || (drop('blocks', x.uid, parentTime(x.topic_uid)), false));
  const blockUids = new Set(blocksOk.map((x) => x.uid));
  const cardsOk = cards
    .filter((x) => topicUids.has(x.topic_uid) || (drop('cards', x.uid, parentTime(x.topic_uid)), false))
    .map((x) => (x.block_uid && !blockUids.has(x.block_uid) ? { ...x, block_uid: null } : x));
  const cardUids = new Set(cardsOk.map((x) => x.uid));

  // 4. ответы (история): объединение по uid, без записей удалённых карточек
  const seen = new Set(), reviews = [];
  for (const r of [...(local.reviews || []), ...(remote.reviews || [])]) {
    if (seen.has(r[0]) || !cardUids.has(r[1])) continue;
    seen.add(r[0]); reviews.push(r);
  }

  const tombstones = [...tomb].filter(([, v]) => now - v.t < KEEP_TOMBSTONES_MS).map(([uid, v]) => [uid, v.kind, v.t]);
  return { modules, topics: topicsOk, blocks: blocksOk, cards: cardsOk, reviews, tombstones };
}

/** Стабильная строка снимка (ключи и записи упорядочены): чтобы понять, отличается ли результат от облака. */
export function stableSnapshot(s) {
  const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
  const by = (a, b) => String(a.uid ?? a[0]).localeCompare(String(b.uid ?? b[0]));
  return JSON.stringify(sortKeys({
    modules: [...s.modules].sort(by), topics: [...s.topics].sort(by), blocks: [...s.blocks].sort(by), cards: [...s.cards].sort(by),
    reviews: [...s.reviews].sort(by), tombstones: [...s.tombstones].sort(by),
  }));
}

export const emptySnapshot = () => ({ modules: [], topics: [], blocks: [], cards: [], reviews: [], tombstones: [] });
