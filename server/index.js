import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, ROOT, IMAGES_DIR } from './db.js';
import { applyAnswer, localDate, addDays, INTERVALS } from './leitner.js';
import {
  enrichIpa, enrichImage, enqueue, queueStatus, saveImage, removeImageFile, extFor, imageProviderName,
} from './enrich.js';

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public')));

const LANGS = ['en', 'ru'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => Number.parseInt(v, 10);

/* ---------- Дерево и конфиг ---------- */
app.get('/api/tree', (req, res) => {
  const today = localDate();
  const modules = db.prepare('SELECT * FROM modules ORDER BY name COLLATE NOCASE').all();
  const topics = db.prepare(`
    SELECT t.id, t.module_id, t.name, COUNT(c.id) AS total,
      COALESCE(SUM(CASE WHEN c.next_review <= ? THEN 1 ELSE 0 END), 0) AS due,
      COALESCE(SUM(c.learned), 0) AS learned
    FROM topics t LEFT JOIN cards c ON c.topic_id = t.id
    GROUP BY t.id ORDER BY t.position, t.id`).all(today);
  for (const m of modules) {
    m.topics = topics.filter((t) => t.module_id === m.id);
    m.total = m.topics.reduce((a, t) => a + t.total, 0);
    m.due = m.topics.reduce((a, t) => a + t.due, 0);
    m.learned = m.topics.reduce((a, t) => a + t.learned, 0);
  }
  res.json({ modules, today });
});

app.get('/api/config', (req, res) => {
  const p = imageProviderName();
  res.json({
    imageProvider: p,
    imageConfigured: p !== 'openai' || !!process.env.OPENAI_API_KEY,
    intervals: INTERVALS,
  });
});

/* ---------- Модули ---------- */
function moduleBody(b) {
  const name = str(b.name);
  if (!name) return null;
  return {
    name,
    description: str(b.description),
    term_lang: LANGS.includes(b.term_lang) ? b.term_lang : 'en',
    def_lang: LANGS.includes(b.def_lang) ? b.def_lang : 'ru',
  };
}

app.post('/api/modules', (req, res) => {
  const m = moduleBody(req.body);
  if (!m) return bad(res, 'Укажите название модуля');
  const info = db.prepare('INSERT INTO modules (name, description, term_lang, def_lang) VALUES (@name,@description,@term_lang,@def_lang)').run(m);
  res.json(db.prepare('SELECT * FROM modules WHERE id=?').get(info.lastInsertRowid));
});

app.put('/api/modules/:id', (req, res) => {
  const m = moduleBody(req.body);
  if (!m) return bad(res, 'Укажите название модуля');
  const info = db.prepare('UPDATE modules SET name=@name, description=@description, term_lang=@term_lang, def_lang=@def_lang WHERE id=@id').run({ ...m, id: num(req.params.id) });
  if (!info.changes) return bad(res, 'Модуль не найден', 404);
  res.json(db.prepare('SELECT * FROM modules WHERE id=?').get(num(req.params.id)));
});

app.delete('/api/modules/:id', (req, res) => {
  const id = num(req.params.id);
  const imgs = db.prepare('SELECT c.image FROM cards c JOIN topics t ON t.id=c.topic_id WHERE t.module_id=? AND c.image IS NOT NULL').all(id);
  db.prepare('DELETE FROM modules WHERE id=?').run(id);
  imgs.forEach((r) => removeImageFile(r.image));
  res.json({ ok: true });
});

app.get('/api/modules/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM modules WHERE id=?').get(num(req.params.id));
  if (!m) return bad(res, 'Модуль не найден', 404);
  res.json(m);
});

app.get('/api/modules/:id/cards', (req, res) => {
  res.json(db.prepare(`SELECT c.*, t.name AS topic_name FROM cards c JOIN topics t ON t.id=c.topic_id WHERE t.module_id=? ORDER BY t.position, t.id, c.id`).all(num(req.params.id)));
});

/* ---------- Темы ---------- */
app.post('/api/modules/:id/topics', (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'Укажите название темы');
  const mid = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM modules WHERE id=?').get(mid)) return bad(res, 'Модуль не найден', 404);
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM topics WHERE module_id=?').get(mid).p;
  const info = db.prepare('INSERT INTO topics (module_id, name, position) VALUES (?,?,?)').run(mid, name, pos);
  res.json(db.prepare('SELECT * FROM topics WHERE id=?').get(info.lastInsertRowid));
});

app.get('/api/topics/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id=?').get(num(req.params.id));
  if (!t) return bad(res, 'Тема не найдена', 404);
  t.module = db.prepare('SELECT * FROM modules WHERE id=?').get(t.module_id);
  res.json(t);
});

app.put('/api/topics/:id', (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'Укажите название темы');
  const info = db.prepare('UPDATE topics SET name=? WHERE id=?').run(name, num(req.params.id));
  if (!info.changes) return bad(res, 'Тема не найдена', 404);
  res.json(db.prepare('SELECT * FROM topics WHERE id=?').get(num(req.params.id)));
});

app.delete('/api/topics/:id', (req, res) => {
  const id = num(req.params.id);
  const imgs = db.prepare('SELECT image FROM cards WHERE topic_id=? AND image IS NOT NULL').all(id);
  db.prepare('DELETE FROM topics WHERE id=?').run(id);
  imgs.forEach((r) => removeImageFile(r.image));
  res.json({ ok: true });
});

/* ---------- Карточки ---------- */
const insertCard = db.prepare('INSERT INTO cards (topic_id, term, definition, next_review) VALUES (?,?,?,?)');

app.get('/api/topics/:id/cards', (req, res) => {
  res.json(db.prepare('SELECT * FROM cards WHERE topic_id=? ORDER BY id').all(num(req.params.id)));
});

app.post('/api/topics/:id/cards', (req, res) => {
  const term = str(req.body.term), definition = str(req.body.definition);
  if (!term || !definition) return bad(res, 'Заполните термин и определение');
  const tid = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM topics WHERE id=?').get(tid)) return bad(res, 'Тема не найдена', 404);
  const info = insertCard.run(tid, term, definition, localDate());
  res.json(db.prepare('SELECT * FROM cards WHERE id=?').get(info.lastInsertRowid));
});

app.post('/api/topics/:id/cards/bulk', (req, res) => {
  const tid = num(req.params.id);
  if (!db.prepare('SELECT 1 FROM topics WHERE id=?').get(tid)) return bad(res, 'Тема не найдена', 404);
  const list = Array.isArray(req.body.cards) ? req.body.cards : [];
  const today = localDate();
  const ids = [];
  db.transaction(() => {
    for (const c of list) {
      const term = str(c.term), definition = str(c.definition);
      if (term && definition) ids.push(insertCard.run(tid, term, definition, today).lastInsertRowid);
    }
  })();
  res.json({ ids });
});

app.put('/api/cards/:id', (req, res) => {
  const id = num(req.params.id);
  const old = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  if (!old) return bad(res, 'Карточка не найдена', 404);
  const term = str(req.body.term), definition = str(req.body.definition);
  if (!term || !definition) return bad(res, 'Заполните термин и определение');
  let ipa = old.ipa, tried = old.ipa_tried;
  if (typeof req.body.ipa === 'string') { ipa = req.body.ipa.trim() || null; tried = 1; }
  else if (term !== old.term) { ipa = null; tried = 0; }
  db.prepare('UPDATE cards SET term=?, definition=?, ipa=?, ipa_tried=? WHERE id=?').run(term, definition, ipa, tried, id);
  res.json(db.prepare('SELECT * FROM cards WHERE id=?').get(id));
});

app.delete('/api/cards/:id', (req, res) => {
  const id = num(req.params.id);
  const c = db.prepare('SELECT image FROM cards WHERE id=?').get(id);
  db.prepare('DELETE FROM cards WHERE id=?').run(id);
  removeImageFile(c?.image);
  res.json({ ok: true });
});

app.post('/api/cards/:id/ipa', wrap(async (req, res) => {
  try {
    const card = await enrichIpa(num(req.params.id));
    if (!card) return bad(res, 'Карточка не найдена', 404);
    res.json(card);
  } catch (e) {
    bad(res, 'Не удалось получить транскрипцию (нет интернета?): ' + e.message, 502);
  }
}));

app.post('/api/cards/:id/image/generate', wrap(async (req, res) => {
  try {
    const card = await enrichImage(num(req.params.id));
    if (!card) return bad(res, 'Карточка не найдена', 404);
    res.json(card);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'превышено время ожидания' : e.message;
    bad(res, 'Не удалось сгенерировать картинку (проверьте интернет и настройки .env): ' + msg, 502);
  }
}));

app.put('/api/cards/:id/image', express.raw({ type: 'image/*', limit: '15mb' }), (req, res) => {
  const id = num(req.params.id);
  const ext = extFor(req.headers['content-type']);
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'Нужен файл PNG, JPEG, WebP или GIF');
  if (!db.prepare('SELECT 1 FROM cards WHERE id=?').get(id)) return bad(res, 'Карточка не найдена', 404);
  saveImage(id, req.body, ext);
  res.json(db.prepare('SELECT * FROM cards WHERE id=?').get(id));
});

app.delete('/api/cards/:id/image', (req, res) => {
  const id = num(req.params.id);
  const c = db.prepare('SELECT image FROM cards WHERE id=?').get(id);
  db.prepare('UPDATE cards SET image=NULL WHERE id=?').run(id);
  removeImageFile(c?.image);
  res.json(db.prepare('SELECT * FROM cards WHERE id=?').get(id));
});

/* ---------- Фоновое дополнение (IPA / картинки) ---------- */
function scopeWhere(scope, id) {
  if (scope === 'topic') return { sql: 'c.topic_id = ?', args: [id] };
  if (scope === 'module') return { sql: 't.module_id = ?', args: [id] };
  return { sql: '1=1', args: [] };
}

app.post('/api/enrich', (req, res) => {
  const { scope, id, cardIds, ipa, images } = req.body;
  let rows;
  const base = `SELECT c.id, c.ipa, c.ipa_tried, c.image, m.term_lang FROM cards c JOIN topics t ON t.id=c.topic_id JOIN modules m ON m.id=t.module_id`;
  if (Array.isArray(cardIds) && cardIds.length) {
    const ph = cardIds.map(() => '?').join(',');
    rows = db.prepare(`${base} WHERE c.id IN (${ph})`).all(...cardIds.map(Number));
  } else {
    const w = scopeWhere(scope, num(id));
    rows = db.prepare(`${base} WHERE ${w.sql}`).all(...w.args);
  }
  const jobs = [];
  for (const r of rows) {
    if (ipa && r.term_lang === 'en' && !r.ipa && !r.ipa_tried) jobs.push({ type: 'ipa', cardId: r.id });
    if (images && !r.image) jobs.push({ type: 'image', cardId: r.id });
  }
  if (jobs.length) enqueue(jobs);
  res.json({ queued: jobs.length });
});

app.get('/api/queue', (req, res) => res.json(queueStatus()));

/* ---------- Обучение ---------- */
app.get('/api/study', (req, res) => {
  const { scope = 'topic', filter = 'all' } = req.query;
  const id = num(req.query.id);
  const w = scopeWhere(scope, id);
  const conds = [w.sql];
  const args = [...w.args];
  if (filter === 'due') { conds.push('c.next_review <= ?'); args.push(localDate()); }
  if (filter === 'unlearned') conds.push('c.learned = 0');
  const cards = db.prepare(`
    SELECT c.id, c.term, c.definition, c.ipa, c.image, c.box, c.learned, c.topic_id, t.module_id, m.term_lang, m.def_lang
    FROM cards c JOIN topics t ON t.id=c.topic_id JOIN modules m ON m.id=t.module_id
    WHERE ${conds.join(' AND ')} ORDER BY c.id`).all(...args);
  const mids = [...new Set(cards.map((c) => c.module_id))];
  let pool = [];
  if (mids.length) {
    pool = db.prepare(`SELECT c.id, t.module_id, c.term, c.definition FROM cards c JOIN topics t ON t.id=c.topic_id WHERE t.module_id IN (${mids.map(() => '?').join(',')}) LIMIT 5000`).all(...mids);
  }
  res.json({ cards, pool });
});

const getCard = db.prepare('SELECT box, learned, correct_count, wrong_count FROM cards WHERE id=?');
const setCard = db.prepare('UPDATE cards SET box=@box, learned=@learned, next_review=@next_review, correct_count=@cc, wrong_count=@wc WHERE id=@id');
const addReview = db.prepare('INSERT INTO reviews (card_id, day, correct) VALUES (?,?,?)');

app.post('/api/answers', (req, res) => {
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const today = localDate();
  db.transaction(() => {
    for (const a of answers) {
      const card = getCard.get(num(a.id));
      if (!card) continue;
      const ok = !!a.correct;
      const upd = applyAnswer(card, ok, today);
      setCard.run({ ...upd, id: num(a.id), cc: card.correct_count + (ok ? 1 : 0), wc: card.wrong_count + (ok ? 0 : 1) });
      addReview.run(num(a.id), today, ok ? 1 : 0);
    }
  })();
  res.json({ ok: true });
});

/* ---------- Статистика ---------- */
app.get('/api/stats', (req, res) => {
  const { scope = 'all' } = req.query;
  const w = scopeWhere(scope, num(req.query.id));
  const today = localDate();
  const from = `FROM cards c JOIN topics t ON t.id=c.topic_id WHERE ${w.sql}`;
  const totals = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN c.learned=1 THEN 1 ELSE 0 END),0) AS learned,
      COALESCE(SUM(CASE WHEN c.learned=0 AND c.correct_count+c.wrong_count=0 THEN 1 ELSE 0 END),0) AS fresh,
      COALESCE(SUM(CASE WHEN c.next_review<=? THEN 1 ELSE 0 END),0) AS due ${from}`).get(today, ...w.args);
  totals.learning = totals.total - totals.learned - totals.fresh;
  const boxRows = db.prepare(`SELECT c.box, COUNT(*) AS n ${from} GROUP BY c.box`).all(...w.args);
  const boxes = [1, 2, 3, 4, 5].map((b) => boxRows.find((r) => r.box === b)?.n || 0);
  const start = addDays(today, -29);
  const act = db.prepare(`SELECT r.day, COUNT(*) AS n, SUM(r.correct) AS ok FROM reviews r JOIN cards c ON c.id=r.card_id JOIN topics t ON t.id=c.topic_id
    WHERE r.day >= ? AND ${w.sql} GROUP BY r.day`).all(start, ...w.args);
  const activity = [];
  for (let i = 0; i < 30; i++) {
    const day = addDays(start, i);
    const r = act.find((x) => x.day === day);
    activity.push({ day, n: r?.n || 0, ok: r?.ok || 0 });
  }
  const hardest = db.prepare(`SELECT c.id, c.term, c.definition, c.wrong_count, c.correct_count ${from} AND c.wrong_count > 0
    ORDER BY c.wrong_count DESC, c.correct_count ASC LIMIT 8`).all(...w.args);
  res.json({ totals, boxes, activity, hardest });
});

/* ---------- Поиск ---------- */
app.get('/api/search', (req, res) => {
  const q = str(req.query.q).toLowerCase();
  if (!q) return res.json([]);
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  res.json(db.prepare(`
    SELECT c.id, c.term, c.definition, c.ipa, c.image, t.id AS topic_id, t.name AS topic_name, m.id AS module_id, m.name AS module_name
    FROM cards c JOIN topics t ON t.id=c.topic_id JOIN modules m ON m.id=t.module_id
    WHERE ulower(c.term) LIKE ? ESCAPE '\\' OR ulower(c.definition) LIKE ? ESCAPE '\\'
    ORDER BY m.name, t.position, c.id LIMIT 200`).all(like, like));
});

/* ---------- Экспорт / импорт ---------- */
const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ');
const topicText = (t, cards) => `## ${t.name}\n` + cards.map((c) => `${oneLine(c.term)} - ${oneLine(c.definition)}`).join('\n') + '\n';
const fileName = (s) => encodeURIComponent(s.replace(/[\\/:*?"<>|]+/g, '_'));

app.get('/api/modules/:id/export.json', (req, res) => {
  const m = db.prepare('SELECT * FROM modules WHERE id=?').get(num(req.params.id));
  if (!m) return bad(res, 'Модуль не найден', 404);
  const topics = db.prepare('SELECT * FROM topics WHERE module_id=? ORDER BY position, id').all(m.id).map((t) => ({
    name: t.name,
    cards: db.prepare('SELECT * FROM cards WHERE topic_id=? ORDER BY id').all(t.id).map((c) => {
      let image = null;
      if (c.image) {
        try {
          const ext = path.extname(c.image).slice(1);
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          image = `data:${mime};base64,${fs.readFileSync(path.join(IMAGES_DIR, path.basename(c.image))).toString('base64')}`;
        } catch { /* файл утерян */ }
      }
      return { term: c.term, definition: c.definition, ipa: c.ipa, image, box: c.box, learned: c.learned };
    }),
  }));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName(m.name)}.json`);
  res.json({ format: 'quizlet-local', version: 1, module: { name: m.name, description: m.description, term_lang: m.term_lang, def_lang: m.def_lang }, topics });
});

app.get('/api/modules/:id/export.txt', (req, res) => {
  const m = db.prepare('SELECT * FROM modules WHERE id=?').get(num(req.params.id));
  if (!m) return bad(res, 'Модуль не найден', 404);
  const topics = db.prepare('SELECT * FROM topics WHERE module_id=? ORDER BY position, id').all(m.id);
  const text = topics.map((t) => topicText(t, db.prepare('SELECT * FROM cards WHERE topic_id=? ORDER BY id').all(t.id))).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName(m.name)}.txt`);
  res.send(text);
});

app.get('/api/topics/:id/export.txt', (req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id=?').get(num(req.params.id));
  if (!t) return bad(res, 'Тема не найдена', 404);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName(t.name)}.txt`);
  res.send(db.prepare('SELECT * FROM cards WHERE topic_id=? ORDER BY id').all(t.id).map((c) => `${oneLine(c.term)} - ${oneLine(c.definition)}`).join('\n') + '\n');
});

app.post('/api/import/module', (req, res) => {
  const d = req.body;
  if (d?.format !== 'quizlet-local' || !d.module || !Array.isArray(d.topics)) return bad(res, 'Это не файл экспорта модуля');
  const m = moduleBody(d.module);
  if (!m) return bad(res, 'В файле нет названия модуля');
  const today = localDate();
  const savedImages = [];
  const result = db.transaction(() => {
    const mid = db.prepare('INSERT INTO modules (name, description, term_lang, def_lang) VALUES (@name,@description,@term_lang,@def_lang)').run(m).lastInsertRowid;
    let pos = 0, count = 0;
    for (const t of d.topics) {
      const name = str(t.name);
      if (!name) continue;
      const tid = db.prepare('INSERT INTO topics (module_id, name, position) VALUES (?,?,?)').run(mid, name, ++pos).lastInsertRowid;
      for (const c of Array.isArray(t.cards) ? t.cards : []) {
        const term = str(c.term), definition = str(c.definition);
        if (!term || !definition) continue;
        const box = Math.min(5, Math.max(1, num(c.box) || 1));
        const ipa = str(c.ipa) || null;
        const cid = db.prepare('INSERT INTO cards (topic_id, term, definition, ipa, ipa_tried, box, learned, next_review) VALUES (?,?,?,?,?,?,?,?)')
          .run(tid, term, definition, ipa, ipa ? 1 : 0, box, c.learned ? 1 : 0, addDays(today, 0)).lastInsertRowid;
        count++;
        const mm = typeof c.image === 'string' && c.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        const ext = mm && extFor(mm[1]);
        if (ext) savedImages.push({ cid, buffer: Buffer.from(mm[2], 'base64'), ext });
      }
    }
    return { moduleId: mid, cards: count };
  })();
  for (const im of savedImages) saveImage(im.cid, im.buffer, im.ext);
  res.json(result);
});

/* ---------- Ошибки ---------- */
app.use('/api', (req, res) => bad(res, 'Не найдено', 404));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Ошибка сервера' });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
export const server = app.listen(PORT, HOST, () => {
  console.log(`Готово: http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});
