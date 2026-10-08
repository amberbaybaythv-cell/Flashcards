import { h } from '../ui.js';

const BOX_NAMES = ['Коробка 1', 'Коробка 2', 'Коробка 3', 'Коробка 4', 'Коробка 5'];
const INTERVAL_HINT = ['каждый день', 'раз в 2 дня', 'раз в 4 дня', 'раз в 8 дней', 'раз в 16 дней'];

export function statsBlock({ totals, boxes, activity, hardest }) {
  const max = Math.max(1, ...boxes);
  const maxAct = Math.max(1, ...activity.map((a) => a.n));
  const pct = totals.total ? Math.round((totals.learned / totals.total) * 100) : 0;
  const kpi = (label, value, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', null, value), h('span', { class: 'muted small' }, label));

  return h('div', { class: 'stats' },
    h('div', { class: 'kpis' },
      kpi('всего', totals.total), kpi('новые', totals.fresh), kpi('в процессе', totals.learning),
      kpi(`выучено (${pct}%)`, totals.learned, 'good'), kpi('к повторению', totals.due, totals.due ? 'warn' : '')),
    h('div', { class: 'grid2 stat-cols' },
      h('div', { class: 'panel' }, h('h3', null, 'Коробки Лейтнера'),
        h('div', { class: 'hbars' }, boxes.map((n, i) => h('div', { class: 'hbar' },
          h('span', { class: 'small' }, BOX_NAMES[i], h('small', { class: 'muted' }, ` · ${INTERVAL_HINT[i]}`)),
          h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${(n / max) * 100}%` })),
          h('b', { class: 'small' }, n))))),
      h('div', { class: 'panel' }, h('h3', null, 'Активность за 30 дней'),
        h('div', { class: 'activity', role: 'img', 'aria-label': 'Количество ответов по дням за последние 30 дней' },
          activity.map((a) => h('div', { class: 'act-col', title: `${a.day}: ${a.n} ответов, верных ${a.ok}` },
            h('div', { class: 'act-bar', style: `height:${a.n ? Math.max(6, (a.n / maxAct) * 100) : 2}%` })))),
        h('p', { class: 'muted small' }, `Всего ответов: ${activity.reduce((s, a) => s + a.n, 0)}`))),
    h('div', { class: 'panel' }, h('h3', null, 'Самые трудные карточки'),
      hardest.length ? h('ol', { class: 'hard' }, hardest.map((c) => h('li', null,
        h('span', null, h('b', null, c.term), h('span', { class: 'muted' }, ` — ${c.definition}`)),
        h('span', { class: 'badge err' }, `${c.wrong_count} ошиб.`)))) : h('p', { class: 'muted' }, 'Ошибок пока нет.')));
}
