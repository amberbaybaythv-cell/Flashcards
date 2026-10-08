// Транскрипция (IPA) и ассоциативные картинки + фоновая очередь.
import fs from 'node:fs';
import path from 'node:path';
import { db, IMAGES_DIR, ROOT } from './db.js';

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env необязателен */ }

const env = () => process.env;
export const imageProviderName = () => (env().IMAGE_PROVIDER || 'pollinations').toLowerCase();

async function timedFetch(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const extFor = (type) => EXT[(type || '').split(';')[0].trim().toLowerCase()];

/* ---------- IPA ---------- */
export async function lookupIpa(term) {
  const word = term.trim();
  if (!word || /[\d]/.test(word) || word.length > 60) return null;
  const res = await timedFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {}, 8000);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Словарь вернул ${res.status}`);
  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) return null;
  const text = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text;
  return text || null;
}

/** Подтягивает IPA для карточки. Бросает ошибку при сетевом сбое (тогда карточка не помечается как «пробовали»). */
export async function enrichIpa(cardId) {
  const card = db.prepare(`SELECT c.*, m.term_lang FROM cards c JOIN topics t ON t.id=c.topic_id JOIN modules m ON m.id=t.module_id WHERE c.id=?`).get(cardId);
  if (!card) return null;
  if (card.term_lang !== 'en') return card;
  const ipa = await lookupIpa(card.term);
  db.prepare('UPDATE cards SET ipa=?, ipa_tried=1 WHERE id=?').run(ipa, cardId);
  return db.prepare('SELECT * FROM cards WHERE id=?').get(cardId);
}

/* ---------- Картинки ---------- */
export function buildPrompt(term, definition) {
  const def = String(definition).replace(/\s+/g, ' ').slice(0, 200);
  return `A simple, clear, friendly illustration that helps remember the word "${term}" (meaning: ${def}). Flat colorful style, no text, no letters, no captions in the image.`;
}

const providers = {
  async pollinations(prompt) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    const headers = env().POLLINATIONS_TOKEN ? { Authorization: `Bearer ${env().POLLINATIONS_TOKEN}` } : {};
    const res = await timedFetch(url, { headers }, 60000);
    if (!res.ok) throw new Error(`Pollinations вернул ${res.status}`);
    const ext = extFor(res.headers.get('content-type'));
    if (!ext) throw new Error('Pollinations вернул не изображение');
    return { buffer: Buffer.from(await res.arrayBuffer()), ext };
  },
  async openai(prompt) {
    if (!env().OPENAI_API_KEY) throw new Error('Не задан OPENAI_API_KEY в .env');
    const res = await timedFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env().OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env().OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    }, 120000);
    if (!res.ok) throw new Error(`OpenAI вернул ${res.status}`);
    const json = await res.json();
    const item = json.data?.[0];
    if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), ext: 'png' };
    if (item?.url) {
      const r = await timedFetch(item.url, {}, 60000);
      return { buffer: Buffer.from(await r.arrayBuffer()), ext: extFor(r.headers.get('content-type')) || 'png' };
    }
    throw new Error('OpenAI не вернул изображение');
  },
};

export function removeImageFile(name) {
  if (!name) return;
  const file = path.join(IMAGES_DIR, path.basename(name));
  fs.rm(file, { force: true }, () => {});
}

export function saveImage(cardId, buffer, ext) {
  const name = `${cardId}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, name), buffer);
  const old = db.prepare('SELECT image FROM cards WHERE id=?').get(cardId)?.image;
  db.prepare('UPDATE cards SET image=? WHERE id=?').run(name, cardId);
  if (old && old !== name) removeImageFile(old);
  return name;
}

export async function enrichImage(cardId) {
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(cardId);
  if (!card) return null;
  const gen = providers[imageProviderName()];
  if (!gen) throw new Error(`Неизвестный провайдер картинок: ${imageProviderName()}`);
  const { buffer, ext } = await gen(buildPrompt(card.term, card.definition));
  saveImage(cardId, buffer, ext);
  return db.prepare('SELECT * FROM cards WHERE id=?').get(cardId);
}

/* ---------- Фоновая очередь ---------- */
const q = { jobs: [], running: 0, total: 0, done: 0, failed: 0, lastError: null };
const CONCURRENCY = 2;

export function enqueue(jobs) {
  if (q.jobs.length === 0 && q.running === 0) Object.assign(q, { total: 0, done: 0, failed: 0, lastError: null });
  q.jobs.push(...jobs);
  q.total += jobs.length;
  pump();
}

function pump() {
  while (q.running < CONCURRENCY && q.jobs.length) {
    const job = q.jobs.shift();
    q.running++;
    (job.type === 'ipa' ? enrichIpa(job.cardId) : enrichImage(job.cardId))
      .then(() => { q.done++; })
      .catch((e) => { q.failed++; q.lastError = e.name === 'AbortError' ? 'Превышено время ожидания' : e.message; })
      .finally(() => { q.running--; pump(); });
  }
}

export const queueStatus = () => ({
  active: q.jobs.length + q.running > 0,
  total: q.total, done: q.done, failed: q.failed, lastError: q.lastError,
});
