// Локальное хранилище: данные лежат в памяти и записываются в IndexedDB браузера при каждом изменении.
// Интерфейс (api) повторяет бывший серверный API, поэтому экраны почти не менялись.
import { openDb, getAll, commit, STORES } from './lib/idb.js';
import { INTERVALS, applyAnswer, localDate, addDays } from './lib/leitner.js';
import {
  lookupIpa, generateImage, buildPrompt, imageProviderName, imageConfigured, toJpegDataUrl,
} from './lib/enrich.js';
import { searchStock, downloadStock, buildQueries } from './lib/stock.js';

const LANGS = ['en', 'ru'];
const M = new Map(), T = new Map(), C = new Map(), B = new Map();
let R = [];
const ids = { modules: 0, topics: 0, cards: 0, reviews: 0, blocks: 0 };
let db = null;
export const storage = { persistent: false, error: null };

const ready = (async () => {
  try {
    db = await openDb();
    const [m, t, c, r, bl] = await Promise.all(STORES.map((s) => getAll(db, s)));
    m.forEach((x) => M.set(x.id, x)); t.forEach((x) => T.set(x.id, x)); c.forEach((x) => C.set(x.id, x)); bl.forEach((x) => B.set(x.id, x)); R = r;
    ids.blocks = Math.max(0, ...bl.map((x) => x.id));
    ids.modules = Math.max(0, ...m.map((x) => x.id)); ids.topics = Math.max(0, ...t.map((x) => x.id));
    ids.cards = Math.max(0, ...c.map((x) => x.id)); ids.reviews = Math.max(0, ...r.map((x) => x.id));
    storage.persistent = true;
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    storage.error = e.message; // работаем без сохранения, но предупреждаем
  }
})();

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (msg) => { throw new Error(msg); };
const save = (ops) => commit(db, ops);
const nextId = (s) => ++ids[s];
const byId = (map, id, what) => map.get(Number(id)) || fail(`${what} не найден`);
const copy = (o) => ({ ...o });
const nowIso = () => new Date().toISOString();

function moduleFields(b) {
  const name = str(b.name);
  if (!name) fail('Укажите название модуля');
  return { name, description: str(b.description), term_lang: LANGS.includes(b.term_lang) ? b.term_lang : 'en', def_lang: LANGS.includes(b.def_lang) ? b.def_lang : 'ru' };
}

const topicsOf = (mid) => [...T.values()].filter((t) => t.module_id === mid).sort((a, b) => a.position - b.position || a.id - b.id);
const cardsOfTopic = (tid) => [...C.values()].filter((c) => c.topic_id === tid).sort((a, b) => a.id - b.id);
const moduleOfCard = (c) => M.get(T.get(c.topic_id)?.module_id);
const blocksOf = (tid) => [...B.values()].filter((b) => b.topic_id === tid).sort((a, b) => a.position - b.position || a.id - b.id);
const blockOf = (c) => (c.block_id ? B.get(c.block_id) : null);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Блок темы по названию (без учёта регистра); создаёт, если такого ещё нет. Операции записи добавляются в ops. */
function ensureBlock(tid, name, ops) {
  name = str(name);
  const found = blocksOf(tid).find((b) => sameName(b.name, name));
  if (found) return found;
  const b = { id: nextId('blocks'), topic_id: tid, name, position: Math.max(0, ...blocksOf(tid).map((x) => x.position)) + 1, created_at: nowIso() };
  B.set(b.id, b); ops.push({ store: 'blocks', put: b });
  return b;
}

/** Показатели набора карточек: количество по статусам и по коробкам Лейтнера. */
function summarize(list, today = localDate()) {
  const total = list.length, learned = list.filter((c) => c.learned).length;
  const fresh = list.filter((c) => !c.learned && c.correct_count + c.wrong_count === 0).length;
  return {
    total, learned, fresh, learning: total - learned - fresh,
    due: list.filter((c) => c.next_review <= today).length,
    boxes: [1, 2, 3, 4, 5].map((b) => list.filter((c) => c.box === b).length),
  };
}

/** Карточки по области: topic | module | all. Для темы можно указать блок: число, 'none' (без блока) или 'all'. */
function scoped(scope, id, block) {
  id = Number(id);
  if (scope === 'topic') {
    const list = cardsOfTopic(id);
    if (block === 'none') return list.filter((c) => !c.block_id || !B.has(c.block_id));
    if (block != null && block !== '' && block !== 'all') return list.filter((c) => c.block_id === Number(block));
    return list;
  }
  const all = [...C.values()].sort((a, b) => a.id - b.id);
  if (scope === 'module') return all.filter((c) => T.get(c.topic_id)?.module_id === id);
  return all;
}

function newCard(topicId, term, definition, extra = {}) {
  return {
    id: nextId('cards'), topic_id: topicId, block_id: null, term, definition, ipa: null, ipa_tried: 0, image: null, image_credit: null,
    box: 1, learned: 0, next_review: localDate(), correct_count: 0, wrong_count: 0, created_at: nowIso(), ...extra,
  };
}

function removeCards(cardList, ops) {
  const set = new Set(cardList.map((c) => c.id));
  for (const c of cardList) { C.delete(c.id); ops.push({ store: 'cards', del: c.id }); }
  R = R.filter((r) => { if (set.has(r.card_id)) { ops.push({ store: 'reviews', del: r.id }); return false; } return true; });
}

/* ---------- Фоновая очередь IPA / картинок ---------- */
const q = { jobs: [], running: 0, total: 0, done: 0, failed: 0, missed: 0, lastError: null, streak: 0, skipped: 0 };
const CONCURRENCY = 2;

async function runJob(job) {
  const card = C.get(job.cardId);
  if (!card) return;
  if (job.type === 'ipa') {
    if (moduleOfCard(card)?.term_lang !== 'en') return;
    card.ipa = await lookupIpa(card.term); card.ipa_tried = 1;
  } else if (job.type === 'stock') {
    const cand = (await searchStock(card, moduleOfCard(card)))[0];
    if (!cand) return { missed: true }; // ничего не нашлось — это не сбой сервиса
    await applyStock(card, cand);
  } else {
    card.image = await toJpegDataUrl(await generateImage(buildPrompt(card.term, card.definition)));
    card.image_credit = null;
  }
  await save([{ store: 'cards', put: card }]);
}

async function applyStock(card, cand) {
  const { blob, credit } = await downloadStock(cand);
  card.image = await toJpegDataUrl(blob);
  card.image_credit = credit;
}

function pump() {
  while (q.running < CONCURRENCY && q.jobs.length) {
    const job = q.jobs.shift();
    q.running++;
    runJob(job)
      .then((r) => { if (r?.missed) q.missed++; else q.done++; q.streak = 0; })
      .catch((e) => {
        q.failed++; q.streak++; q.lastError = e.message;
        if (q.streak >= 3) { q.skipped += q.jobs.length; q.failed += q.jobs.length; q.jobs = []; }
      })
      .finally(() => { q.running--; pump(); });
  }
}

/* ---------- Файлы ---------- */
function saveFile(name, mime, data) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'export';
const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ');
const cardLine = (c) => `${oneLine(c.term)} - ${oneLine(c.definition)}`;

/** Текст темы: сначала карточки без блока, затем «### Название блока» и его карточки. */
function topicTextBody(t) {
  const cs = cardsOfTopic(t.id);
  const lines = cs.filter((c) => !blockOf(c)).map(cardLine);
  for (const b of blocksOf(t.id)) {
    const bc = cs.filter((c) => c.block_id === b.id);
    if (bc.length) lines.push(`### ${b.name}`, ...bc.map(cardLine));
  }
  return lines.join('\n') + '\n';
}

function exportModuleData(m) {
  return {
    format: 'quizlet-local', version: 2,
    module: { name: m.name, description: m.description, term_lang: m.term_lang, def_lang: m.def_lang },
    topics: topicsOf(m.id).map((t) => ({
      name: t.name,
      blocks: blocksOf(t.id).map((b) => ({ name: b.name })),
      cards: cardsOfTopic(t.id).map((c) => ({
        block: blockOf(c)?.name || null,
        term: c.term, definition: c.definition, ipa: c.ipa, image: c.image, image_credit: c.image_credit, box: c.box, learned: c.learned,
        next_review: c.next_review, correct_count: c.correct_count, wrong_count: c.wrong_count,
      })),
    })),
  };
}

async function importOne(d, ops) {
  const f = moduleFields(d.module || {});
  const mod = { id: nextId('modules'), ...f, created_at: nowIso() };
  M.set(mod.id, mod); ops.push({ store: 'modules', put: mod });
  let pos = 0, count = 0;
  for (const t of Array.isArray(d.topics) ? d.topics : []) {
    const name = str(t.name);
    if (!name) continue;
    const topic = { id: nextId('topics'), module_id: mod.id, name, position: ++pos, created_at: nowIso() };
    T.set(topic.id, topic); ops.push({ store: 'topics', put: topic });
    for (const b of Array.isArray(t.blocks) ? t.blocks : []) if (str(b?.name)) ensureBlock(topic.id, b.name, ops);
    for (const c of Array.isArray(t.cards) ? t.cards : []) {
      const term = str(c.term), definition = str(c.definition);
      if (!term || !definition) continue;
      const ipa = str(c.ipa) || null;
      const num = (v, d0) => (Number.isFinite(Number(v)) ? Number(v) : d0);
      let image = typeof c.image === 'string' && /^data:image\//.test(c.image) ? c.image : null;
      if (image && image.length > 200000) {
        try { image = await toJpegDataUrl(await (await fetch(image)).blob()); } catch { /* оставляем как есть */ }
      }
      const card = newCard(topic.id, term, definition, {
        ipa, ipa_tried: ipa ? 1 : 0, image, image_credit: image && c.image_credit && typeof c.image_credit === 'object' ? { text: str(c.image_credit.text), url: str(c.image_credit.url), source: str(c.image_credit.source) } : null,
        box: Math.min(5, Math.max(1, num(c.box, 1))), learned: c.learned ? 1 : 0,
        next_review: /^\d{4}-\d{2}-\d{2}$/.test(c.next_review || '') ? c.next_review : localDate(),
        correct_count: num(c.correct_count, 0), wrong_count: num(c.wrong_count, 0),
      });
      if (str(c.block)) card.block_id = ensureBlock(topic.id, c.block, ops).id;
      C.set(card.id, card); ops.push({ store: 'cards', put: card }); count++;
    }
  }
  return { moduleId: mod.id, cards: count };
}

const DEMO = {
  name: 'English B1 (демо)', description: 'Пример модуля: английский → русский', term_lang: 'en', def_lang: 'ru',
  topics: [
    { name: 'Повседневные слова', cards: [['apple', 'яблоко'], ['to run', 'бегать'], ['beautiful', 'красивый'], ['house', 'дом'], ['friend', 'друг'], ['to understand', 'понимать'], ['quickly', 'быстро'], ['weather', 'погода']] },
    { name: 'Путешествия', cards: [['luggage', 'багаж'], ['ticket', 'билет'], ['to book', 'бронировать'], ['departure', 'отправление / вылет'], ['customs', 'таможня'], ['passport', 'паспорт']] },
  ],
};

/* ---------- Публичный API ---------- */
const wrapAll = (obj) => Object.fromEntries(Object.entries(obj).map(([k, fn]) => [k, async (...a) => { await ready; return fn(...a); }]));

export const api = wrapAll({
  tree() {
    const today = localDate();
    const cards = [...C.values()];
    const modules = [...M.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' })).map((m) => {
      const topics = topicsOf(m.id).map((t) => {
        const cs = cards.filter((c) => c.topic_id === t.id);
        return { id: t.id, module_id: m.id, name: t.name, total: cs.length, due: cs.filter((c) => c.next_review <= today).length, learned: cs.filter((c) => c.learned).length };
      });
      const sum = (k) => topics.reduce((a, t) => a + t[k], 0);
      return { ...m, topics, total: sum('total'), due: sum('due'), learned: sum('learned') };
    });
    return { modules, today };
  },

  config() {
    return { imageProvider: imageProviderName(), imageConfigured: imageConfigured(), intervals: INTERVALS, storage: { ...storage } };
  },

  module: (id) => copy(byId(M, id, 'Модуль')),
  moduleCards(id) {
    const tids = new Set(topicsOf(Number(id)).map((t) => t.id));
    return [...C.values()].filter((c) => tids.has(c.topic_id)).sort((a, b) => a.id - b.id).map((c) => ({ ...c, topic_name: T.get(c.topic_id).name }));
  },

  async addModule(b) {
    const m = { id: nextId('modules'), ...moduleFields(b), created_at: nowIso() };
    M.set(m.id, m); await save([{ store: 'modules', put: m }]);
    return copy(m);
  },
  async editModule(id, b) {
    const m = byId(M, id, 'Модуль');
    Object.assign(m, moduleFields(b));
    await save([{ store: 'modules', put: m }]);
    return copy(m);
  },
  async delModule(id) {
    const m = byId(M, id, 'Модуль'), ops = [];
    for (const t of topicsOf(m.id)) {
      removeCards(cardsOfTopic(t.id), ops);
      for (const b of blocksOf(t.id)) { B.delete(b.id); ops.push({ store: 'blocks', del: b.id }); }
      T.delete(t.id); ops.push({ store: 'topics', del: t.id });
    }
    M.delete(m.id); ops.push({ store: 'modules', del: m.id });
    await save(ops);
    return { ok: true };
  },

  topic(id) {
    const t = byId(T, id, 'Тема');
    return { ...t, module: copy(M.get(t.module_id)) };
  },
  async addTopic(mid, name) {
    name = str(name);
    if (!name) fail('Укажите название темы');
    byId(M, mid, 'Модуль');
    const pos = Math.max(0, ...topicsOf(Number(mid)).map((t) => t.position)) + 1;
    const t = { id: nextId('topics'), module_id: Number(mid), name, position: pos, created_at: nowIso() };
    T.set(t.id, t); await save([{ store: 'topics', put: t }]);
    return copy(t);
  },
  async editTopic(id, name) {
    name = str(name);
    if (!name) fail('Укажите название темы');
    const t = byId(T, id, 'Тема');
    t.name = name; await save([{ store: 'topics', put: t }]);
    return copy(t);
  },
  async delTopic(id) {
    const t = byId(T, id, 'Тема'), ops = [];
    removeCards(cardsOfTopic(t.id), ops);
    for (const b of blocksOf(t.id)) { B.delete(b.id); ops.push({ store: 'blocks', del: b.id }); }
    T.delete(t.id); ops.push({ store: 'topics', del: t.id });
    await save(ops);
    return { ok: true };
  },

  cards: (tid) => cardsOfTopic(Number(tid)).map(copy),
  async addCard(tid, b) {
    const term = str(b.term), definition = str(b.definition);
    if (!term || !definition) fail('Заполните термин и определение');
    byId(T, tid, 'Тема');
    const c = newCard(Number(tid), term, definition);
    if (b.block_id && B.get(Number(b.block_id))?.topic_id === Number(tid)) c.block_id = Number(b.block_id);
    C.set(c.id, c); await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  /** Массовое добавление. opts.blockId — блок по умолчанию; у карточки может быть своё поле block (название блока). */
  async bulk(tid, list, opts = {}) {
    byId(T, tid, 'Тема');
    const ops = [], out = [];
    const defBlock = opts.blockId && B.get(Number(opts.blockId))?.topic_id === Number(tid) ? Number(opts.blockId) : null;
    for (const x of Array.isArray(list) ? list : []) {
      const term = str(x.term), definition = str(x.definition);
      if (!term || !definition) continue;
      const c = newCard(Number(tid), term, definition);
      c.block_id = str(x.block) ? ensureBlock(Number(tid), x.block, ops).id : defBlock;
      C.set(c.id, c); ops.push({ store: 'cards', put: c }); out.push(c.id);
    }
    await save(ops);
    return { ids: out };
  },
  async editCard(id, b) {
    const c = byId(C, id, 'Карточка');
    const term = str(b.term), definition = str(b.definition);
    if (!term || !definition) fail('Заполните термин и определение');
    if (typeof b.ipa === 'string') { c.ipa = b.ipa.trim() || null; c.ipa_tried = 1; }
    else if (term !== c.term) { c.ipa = null; c.ipa_tried = 0; }
    c.term = term; c.definition = definition;
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  async delCard(id) {
    const c = byId(C, id, 'Карточка'), ops = [];
    removeCards([c], ops);
    await save(ops);
    return { ok: true };
  },

  async fetchIpa(id) {
    const c = byId(C, id, 'Карточка');
    if (moduleOfCard(c)?.term_lang !== 'en') return copy(c);
    c.ipa = await lookupIpa(c.term); c.ipa_tried = 1;
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  imagePrompt(id) {
    const c = byId(C, id, 'Карточка');
    return { prompt: buildPrompt(c.term, c.definition) };
  },
  async genImage(id, prompt) {
    const c = byId(C, id, 'Карточка');
    c.image = await toJpegDataUrl(await generateImage(str(prompt) || buildPrompt(c.term, c.definition)));
    c.image_credit = null;
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  async uploadImage(id, file) {
    const c = byId(C, id, 'Карточка');
    if (!file || !file.type?.startsWith('image/')) fail('Нужен файл-изображение (PNG, JPEG, WebP, GIF)');
    c.image = await toJpegDataUrl(file);
    c.image_credit = null;
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  async delImage(id) {
    const c = byId(C, id, 'Карточка');
    c.image = null; c.image_credit = null;
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },

  async stockSearch(id, opts) {
    const c = byId(C, id, 'Карточка');
    return searchStock(c, moduleOfCard(c), opts);
  },
  async useStock(id, cand) {
    const c = byId(C, id, 'Карточка');
    await applyStock(c, cand);
    await save([{ store: 'cards', put: c }]);
    return copy(c);
  },
  stockQueries: (id) => { const c = byId(C, id, 'Карточка'); return buildQueries(c, moduleOfCard(c)); },

  enrich({ scope, id, cardIds, ipa, images, stock }) {
    const list = Array.isArray(cardIds) && cardIds.length ? cardIds.map((x) => C.get(Number(x))).filter(Boolean) : scoped(scope, id);
    const jobs = [];
    for (const c of list) {
      if (ipa && moduleOfCard(c)?.term_lang === 'en' && !c.ipa && !c.ipa_tried) jobs.push({ type: 'ipa', cardId: c.id });
      if (images && !c.image) jobs.push({ type: 'image', cardId: c.id });
      if (stock && !c.image) jobs.push({ type: 'stock', cardId: c.id });
    }
    if (jobs.length) {
      if (!q.jobs.length && !q.running) Object.assign(q, { total: 0, done: 0, failed: 0, missed: 0, lastError: null, streak: 0, skipped: 0 });
      q.jobs.push(...jobs); q.total += jobs.length; pump();
    }
    return { queued: jobs.length };
  },
  queue() {
    return {
      active: q.jobs.length + q.running > 0, total: q.total, done: q.done, failed: q.failed, missed: q.missed,
      lastError: q.lastError && q.skipped ? `${q.lastError} (очередь остановлена после нескольких ошибок подряд, пропущено: ${q.skipped})` : q.lastError,
    };
  },

  study({ scope = 'topic', id = 0, filter = 'all', block }) {
    const today = localDate();
    let list = scoped(scope, id, block);
    if (filter === 'due') list = list.filter((c) => c.next_review <= today);
    if (filter === 'unlearned') list = list.filter((c) => !c.learned);
    const cards = list.map((c) => {
      const t = T.get(c.topic_id), m = M.get(t.module_id);
      return { id: c.id, term: c.term, definition: c.definition, ipa: c.ipa, image: c.image, box: c.box, learned: c.learned, topic_id: c.topic_id, module_id: m.id, term_lang: m.term_lang, def_lang: m.def_lang };
    });
    const mids = new Set(cards.map((c) => c.module_id));
    const pool = [...C.values()].map((c) => ({ id: c.id, module_id: T.get(c.topic_id).module_id, term: c.term, definition: c.definition })).filter((p) => mids.has(p.module_id));
    return { cards, pool };
  },

  async answers(list) {
    const today = localDate(), ops = [];
    for (const a of Array.isArray(list) ? list : []) {
      const c = C.get(Number(a.id));
      if (!c) continue;
      const ok = !!a.correct;
      Object.assign(c, applyAnswer(c, ok, today));
      c.correct_count += ok ? 1 : 0; c.wrong_count += ok ? 0 : 1;
      const r = { id: nextId('reviews'), card_id: c.id, day: today, correct: ok ? 1 : 0 };
      R.push(r); ops.push({ store: 'cards', put: c }, { store: 'reviews', put: r });
    }
    await save(ops);
    return { ok: true };
  },

  stats(scope, id, block) {
    const today = localDate(), list = scoped(scope, id, block), set = new Set(list.map((c) => c.id));
    const { boxes, ...totals } = summarize(list, today);
    const start = addDays(today, -29), act = new Map();
    for (const r of R) {
      if (r.day < start || !set.has(r.card_id)) continue;
      const x = act.get(r.day) || { n: 0, ok: 0 };
      x.n++; x.ok += r.correct; act.set(r.day, x);
    }
    const activity = Array.from({ length: 30 }, (_, i) => { const day = addDays(start, i), x = act.get(day); return { day, n: x?.n || 0, ok: x?.ok || 0 }; });
    const hardest = list.filter((c) => c.wrong_count > 0)
      .sort((a, b) => b.wrong_count - a.wrong_count || a.correct_count - b.correct_count).slice(0, 8)
      .map((c) => ({ id: c.id, term: c.term, definition: c.definition, wrong_count: c.wrong_count, correct_count: c.correct_count }));
    const res = { totals, boxes, activity, hardest };
    // по каждому блоку темы (и по карточкам без блока), если в теме есть блоки
    if (scope === 'topic' && (block == null || block === 'all' || block === '') && blocksOf(Number(id)).length) {
      const topicCards = cardsOfTopic(Number(id));
      const rows = blocksOf(Number(id)).map((b) => ({ id: b.id, name: b.name, ...summarize(topicCards.filter((c) => c.block_id === b.id), today) }));
      const none = topicCards.filter((c) => !c.block_id || !B.has(c.block_id));
      if (none.length) rows.push({ id: null, name: 'Без блока', ...summarize(none, today) });
      res.blocks = rows;
    }
    return res;
  },

  /* ----- блоки внутри темы ----- */
  blocks(tid) {
    const t = byId(T, tid, 'Тема'), today = localDate(), cs = cardsOfTopic(t.id);
    const blocks = blocksOf(t.id).map((b) => ({ id: b.id, name: b.name, position: b.position, ...summarize(cs.filter((c) => c.block_id === b.id), today) }));
    const none = summarize(cs.filter((c) => !c.block_id || !B.has(c.block_id)), today);
    return { blocks, none, total: cs.length };
  },
  async addBlock(tid, name) {
    const t = byId(T, tid, 'Тема');
    name = str(name);
    if (!name) fail('Укажите название блока');
    if (blocksOf(t.id).some((b) => sameName(b.name, name))) fail('Блок с таким названием уже есть в этой теме');
    const ops = [], b = ensureBlock(t.id, name, ops);
    await save(ops);
    return copy(b);
  },
  async editBlock(id, name) {
    const b = byId(B, id, 'Блок');
    name = str(name);
    if (!name) fail('Укажите название блока');
    if (blocksOf(b.topic_id).some((x) => x.id !== b.id && sameName(x.name, name))) fail('Блок с таким названием уже есть в этой теме');
    b.name = name;
    await save([{ store: 'blocks', put: b }]);
    return copy(b);
  },
  /** Удаляет блок; карточки остаются в теме без блока. */
  async delBlock(id) {
    const b = byId(B, id, 'Блок'), ops = [];
    for (const c of cardsOfTopic(b.topic_id)) if (c.block_id === b.id) { c.block_id = null; ops.push({ store: 'cards', put: c }); }
    B.delete(b.id); ops.push({ store: 'blocks', del: b.id });
    await save(ops);
    return { ok: true };
  },
  /** Переносит карточки в блок (blockId = null убирает из блока). */
  async moveCards(cardIds, blockId) {
    const block = blockId ? byId(B, blockId, 'Блок') : null, ops = [];
    for (const cid of Array.isArray(cardIds) ? cardIds : []) {
      const c = C.get(Number(cid));
      if (!c || (block && block.topic_id !== c.topic_id)) continue; // нельзя переносить в блок другой темы
      c.block_id = block ? block.id : null;
      ops.push({ store: 'cards', put: c });
    }
    await save(ops);
    return { moved: ops.length };
  },
  /** Делит карточки без блока на блоки по size штук: «Блок 1», «Блок 2», … */
  async splitBlocks(tid, size) {
    const t = byId(T, tid, 'Тема');
    size = Math.floor(Number(size));
    if (!(size >= 2 && size <= 500)) fail('Размер блока: от 2 до 500 карточек');
    const free = cardsOfTopic(t.id).filter((c) => !c.block_id || !B.has(c.block_id));
    if (!free.length) fail('Все карточки темы уже распределены по блокам');
    const ops = [];
    let n = 0;
    for (let i = 0; i < free.length; i += size) {
      let name;
      do { name = `Блок ${++n}`; } while (blocksOf(t.id).some((b) => sameName(b.name, name)));
      const b = ensureBlock(t.id, name, ops);
      for (const c of free.slice(i, i + size)) { c.block_id = b.id; ops.push({ store: 'cards', put: c }); }
    }
    await save(ops);
    return { blocks: Math.ceil(free.length / size), cards: free.length };
  },

  search(query) {
    const s = str(query).toLowerCase();
    if (!s) return [];
    const rows = [];
    for (const c of C.values()) {
      if (!c.term.toLowerCase().includes(s) && !c.definition.toLowerCase().includes(s)) continue;
      const t = T.get(c.topic_id), m = M.get(t.module_id);
      rows.push({ id: c.id, term: c.term, definition: c.definition, ipa: c.ipa, image: c.image, topic_id: t.id, topic_name: t.name, module_id: m.id, module_name: m.name, _o: [m.name, t.position, c.id] });
    }
    rows.sort((a, b) => a._o[0].localeCompare(b._o[0], 'ru') || a._o[1] - b._o[1] || a._o[2] - b._o[2]);
    return rows.slice(0, 200).map(({ _o, ...r }) => r);
  },

  /* ----- экспорт / импорт ----- */
  async importModule(data) {
    const ops = [];
    let res;
    if (data?.format === 'quizlet-local-backup' && Array.isArray(data.modules)) {
      let cards = 0, first = null;
      for (const m of data.modules) { const r = await importOne(m, ops); cards += r.cards; first ??= r.moduleId; }
      if (first == null) fail('В резервной копии нет модулей');
      res = { moduleId: first, cards, modules: data.modules.length };
    } else if (data?.format === 'quizlet-local' && data.module && Array.isArray(data.topics)) {
      res = await importOne(data, ops);
    } else fail('Это не файл экспорта этого приложения');
    await save(ops);
    return res;
  },
  downloadModule(id, fmt) {
    const m = byId(M, id, 'Модуль');
    if (fmt === 'txt') {
      const text = topicsOf(m.id).map((t) => `## ${t.name}\n${topicTextBody(t)}`).join('\n');
      saveFile(`${safeName(m.name)}.txt`, 'text/plain;charset=utf-8', text);
    } else saveFile(`${safeName(m.name)}.json`, 'application/json', JSON.stringify(exportModuleData(m)));
    return { ok: true };
  },
  downloadTopic(id) {
    const t = byId(T, id, 'Тема');
    saveFile(`${safeName(t.name)}.txt`, 'text/plain;charset=utf-8', topicTextBody(t));
    return { ok: true };
  },
  downloadBackup() {
    const data = { format: 'quizlet-local-backup', version: 2, created: nowIso(), modules: [...M.values()].map(exportModuleData) };
    saveFile(`kartochki-backup-${localDate()}.json`, 'application/json', JSON.stringify(data));
    try { localStorage.setItem('lastBackup', localDate()); } catch { /* ignore */ }
    return { ok: true, modules: data.modules.length };
  },
  async loadDemo() {
    const ops = [];
    const res = await importOne({ module: DEMO, topics: DEMO.topics.map((t) => ({ name: t.name, cards: t.cards.map(([term, definition]) => ({ term, definition })) })) }, ops);
    await save(ops);
    return res;
  },
});
