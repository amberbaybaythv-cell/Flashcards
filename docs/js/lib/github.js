// Минимальный клиент GitHub API: чтение и запись файлов в репозитории (Contents API). Запросы идут из браузера.
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export const utf8ToB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

async function call(token, path, { method = 'GET', body, accept = 'application/vnd.github+json', etag } = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (body) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-None-Match'] = etag;
  try {
    return await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new GitHubError('Нет связи с GitHub: проверьте интернет', 0);
  }
}

function fail(res, what) {
  if (res.status === 401) throw new GitHubError('Токен недействителен или срок его действия истёк. Создайте новый токен на github.com', 401);
  if (res.status === 403 || res.status === 429) throw new GitHubError(res.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub временно ограничил запросы, попробуйте через несколько минут' : `GitHub отказал в доступе (${what}). Проверьте права токена: «Contents: Read and write»`, res.status);
  if (res.status === 404) throw new GitHubError('Репозиторий не найден. Проверьте название (владелец/репозиторий) и что токен выдан именно для него', 404);
  throw new GitHubError(`GitHub вернул ошибку ${res.status} (${what})`, res.status);
}

/** Проверяет, что репозиторий виден токену и в него можно писать. */
export async function repoInfo(token, repo) {
  const res = await call(token, `/repos/${repo}`);
  if (!res.ok) fail(res, 'репозиторий');
  const j = await res.json();
  if (j.permissions && !j.permissions.push) throw new GitHubError('У токена нет права записи в этот репозиторий. Нужно «Contents: Read and write»', 403);
  return { private: !!j.private, name: j.full_name };
}

/** Читает текстовый файл. Возвращает { status: 'ok'|'missing'|'notmodified', sha, text, etag }. */
export async function getFile(token, repo, path, { etag } = {}) {
  const res = await call(token, `/repos/${repo}/contents/${enc(path)}`, { etag });
  if (res.status === 304) return { status: 'notmodified' };
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) fail(res, path);
  const j = await res.json();
  let text;
  if (j.encoding === 'base64' && j.content && j.size <= 900_000) text = b64ToUtf8(j.content);
  else { // большие файлы GitHub отдаёт без содержимого: берём «сырой» вариант
    const raw = await call(token, `/repos/${repo}/contents/${enc(path)}`, { accept: 'application/vnd.github.raw+json' });
    if (!raw.ok) fail(raw, path);
    text = await raw.text();
  }
  return { status: 'ok', sha: j.sha, text, etag: res.headers.get('etag') };
}

/** Записывает файл (content — уже в base64). Бросает GitHubError со status 409/422 при конфликте версий. */
export async function putFile(token, repo, path, contentB64, { sha, message = 'sync' } = {}) {
  const res = await call(token, `/repos/${repo}/contents/${enc(path)}`, { method: 'PUT', body: { message, content: contentB64, ...(sha ? { sha } : {}) } });
  if (res.status === 409 || res.status === 422) throw new GitHubError('Файл изменился на другом устройстве', res.status);
  if (!res.ok) fail(res, path);
  return (await res.json()).content?.sha;
}

/** Скачивает двоичный файл (картинку). */
export async function getBlob(token, repo, path) {
  const res = await call(token, `/repos/${repo}/contents/${enc(path)}`, { accept: 'application/vnd.github.raw+json' });
  if (res.status === 404) throw new GitHubError(`В облаке не нашлась картинка ${path}`, 404);
  if (!res.ok) fail(res, path);
  return res.blob();
}
