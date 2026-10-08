import { h, modal, toast, store } from '../ui.js';
import { api } from '../api.js';
import { go } from '../app.js';

const MODES = [
  ['cards', 'Флеш-карточки', 'Переворачивайте карточки и отмечайте «Знаю» / «Не знаю»'],
  ['test', 'Тест с вариантами', '4 варианта ответа, выбор клавишами 1–4'],
  ['type', 'Ввод ответа', 'Напечатайте ответ — опечатка в 1 букву допускается'],
  ['match', 'Сопоставление', 'Игра на время: соедините пары термин ↔ определение'],
];

/** Окно запуска обучения для темы, модуля или всех карточек. */
export function openStudyLauncher({ scope, id, title }) {
  const saved = store.get('launcher', { mode: 'cards', dir: 'td', filter: 'all' });
  const radio = (name, value, label, desc, checked) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name, value, checked }),
    h('span', null, h('b', null, label), desc && h('small', { class: 'muted' }, desc)));

  modal(`Учить: ${title}`, (close) => {
    const form = h('form', { class: 'stack', onSubmit: async (e) => {
      e.preventDefault();
      const v = (n) => form.elements[n].value;
      const mode = v('mode'), dir = v('dir'), filter = v('filter');
      store.set('launcher', { mode, dir, filter });
      try {
        const { cards } = await api.study({ scope, id, filter });
        if (!cards.length) {
          toast(filter === 'due' ? 'На сегодня нет карточек к повторению 🎉' : filter === 'unlearned' ? 'Все карточки уже выучены 🎉' : 'Здесь пока нет карточек', 'info');
          return;
        }
      } catch (err) { toast(err.message, 'error'); return; }
      close();
      go(`#/study?${new URLSearchParams({ mode, dir, filter, scope, id, title })}`);
    } },
      h('fieldset', null, h('legend', null, 'Режим'), ...MODES.map(([v, l, d]) => radio('mode', v, l, d, saved.mode === v))),
      h('fieldset', { id: 'dir-set' }, h('legend', null, 'Направление'),
        radio('dir', 'td', 'Термин → определение', '', saved.dir === 'td'),
        radio('dir', 'dt', 'Определение → термин', '', saved.dir === 'dt'),
        radio('dir', 'mix', 'Вперемешку', '', saved.dir === 'mix')),
      h('fieldset', null, h('legend', null, 'Какие карточки'),
        radio('filter', 'all', 'Все', '', saved.filter === 'all'),
        radio('filter', 'due', 'Повторение на сегодня', 'Только те, у кого подошёл срок по системе Лейтнера', saved.filter === 'due'),
        radio('filter', 'unlearned', 'Только невыученные', '', saved.filter === 'unlearned')),
      h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onClick: close }, 'Отмена'), h('button', { class: 'btn primary', type: 'submit' }, 'Начать')));
    const syncDir = () => { form.querySelector('#dir-set').hidden = form.elements.mode.value === 'match'; };
    form.addEventListener('change', syncDir); syncDir();
    return form;
  });
}
