import { h, cardsWord } from '../ui.js';
import { api } from '../api.js';

export async function renderSearch({ main, query }) {
  const q = (query.q || '').trim();
  const res = q ? await api.search(q) : [];
  main.append(h('header', { class: 'page-head' }, h('div', null, h('h1', null, `Поиск: «${q}»`), h('p', { class: 'muted' }, res.length ? `Найдено ${cardsWord(res.length)}${res.length === 200 ? ' (показаны первые 200)' : ''}` : 'Ничего не найдено'))));
  const list = h('div', { class: 'results' });
  for (const c of res) {
    list.append(h('a', { class: 'result', href: `#/t/${c.topic_id}` },
      h('div', { class: 'result-main' }, h('b', null, c.term), c.ipa ? h('span', { class: 'ipa' }, ` ${c.ipa}`) : null, h('span', null, ` — ${c.definition}`)),
      h('small', { class: 'muted' }, `${c.module_name} › ${c.topic_name}`)));
  }
  main.append(list);
}
