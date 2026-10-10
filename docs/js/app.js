import { api } from './api.js';
import { h, $, clear, toast, modal, field, cardsWord, store, confirmDialog } from './ui.js';
import { renderHome } from './views/home.js';
import { renderModule } from './views/module.js';
import { renderTopic } from './views/topic.js';
import { renderSearch } from './views/search.js';
import { renderStudy } from './views/study.js';
import { renderSettings } from './views/settings.js';
import { openImportModule } from './views/importer.js';

export const state = { tree: { modules: [] }, config: {} };
let cleanup = null;

/* ---------- Тема ---------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; }

export const ACCENTS = [
  { id: 'violet', name: 'Фиолетовый', color: '#4f46e5', meta: '#4f46e5' },
  { id: 'sand', name: 'Песочный', color: '#EED9C4', meta: '#EED9C4' },
  { id: 'wood', name: 'Старое дерево', color: '#9E7655', meta: '#9E7655' },
  { id: 'espresso', name: 'Эспрессо', color: '#644736', meta: '#644736' },
];
export const currentAccent = () => (ACCENTS.some((a) => a.id === store.get('accent', 'violet')) ? store.get('accent', 'violet') : 'violet');
export function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  document.documentElement.dataset.accent = a.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.meta);
  store.set('accent', a.id);
}
applyAccent(currentAccent());
applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

/* ---------- Данные ---------- */
export async function refreshTree() {
  state.tree = await api.tree();
  renderSidebar();
}
export const findModule = (id) => state.tree.modules.find((m) => m.id === Number(id));

/* ---------- Роутинг ---------- */
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  return { parts: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q)) };
}
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

export async function render() {
  const { parts, query } = parseHash();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const main = clear($('#main'));
  document.body.classList.remove('menu-open');
  document.body.classList.toggle('studying', parts[0] === 'study');
  try {
    const ctx = { main, query, id: Number(parts[1]) };
    let res;
    if (!parts.length) res = renderHome(ctx);
    else if (parts[0] === 'm') res = renderModule(ctx);
    else if (parts[0] === 't') res = renderTopic(ctx);
    else if (parts[0] === 'search') res = renderSearch(ctx);
    else if (parts[0] === 'study') res = renderStudy(ctx);
    else if (parts[0] === 'settings') res = renderSettings(ctx);
    else main.append(h('p', { class: 'muted' }, 'Страница не найдена'));
    const out = await res;
    cleanup = typeof out === 'function' ? out : null;
  } catch (e) {
    clear(main).append(h('div', { class: 'empty' }, h('h2', null, 'Что-то пошло не так'), h('p', { class: 'muted' }, e.message)));
  }
  renderSidebar();
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

/* ---------- Боковая панель ---------- */
const expanded = new Set(store.get('expanded', []));
const saveExpanded = () => store.set('expanded', [...expanded]);

export function openModuleForm(m) {
  modal(m ? 'Настройки модуля' : 'Новый модуль', (close) => {
    const name = h('input', { type: 'text', value: m?.name || '', placeholder: 'Например, English B2', maxlength: 120, required: true });
    const desc = h('textarea', { rows: 2, placeholder: 'Необязательно' }, m?.description || '');
    const langSel = (v) => h('select', null, h('option', { value: 'en', selected: v === 'en' }, 'Английский'), h('option', { value: 'ru', selected: v === 'ru' }, 'Русский'));
    const tl = langSel(m?.term_lang || 'en'), dl = langSel(m?.def_lang || 'ru');
    const form = h('form', { class: 'stack', onSubmit: async (e) => {
      e.preventDefault();
      try {
        const body = { name: name.value, description: desc.value, term_lang: tl.value, def_lang: dl.value };
        const saved = m ? await api.editModule(m.id, body) : await api.addModule(body);
        close();
        await refreshTree();
        go(`#/m/${saved.id}`);
        if (m) render();
      } catch (err) { toast(err.message, 'error'); }
    } },
      field('Название', name), field('Описание', desc),
      h('div', { class: 'grid2' }, field('Язык терминов', tl, 'Для озвучки и транскрипции'), field('Язык определений', dl)),
      h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onClick: close }, 'Отмена'), h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить')));
    if (!m) return form;
    return h('div', { class: 'stack' }, form,
      h('div', { class: 'stack actions-box' },
        h('h3', null, 'Действия с модулем'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn', onClick: () => { close(); openTopicForm(m.id); } }, '+ Тема'),
          h('button', { class: 'btn', onClick: () => api.downloadModule(m.id, 'json') }, 'Экспорт JSON'),
          h('button', { class: 'btn', onClick: () => api.downloadModule(m.id, 'txt') }, 'Экспорт текст'),
          h('button', { class: 'btn danger-ghost', onClick: () => deleteModule(m, close) }, 'Удалить модуль'))));
  });
}

async function deleteModule(m, closeSettings) {
  if (!(await confirmDialog(`Удалить модуль «${m.name}» вместе со всеми темами и карточками (${m.total ?? 0})? Это нельзя отменить.`))) return;
  try {
    await api.delModule(m.id);
    closeSettings?.();
    await refreshTree();
    toast('Модуль удалён');
    go('#/');
  } catch (e) { toast(e.message, 'error'); }
}

export function openTopicForm(moduleId, t) {
  modal(t ? 'Переименовать тему' : 'Новая тема', (close) => {
    const name = h('input', { type: 'text', value: t?.name || '', maxlength: 120, required: true, placeholder: 'Например, Глаголы движения' });
    return h('form', { class: 'stack', onSubmit: async (e) => {
      e.preventDefault();
      try {
        const saved = t ? await api.editTopic(t.id, name.value) : await api.addTopic(moduleId, name.value);
        close();
        expanded.add(moduleId); saveExpanded();
        await refreshTree();
        go(`#/t/${saved.id}`);
        if (t) render();
      } catch (err) { toast(err.message, 'error'); }
    } }, field('Название темы', name),
    h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onClick: close }, 'Отмена'), h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить')));
  });
}

function renderSidebar() {
  const sb = clear($('#sidebar'));
  const { parts } = parseHash();
  const search = h('input', { type: 'search', placeholder: 'Поиск по карточкам…', 'aria-label': 'Поиск', value: parts[0] === 'search' ? parseHash().query.q || '' : '' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = search.value.trim();
      if (q) history.replaceState(null, '', `#/search?q=${encodeURIComponent(q)}`), render();
      else if (parseHash().parts[0] === 'search') go('#/');
    }, 200);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const q = search.value.trim(); if (q) go(`#/search?q=${encodeURIComponent(q)}`); } });

  const activeMod = parts[0] === 'm' ? Number(parts[1]) : parts[0] === 't' ? state.tree.modules.find((m) => m.topics.some((t) => t.id === Number(parts[1])))?.id : null;
  if (activeMod) expanded.add(activeMod);

  const tree = h('nav', { class: 'tree', 'aria-label': 'Модули и темы' });
  if (!state.tree.modules.length) tree.append(h('p', { class: 'muted small pad' }, 'Пока нет модулей. Создайте первый.'));
  for (const m of state.tree.modules) {
    const open = expanded.has(m.id);
    const toggle = h('button', { class: 'tree-toggle' + (open ? ' open' : ''), 'aria-label': open ? 'Свернуть' : 'Развернуть', 'aria-expanded': String(open), onClick: () => { open ? expanded.delete(m.id) : expanded.add(m.id); saveExpanded(); renderSidebar(); } }, '▸');
    tree.append(h('div', { class: 'tree-row module' + (parts[0] === 'm' && Number(parts[1]) === m.id ? ' active' : '') },
      toggle,
      h('a', { href: `#/m/${m.id}`, class: 'tree-link' }, m.name),
      m.due ? h('span', { class: 'badge', title: 'К повторению сегодня' }, m.due) : null));
    if (open) {
      for (const t of m.topics) {
        tree.append(h('div', { class: 'tree-row topic' + (parts[0] === 't' && Number(parts[1]) === t.id ? ' active' : '') },
          h('a', { href: `#/t/${t.id}`, class: 'tree-link' }, t.name),
          h('span', { class: 'count' }, t.total)));
      }
      tree.append(h('button', { class: 'tree-add', onClick: () => openTopicForm(m.id) }, '+ Тема'));
    }
  }

  sb.append(
    h('a', { href: '#/', class: 'brand' }, h('span', { class: 'logo' }, '▤'), 'Карточки'),
    search, tree,
    h('div', { class: 'sidebar-foot' },
      h('button', { class: 'btn primary block', onClick: () => openModuleForm() }, '+ Новый модуль'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn grow', onClick: () => openImportModule() }, 'Импорт'),
        h('a', { class: 'btn', href: '#/settings', 'aria-label': 'Настройки', title: 'Настройки, оформление и резервная копия' }, h('span', { class: 'emoji' }, '⚙️')),
        h('button', { class: 'btn', 'aria-label': 'Сменить тему оформления', title: 'Светлая / тёмная тема', onClick: () => {
          const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
          applyTheme(t); store.set('theme', t);
        } }, h('span', { class: 'emoji' }, '🌓')))));
}

/* ---------- Очередь фоновых задач (IPA / картинки) ---------- */
let queueTimer = null;
export function watchQueue(started = false) {
  if (queueTimer) return;
  const bar = $('#queue-bar');
  let wasActive = started; // started: задачи только что поставлены, могли завершиться до первого опроса
  const tick = async () => {
    let s;
    try { s = await api.queue(); } catch { return; }
    if (!s.active && !wasActive) { // ничего не идёт и не шло в этой сессии
      bar.hidden = true;
      clearInterval(queueTimer); queueTimer = null;
      return;
    }
    const pct = s.total ? Math.round(((s.done + s.failed + (s.missed || 0)) / s.total) * 100) : 0;
    bar.hidden = false;
    clear(bar).append(
      h('span', null, s.active ? `Дополняю карточки: ${s.done + s.failed + (s.missed || 0)} из ${s.total}` : `Готово: ${s.done} из ${s.total}` + (s.missed ? `, не нашлось фото: ${s.missed}` : '') + (s.failed ? `, ошибок: ${s.failed}` : '')),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${pct}%` })),
      s.failed && s.lastError ? h('span', { class: 'small' }, `Ошибка: ${s.lastError}`) : null,
      !s.active ? h('button', { class: 'btn small', onClick: () => { bar.hidden = true; } }, 'Скрыть') : null);
    if (s.active) wasActive = true;
    else {
      wasActive = false;
      if (!s.failed) setTimeout(() => { bar.hidden = true; }, 6000);
      clearInterval(queueTimer); queueTimer = null;
      await refreshTree();
      window.dispatchEvent(new Event('cards-changed'));
    }
  };
  queueTimer = setInterval(tick, 1500);
  tick();
}

/* ---------- Старт ---------- */
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('menu-open'));
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн-режим недоступен, приложение всё равно работает */ });
}
(async () => {
  try {
    [state.config] = await Promise.all([api.config(), refreshTree()]);
    if (state.config.storage && !state.config.storage.persistent) toast('Данные не сохраняются: хранилище браузера недоступно (приватный режим?)', 'error');
  } catch (e) { toast(e.message, 'error'); }
  await render();
  watchQueue();
})();

export { cardsWord };
