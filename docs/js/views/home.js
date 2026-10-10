import { h } from '../ui.js';
import { api } from '../api.js';
import { state, openModuleForm, openTopicForm, refreshTree, render } from '../app.js';
import { openStudyLauncher } from './launcher.js';
import { cardsWord } from '../ui.js';
import { statsSection } from './stats.js';

export async function renderHome({ main }) {
  const modules = state.tree.modules;
  const totalDue = modules.reduce((a, m) => a + m.due, 0);
  const totalCards = modules.reduce((a, m) => a + m.total, 0);

  main.append(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Главная'), h('p', { class: 'muted' }, totalCards ? `Всего ${cardsWord(totalCards)}` : 'Создайте модуль и добавьте первые карточки')),
    totalCards ? h('button', { class: 'btn primary', disabled: !totalDue, onClick: () => openStudyLauncher({ scope: 'all', id: 0, title: 'всё на сегодня' }) },
      totalDue ? `Повторить сегодня · ${totalDue}` : 'На сегодня всё повторено ✓') : null));

  if (!modules.length) {
    main.append(h('div', { class: 'empty' }, h('h2', null, 'Пока пусто'),
      h('p', { class: 'muted' }, 'Модуль — это набор тем, например «English B2». В теме вы вставляете сплошной текст «слово - перевод», и карточки готовы.'),
      h('div', { class: 'row gap center-row wrap' },
        h('button', { class: 'btn primary', onClick: () => openModuleForm() }, '+ Создать модуль'),
        h('button', { class: 'btn', onClick: async () => { await api.loadDemo(); await refreshTree(); render(); } }, 'Загрузить демо-модуль'))));
    return;
  }

  const grid = h('div', { class: 'grid cards-grid' });
  for (const m of modules) {
    const pct = m.total ? Math.round((m.learned / m.total) * 100) : 0;
    grid.append(h('article', { class: 'tile' },
      h('h3', null, h('a', { href: `#/m/${m.id}` }, m.name)),
      m.description ? h('p', { class: 'muted small' }, m.description) : null,
      h('p', { class: 'small muted' }, `${m.topics.length} тем · ${cardsWord(m.total)}`),
      h('div', { class: 'bar', title: `Выучено ${pct}%` }, h('div', { class: 'bar-fill', style: `width:${pct}%` })),
      h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `Выучено ${pct}%`), m.due ? h('span', { class: 'badge' }, `${m.due} к повторению`) : h('span', { class: 'muted' }, 'всё повторено')),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary grow', disabled: !m.total, onClick: () => openStudyLauncher({ scope: 'module', id: m.id, title: m.name }) }, 'Учить'),
        h('button', { class: 'btn', onClick: () => openTopicForm(m.id) }, '+ Тема'))));
  }
  main.append(grid);

  if (totalCards) {
    const last = (() => { try { return localStorage.getItem('lastBackup'); } catch { return null; } })();
    const old = !last || (Date.now() - new Date(last).getTime()) / 864e5 > 30;
    if (old) {
      main.append(h('p', { class: 'panel small', style: 'margin-top:16px' }, last ? `Последняя резервная копия была ${last}. ` : 'Резервная копия ещё не делалась. ',
        h('a', { href: '#/settings' }, 'Сделать копию'), ' — данные хранятся только на этом устройстве.'));
    }
    main.append(statsSection('Статистика', 'home', await api.stats('all', 0)));
  }
}
