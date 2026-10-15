import { h, fold } from '../ui.js';

const BOX_NAMES = ['Коробка 1', 'Коробка 2', 'Коробка 3', 'Коробка 4', 'Коробка 5'];
const INTERVAL_HINT = ['каждый день', 'раз в 2 дня', 'раз в 4 дня', 'раз в 8 дней', 'раз в 16 дней'];

export function statsBlock({ totals, boxes, activity, hardest, blocks }, { onBlock } = {}) {
  const max = Math.max(1, ...boxes);
  const maxAct = Math.max(1, ...activity.map((a) => a.n));
  const pct = totals.total ? Math.round((totals.learned / totals.total) * 100) : 0;
  const kpi = (label, value, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', null, value), h('span', { class: 'muted small' }, label));

  return h('div', { class: 'stats' },
    h('div', { class: 'kpis' },
      kpi('всего', totals.total), kpi('новые', totals.fresh), kpi('в процессе', totals.learning),
      kpi(`выучено (${pct}%)`, totals.learned, 'good'), kpi('к повторению', totals.due, totals.due ? 'warn' : '')),
    h('div', { class: 'grid2 stat-cols' },
      fold('Коробки Лейтнера',
        h('div', { class: 'hbars' }, boxes.map((n, i) => h('div', { class: 'hbar' },
          h('span', { class: 'small' }, BOX_NAMES[i], h('small', { class: 'muted' }, ` · ${INTERVAL_HINT[i]}`)),
          h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${(n / max) * 100}%` })),
          h('b', { class: 'small' }, n)))),
        { key: 'boxes', open: true, cls: 'panel' }),
      fold('Активность за 30 дней',
        [h('div', { class: 'activity', role: 'img', 'aria-label': 'Количество ответов по дням за последние 30 дней' },
          activity.map((a) => h('div', { class: 'act-col', title: `${a.day}: ${a.n} ответов, верных ${a.ok}` },
            h('div', { class: 'act-bar', style: `height:${a.n ? Math.max(6, (a.n / maxAct) * 100) : 2}%` })))),
        h('p', { class: 'muted small' }, `Всего ответов: ${activity.reduce((s, a) => s + a.n, 0)}`)],
        { key: 'activity', open: true, cls: 'panel' })),
    fold('Самые трудные карточки',
      hardest.length ? h('ol', { class: 'hard' }, hardest.map((c) => h('li', null,
        h('span', null, h('b', null, c.term), h('span', { class: 'muted' }, ` — ${c.definition}`)),
        h('span', { class: 'badge err' }, `${c.wrong_count} ошиб.`)))) : h('p', { class: 'muted' }, 'Ошибок пока нет.'),
      { key: 'hardest', open: true, cls: 'panel' }),
    blocks?.length ? fold('По блокам', blocksTable(blocks, onBlock), { key: 'blocks', open: true, cls: 'panel' }) : null);
}

/** Статистика по каждому блоку темы: сколько карточек, выучено, к повторению и разбивка по коробкам Лейтнера. */
function blocksTable(blocks, onBlock) {
  return h('div', { class: 'blk-table' },
    blocks.map((b) => {
      const pct = b.total ? Math.round((b.learned / b.total) * 100) : 0;
      const name = onBlock ? h('button', { class: 'linklike', type: 'button', title: 'Показать карточки этого блока', onClick: () => onBlock(b.id == null ? 'none' : b.id) }, b.name) : h('b', null, b.name);
      return h('div', { class: 'blk-row' },
        h('div', { class: 'blk-head' }, name,
          h('span', { class: 'small muted' }, `${b.total} карт. · выучено ${pct}%`),
          b.due ? h('span', { class: 'badge' }, `${b.due} к повторению`) : h('span', { class: 'small muted' }, 'всё повторено')),
        h('div', { class: 'stack-bar', role: 'img', 'aria-label': `Карточки блока по коробкам: ${b.boxes.join(', ')}` },
          b.boxes.map((n, i) => (n ? h('span', { class: `seg b${i + 1}`, style: `flex:${n}`, title: `Коробка ${i + 1}: ${n}` }) : null))));
    }),
    h('p', { class: 'muted small' }, 'Цвета полосы: коробки Лейтнера от 1 (красный) до 5 (зелёный).'));
}

/** Весь раздел статистики одним сворачиваемым блоком (по умолчанию закрыт, чтобы страница не пестрила). */
export function statsSection(title, key, data, opts) {
  return fold(title, statsBlock(data, opts), { key: `stats:${key}`, open: false, level: 'h2', cls: 'section-fold' });
}
