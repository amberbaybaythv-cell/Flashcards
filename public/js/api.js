async function req(method, url, body, raw) {
  const opts = { method, headers: {} };
  if (raw) { opts.body = raw; opts.headers['Content-Type'] = raw.type; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(url, opts); }
  catch { throw new Error('Нет связи с сервером. Запущен ли npm start?'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
const qs = (o) => '?' + new URLSearchParams(o).toString();

export const api = {
  tree: () => req('GET', '/api/tree'),
  config: () => req('GET', '/api/config'),
  module: (id) => req('GET', `/api/modules/${id}`),
  moduleCards: (id) => req('GET', `/api/modules/${id}/cards`),
  addModule: (b) => req('POST', '/api/modules', b),
  editModule: (id, b) => req('PUT', `/api/modules/${id}`, b),
  delModule: (id) => req('DELETE', `/api/modules/${id}`),
  topic: (id) => req('GET', `/api/topics/${id}`),
  addTopic: (mid, name) => req('POST', `/api/modules/${mid}/topics`, { name }),
  editTopic: (id, name) => req('PUT', `/api/topics/${id}`, { name }),
  delTopic: (id) => req('DELETE', `/api/topics/${id}`),
  cards: (tid) => req('GET', `/api/topics/${tid}/cards`),
  addCard: (tid, b) => req('POST', `/api/topics/${tid}/cards`, b),
  bulk: (tid, cards) => req('POST', `/api/topics/${tid}/cards/bulk`, { cards }),
  editCard: (id, b) => req('PUT', `/api/cards/${id}`, b),
  delCard: (id) => req('DELETE', `/api/cards/${id}`),
  fetchIpa: (id) => req('POST', `/api/cards/${id}/ipa`),
  genImage: (id) => req('POST', `/api/cards/${id}/image/generate`),
  uploadImage: (id, file) => req('PUT', `/api/cards/${id}/image`, undefined, file),
  delImage: (id) => req('DELETE', `/api/cards/${id}/image`),
  enrich: (b) => req('POST', '/api/enrich', b),
  queue: () => req('GET', '/api/queue'),
  study: (p) => req('GET', '/api/study' + qs(p)),
  answers: (answers) => req('POST', '/api/answers', { answers }),
  stats: (scope, id) => req('GET', '/api/stats' + qs({ scope, id: id ?? 0 })),
  search: (q) => req('GET', '/api/search' + qs({ q })),
  importModule: (data) => req('POST', '/api/import/module', data),
};
