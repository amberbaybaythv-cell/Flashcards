// Поиск настоящих фото в Википедии и на Wikimedia Commons (без ключей, запросы идут из браузера).
// Фото берутся из «шапки» статьи Википедии: для конкретных слов это самый аутентичный вариант.
import { timedFetch } from './enrich.js';

const params = (o) => new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...o });

async function call(host, p) {
  const res = await timedFetch(`https://${host}/w/api.php?${params(p)}`, {}, 12000);
  if (!res.ok) throw new Error(`${host} вернул ${res.status}`);
  return res.json();
}

const text = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
const creditText = (ex = {}) => [text(ex.Artist?.value), text(ex.LicenseShortName?.value)].filter(Boolean).join(', ');
const byIndex = (a, b) => (a.index ?? 0) - (b.index ?? 0);

/* ---------- Википедия: фото из статьи ---------- */
const PAGE = { prop: 'pageimages|info', piprop: 'thumbnail|name', pithumbsize: '640', inprop: 'url' };

function wikiCandidates(data, lang, exact) {
  return (data.query?.pages || []).filter((p) => p.thumbnail?.source && p.pageimage).sort(byIndex).map((p) => ({
    id: `w:${lang}:${p.pageimage}`, kind: 'wiki', exact, thumb: p.thumbnail.source, file: p.pageimage,
    label: p.title, source: `Википедия (${lang})`, pageUrl: p.fullurl,
  }));
}

export async function wikipediaImages(lang, query) {
  const host = `${lang}.wikipedia.org`;
  const [direct, search] = await Promise.all([
    call(host, { action: 'query', redirects: '1', titles: query, ...PAGE }), // статья с точно таким названием
    call(host, { action: 'query', generator: 'search', gsrsearch: query, gsrlimit: '6', ...PAGE }),
  ]);
  return [...wikiCandidates(direct, lang, true), ...wikiCandidates(search, lang, false)];
}

/* ---------- Wikimedia Commons ---------- */
export async function commonsImages(query) {
  const d = await call('commons.wikimedia.org', {
    action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '640',
  });
  return (d.query?.pages || []).sort(byIndex).flatMap((p) => {
    const i = p.imageinfo?.[0];
    if (!i || !/^image\/(jpeg|png|webp)$/.test(i.mime) || (i.width || 0) < 300) return [];
    return [{
      id: `c:${p.title}`, kind: 'commons', exact: false, thumb: i.thumburl || i.url, file: p.title.replace(/^File:/, ''),
      label: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '), source: 'Wikimedia Commons',
      pageUrl: i.descriptionurl, credit: creditText(i.extmetadata),
    }];
  });
}

async function fileCredit(file) {
  const d = await call('commons.wikimedia.org', { action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'extmetadata|url' });
  const i = d.query?.pages?.[0]?.imageinfo?.[0];
  return i ? { text: creditText(i.extmetadata), url: i.descriptionurl } : null;
}

/* ---------- Подбор запроса по карточке ---------- */
const tidy = (s) => String(s).replace(/\(.*?\)/g, ' ').replace(/^(to|a|an|the)\s+/i, '').replace(/\s+/g, ' ').trim();
const isShort = (s) => s.length > 0 && s.length <= 32 && s.split(/\s+/).length <= 3;

/**
 * Если определение короткое (перевод в одно-два слова), ищем по нему в Википедии на его языке:
 * так «apple — яблоко» находит статью про фрукт, а не про компанию.
 */
export function buildQueries(card, mod) {
  const list = [];
  const def = tidy(card.definition.split(/[\/;,]/)[0]);
  const term = tidy(card.term);
  if (isShort(def)) list.push({ lang: mod.def_lang, q: def });
  if (term && !list.some((x) => x.lang === mod.term_lang && x.q.toLowerCase() === term.toLowerCase())) list.push({ lang: mod.term_lang, q: term });
  const commons = mod.term_lang === 'en' ? term : mod.def_lang === 'en' && isShort(def) ? def : term;
  return { wiki: list, commons };
}

/** Кандидаты для выбора. Сначала фото из статей с точным названием, потом остальные статьи, потом Commons. */
export async function searchStock(card, mod, { query, lang } = {}) {
  const plan = query ? { wiki: [{ lang: lang || mod.term_lang, q: query }], commons: query } : buildQueries(card, mod);
  const out = [], seen = new Set(), errors = [];
  const add = (c) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } };
  for (const { lang: l, q } of plan.wiki) {
    try { (await wikipediaImages(l, q)).forEach(add); } catch (e) { errors.push(e); }
  }
  out.sort((a, b) => Number(b.exact) - Number(a.exact)); // сортировка устойчивая: порядок запросов сохраняется
  try { (await commonsImages(plan.commons)).forEach(add); } catch (e) { errors.push(e); }
  if (!out.length && errors.length) throw errors[0];
  return out;
}

/** Скачивает выбранную картинку и возвращает { blob, credit }. */
export async function downloadStock(cand) {
  const res = await timedFetch(cand.thumb, {}, 30000);
  if (!res.ok) throw new Error(`Не удалось скачать картинку (${res.status})`);
  const blob = await res.blob();
  let credit = cand.credit ? { text: cand.credit, url: cand.pageUrl } : null;
  if (!credit && cand.kind === 'wiki') {
    try { credit = await fileCredit(cand.file); } catch { /* лицензию не удалось уточнить — оставим ссылку на статью */ }
  }
  return { blob, credit: { text: credit?.text || '', url: credit?.url || cand.pageUrl, source: cand.source } };
}
