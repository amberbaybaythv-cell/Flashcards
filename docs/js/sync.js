// Синхронизация между устройствами через приватный репозиторий GitHub.
//
// Облако хранит data.json (модули, темы, блоки, карточки, прогресс, история ответов, «надгробия» удалений)
// и папку images/ (по файлу на картинку, имя = хеш содержимого). Слияние делает чистая функция mergeSnapshots:
// побеждает последняя правка, содержимое карточки и её прогресс сливаются отдельно.
import { bridge } from './store.js';
import { mergeSnapshots, stableSnapshot, emptySnapshot } from './lib/sync-merge.js';
import { GitHubError, repoInfo, getFile, putFile, getBlob, utf8ToB64 } from './lib/github.js';

const KEY = 'sync';
const DATA = 'data.json';
const FORMAT = 'kartochki-sync';
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/* ---------- настройки (в localStorage этого устройства) ---------- */
export function getConfig() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; }
}
function setConfig(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getConfig(), ...patch })); } catch { /* приватный режим */ }
}
export const isConnected = () => { const c = getConfig(); return !!(c.repo && c.token); };

/* ---------- статус ---------- */
const status = { state: 'off', lastSync: null, error: null, skipped: 0 };
function setStatus(patch) {
  Object.assign(status, patch);
  window.dispatchEvent(new CustomEvent('sync-status', { detail: getStatus() }));
}
export const getStatus = () => ({ ...status, state: isConnected() ? (status.state === 'off' ? 'idle' : status.state) : 'off', lastSync: status.lastSync || getConfig().lastSync || null });

/* ---------- вспомогательное ---------- */
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

/** Имя файла картинки: хеш содержимого + расширение. Одинаковые картинки на разных карточках хранятся один раз. */
async function imageRef(dataUrl) {
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[2]));
  const hex = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
  return `${hex}.${ext}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
}

/** Скачивает картинку. Если файла в облаке нет, возвращает null: это не должно останавливать синхронизацию текста и прогресса. */
async function downloadImage(cfg, ref) {
  let blob;
  try { blob = await getBlob(cfg.token, cfg.repo, `images/${ref}`); }
  catch (e) { if (e instanceof GitHubError && e.status === 404) return null; throw e; }
  const mime = MIME[ref.split('.').pop()] || 'image/jpeg';
  return blobToDataUrl(new Blob([await blob.arrayBuffer()], { type: mime }));
}

async function uploadImage(cfg, ref, dataUrl) {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  try { await putFile(cfg.token, cfg.repo, `images/${ref}`, payload, { message: 'image' }); }
  catch (e) { if (!(e instanceof GitHubError && (e.status === 422 || e.status === 409))) throw e; /* такой файл уже есть */ }
}

function parseRemote(text) {
  let d;
  try { d = JSON.parse(text); } catch { d = null; }
  if (!d || d.format !== FORMAT) throw new GitHubError(`Файл ${DATA} в репозитории не от этого приложения или повреждён. Используйте пустой репозиторий`, 0);
  const arr = (x) => (Array.isArray(x) ? x : []);
  return { modules: arr(d.modules), topics: arr(d.topics), blocks: arr(d.blocks), cards: arr(d.cards), reviews: arr(d.reviews), tombstones: arr(d.tombstones) };
}

const remoteCounts = (r) => ({ modules: r.modules.length, topics: r.topics.length, cards: r.cards.length });

/* ---------- один проход: забрать → слить → применить → отправить ---------- */
async function cycle({ force }) {
  await bridge.ready();
  const cfg = getConfig();
  const v0 = bridge.version;
  const file = await getFile(cfg.token, cfg.repo, DATA, { etag: !force && !cfg.dirty && cfg.etag ? cfg.etag : undefined });
  if (file.status === 'notmodified') return { stat: null, pushed: false };
  const remote = file.status === 'missing' ? null : parseRemote(file.text);

  const local = bridge.snapshot();
  const known = new Set([...local.modules, ...local.topics, ...local.blocks, ...local.cards].map((x) => x.uid).concat(local.reviews.map((r) => r[0])));
  const refOf = new Map(), byRef = new Map();
  for (const [uid, url] of bridge.cardImages()) {
    const r = await imageRef(url);
    if (r) { refOf.set(uid, r); byRef.set(r, url); }
  }
  // если картинки на этом устройстве нет (например, её не удалось скачать), ссылку из облака не затираем
  const remoteCard = new Map((remote?.cards || []).map((c) => [c.uid, c]));
  for (const c of local.cards) {
    c.image_ref = refOf.get(c.uid) || null;
    const rc = remoteCard.get(c.uid);
    if (!c.image_ref && rc?.image_ref && (rc.updated || 0) >= (c.updated || 0)) c.image_ref = rc.image_ref;
  }

  const merged = mergeSnapshots(local, remote);

  // картинки: сначала скачиваем недостающие, затем выкладываем новые.
  // Если какой-то картинки в облаке нет, пропускаем её: текст, прогресс и остальные картинки всё равно синхронизируются.
  const want = [...new Set(merged.cards.map((c) => c.image_ref).filter((r) => r && !byRef.has(r)))];
  let skipped = 0;
  await pool(want, 4, async (r) => { const url = await downloadImage(cfg, r); if (url) byRef.set(r, url); else skipped++; });

  // выкладываем картинки, которые есть на этом устройстве, но ещё не подтверждены в облаке
  // (в том числе те, чью загрузку раньше прервало: в данных ссылка уже есть, а файла нет)
  const uploaded = new Set(cfg.uploaded || []);
  const fresh = [...new Set(refOf.values())].filter((r) => !uploaded.has(r));
  await pool(fresh, 3, async (r) => { await uploadImage(cfg, r, byRef.get(r)); uploaded.add(r); });

  const stat = await bridge.apply(merged, byRef, known);

  let etag = file.etag ?? null;
  const same = stableSnapshot(merged) === stableSnapshot(remote || emptySnapshot());
  if (!same) {
    const body = JSON.stringify({ format: FORMAT, version: 1, savedAt: Date.now(), ...merged });
    await putFile(cfg.token, cfg.repo, DATA, utf8ToB64(body), { sha: file.sha, message: `Синхронизация ${new Date().toISOString().slice(0, 16)}` });
    etag = null; // при следующей проверке заберём свежую версию целиком
  }
  setConfig({ etag, dirty: bridge.version !== v0, uploaded: [...uploaded].slice(-2000) }); // если во время обмена что-то изменили, нужен ещё один проход
  return { stat, pushed: !same, skipped };
}

let running = false, again = false, timer = null;

export function scheduleSync(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

/** Синхронизировать сейчас. При manual ошибка пробрасывается наружу (для кнопки). */
export async function syncNow({ manual = false, force = false } = {}) {
  if (!isConnected()) return null;
  if (running) { again = true; return null; }
  running = true;
  clearTimeout(timer);
  setStatus({ state: 'syncing', error: null });
  let result = null, failure = null;
  try {
    for (let i = 0; i < 4; i++) {
      try { result = await cycle({ force: force || i > 0 }); break; }
      catch (e) { if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && i < 3) continue; throw e; } // кто-то успел записать раньше: повторяем
    }
    const now = Date.now();
    setConfig({ lastSync: now });
    setStatus({ state: 'idle', lastSync: now, error: null, skipped: result?.skipped ?? status.skipped });
    const s = result?.stat;
    if (s && s.created + s.updated + s.deleted > 0) window.dispatchEvent(new CustomEvent('data-synced', { detail: s }));
  } catch (e) {
    failure = e;
    const offline = e instanceof GitHubError && e.status === 0 && /Нет связи/.test(e.message);
    setStatus({ state: offline ? 'offline' : 'error', error: e.message });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(300); }
    else if (!failure && getConfig().dirty) scheduleSync(1000);
  }
  if (failure && manual) throw failure;
  return result;
}

/* ---------- подключение ---------- */
export function normalizeRepo(input) {
  const s = String(input || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? s : null;
}

let pending = null; // подключение, ожидающее выбора пользователя

/**
 * Проверяет доступ и сверяет данные. Возвращает { ok: true } или { choice: true, local, remote }, если данные есть и тут, и в облаке.
 * Бросает GitHubError с понятным сообщением, если доступ не получился.
 */
export async function connect(repoInput, tokenInput) {
  const repo = normalizeRepo(repoInput), token = String(tokenInput || '').trim();
  if (!repo) throw new GitHubError('Название репозитория в формате «владелец/репозиторий», например ivan/flashcards-data', 0);
  if (!token) throw new GitHubError('Вставьте токен доступа', 0);
  const info = await repoInfo(token, repo);
  if (!info.private) throw new GitHubError('Репозиторий публичный: ваши карточки увидит любой. Сделайте его приватным (Settings → Danger zone → Change visibility)', 0);
  const file = await getFile(token, repo, DATA);
  const remote = file.status === 'ok' ? parseRemote(file.text) : null;
  pending = { repo, token };
  const local = bridge.counts();
  if (remote && remote.cards.length && local.cards) return { choice: true, local, remote: remoteCounts(remote) };
  return finishConnect('merge');
}

/** Завершает подключение: 'merge' — объединить данные, 'replace' — заменить данные устройства облачными. */
export async function finishConnect(choice) {
  if (!pending) throw new GitHubError('Подключение не начато', 0);
  const { repo, token } = pending;
  pending = null;
  if (choice === 'replace') await bridge.reset();
  setConfig({ repo, token, etag: null, dirty: choice !== 'replace', lastSync: null });
  setStatus({ state: 'idle', error: null });
  await syncNow({ manual: true, force: true });
  return { ok: true };
}

export function cancelConnect() { pending = null; }

export function disconnect() {
  clearTimeout(timer);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  setStatus({ state: 'off', error: null, lastSync: null });
}

/* ---------- код и ссылка для подключения другого устройства ---------- */
const toB64Url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function makeCode() {
  const { repo, token } = getConfig();
  if (!repo || !token) return null;
  return `K1.${toB64Url(JSON.stringify({ r: repo, t: token }))}`;
}

export function makeLink() {
  const code = makeCode();
  return code ? `${location.origin}${location.pathname}#/connect?c=${code}` : null;
}

/** Достаёт { repo, token } из кода или из ссылки, в которой он лежит. */
export function parseCode(text) {
  const m = /K1\.([A-Za-z0-9_-]+)/.exec(String(text || ''));
  if (!m) return null;
  try {
    const d = JSON.parse(fromB64Url(m[1]));
    const repo = normalizeRepo(d.r);
    return repo && d.t ? { repo, token: String(d.t) } : null;
  } catch { return null; }
}

/* ---------- запуск ---------- */
let started = false;
export function startSync() {
  if (started) return;
  started = true;
  bridge.onChange = () => { if (isConnected()) { setConfig({ dirty: true }); scheduleSync(); } };
  const check = () => { if (isConnected() && !running) syncNow(); };
  document.addEventListener('visibilitychange', () => {
    if (!isConnected()) return;
    if (document.visibilityState === 'hidden') { if (getConfig().dirty) syncNow(); } // ушли из приложения: отправляем сразу
    else check();
  });
  window.addEventListener('online', check);
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 60_000);
  check();
}
