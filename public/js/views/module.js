import { h, confirmDialog, toast, cardsWord, download } from '../ui.js';
import { api } from '../api.js';
import { findModule, refreshTree, go, openModuleForm, openTopicForm } from '../app.js';
import { openStudyLauncher } from './launcher.js';
import { statsBlock } from './stats.js';

const LANG = { en: 'Английский', ru: 'Русский' };

export async function renderModule({ main, id }) {
  const m = findModule(id);
  if (!m) { main.append(h('div', { class: 'empty' }, h('h2', null, 'Модуль не найден'), h('a', { href: '#/', class: 'btn' }, 'На главную'))); return; }

  main.append(
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, m.name),
        h('p', { class: 'muted' }, `${LANG[m.term_lang]} → ${LANG[m.def_lang]} · ${m.topics.length} тем · ${cardsWord(m.total)}`),
        m.description ? h('p', null, m.description) : null),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', disabled: !m.total, onClick: () => openStudyLauncher({ scope: 'module', id: m.id, title: m.name }) },
          m.due ? `Учить модуль · ${m.due} к повторению` : 'Учить модуль'),
        h('button', { class: 'btn', onClick: () => openTopicForm(m.id) }, '+ Тема'),
        h('button', { class: 'btn', onClick: () => openModuleForm(m) }, 'Настройки'),
        h('button', { class: 'btn', onClick: () => download(`/api/modules/${m.id}/export.json`) }, 'Экспорт JSON'),
        h('button', { class: 'btn', onClick: () => download(`/api/modules/${m.id}/export.txt`) }, 'Экспорт текст'),
        h('button', { class: 'btn danger-ghost', onClick: async () => {
          if (!(await confirmDialog(`Удалить модуль «${m.name}» вместе со всеми темами и карточками (${m.total})? Это нельзя отменить.`))) return;
          try { await api.delModule(m.id); await refreshTree(); toast('Модуль удалён'); go('#/'); } catch (e) { toast(e.message, 'error'); }
        } }, 'Удалить'))));

  if (!m.topics.length) {
    main.append(h('div', { class: 'empty' }, h('h2', null, 'В модуле пока нет тем'),
      h('button', { class: 'btn primary', onClick: () => openTopicForm(m.id) }, '+ Создать тему')));
  } else {
    const list = h('div', { class: 'grid cards-grid' });
    for (const t of m.topics) {
      list.append(h('article', { class: 'tile' },
        h('h3', null, h('a', { href: `#/t/${t.id}` }, t.name)),
        h('p', { class: 'small muted' }, `${cardsWord(t.total)} · выучено ${t.learned}`),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn primary grow', disabled: !t.total, onClick: () => openStudyLauncher({ scope: 'topic', id: t.id, title: t.name }) }, t.due ? `Учить · ${t.due}` : 'Учить'),
          h('a', { class: 'btn', href: `#/t/${t.id}` }, 'Открыть'))));
    }
    main.append(list);
  }

  if (m.total) main.append(h('section', { class: 'section' }, h('h2', null, 'Статистика модуля'), statsBlock(await api.stats('module', m.id))));
}
