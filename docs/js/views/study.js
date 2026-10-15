import { h, clear, shuffle, store, toast } from '../ui.js';
import { api } from '../api.js';
import { go, refreshTree } from '../app.js';
import { runCards } from '../modes/cards.js';
import { runTest } from '../modes/test.js';
import { runType } from '../modes/type.js';
import { runMatch } from '../modes/match.js';
import { speechSupported } from '../lib/speech.js';

const MODES = { cards: [runCards, 'Флеш-карточки'], test: [runTest, 'Тест'], type: [runType, 'Ввод ответа'], match: [runMatch, 'Сопоставление'] };

export async function renderStudy({ main, query }) {
  const { mode = 'cards', dir = 'td', filter = 'all', scope = 'topic', id = 0, title = '', block = 'all' } = query;
  const [run, modeName] = MODES[mode] || MODES.cards;
  const data = await api.study({ scope, id, filter, block });
  const back = scope === 'topic' ? `#/t/${id}` : scope === 'module' ? `#/m/${id}` : '#/';

  const progressFill = h('div', { class: 'bar-fill' });
  const progressText = h('span', { class: 'small muted' });
  const savedText = h('span', { class: 'small saved', title: 'Каждый ответ сохраняется сразу, выйти можно в любой момент' });
  const auto = h('input', { type: 'checkbox', checked: store.get('autoSpeak', false), onChange: () => store.set('autoSpeak', auto.checked) });
  const stage = h('div', { class: 'stage' });
  const shell = h('div', { class: 'study' },
    h('header', { class: 'study-head' },
      h('a', { class: 'btn', href: back, onClick: (e) => { e.preventDefault(); exit(); } }, '← Выйти'),
      h('div', { class: 'grow' }, h('b', null, modeName), h('span', { class: 'muted' }, ` · ${title}`)),
      speechSupported ? h('label', { class: 'check small' }, auto, ' Озвучивать') : null),
    h('div', { class: 'row gap center-row' }, h('div', { class: 'bar grow' }, progressFill), progressText, savedText),
    stage);
  // после клика по кнопке фокус снимаем, чтобы пробел/Enter не нажимали её повторно
  shell.addEventListener('click', (e) => { if (e.target.closest('button')) document.activeElement?.blur(); });
  main.append(shell);

  if (!data.cards.length) {
    stage.append(h('div', { class: 'empty' }, h('h2', null, 'Нет карточек для этого режима'), h('a', { class: 'btn primary', href: back }, 'Назад')));
    return;
  }

  let current = null;

  /* Каждый ответ сохраняется сразу, а не в конце сессии: можно выйти в любой момент и ничего не потеряется. */
  const saved = new Set();
  let savedCount = 0, saveError = null, pending = Promise.resolve();
  const record = (practice) => (card, correct) => {
    if (practice || saved.has(card.id)) return; // учитывается только первый ответ по карточке; тренировка ошибок коробки не меняет
    saved.add(card.id); savedCount++;
    savedText.textContent = `✓ Сохранено: ${savedCount}`;
    pending = pending.then(() => api.answers([{ id: card.id, correct: !!correct }])).catch((e) => { saveError = e.message; toast(`Не удалось сохранить: ${e.message}`, 'error'); });
  };
  async function exit() {
    current?.destroy(); current = null; // незавершённый вердикт в режиме ввода сохраняется при закрытии режима
    await pending;
    await refreshTree();
    if (savedCount && !saveError) toast(`Прогресс сохранён: ${savedCount} шт.`, 'success');
    go(back);
  }
  const setProgress = (done, total, text) => {
    progressFill.style.width = `${total ? (done / total) * 100 : 0}%`;
    progressText.textContent = text || '';
  };

  function start(cards, practice) {
    current?.destroy();
    const dirs = new Map(cards.map((c) => [c.id, dir === 'mix' ? (Math.random() < 0.5 ? 'td' : 'dt') : dir]));
    const ctx = {
      cards: shuffle(cards), pool: data.pool, stage, setProgress, practice,
      dirOf: (c) => dirs.get(c.id), autoSpeak: () => auto.checked,
      bestKey: `${scope}:${id}:${block}:${filter}`,
      record: record(practice),
      finish: (results, note) => finish(results, note, practice),
    };
    current = run(ctx);
  }

  async function finish(results, note, practice) {
    current?.destroy(); current = null;
    setProgress(1, 1, 'Готово');
    await pending; // все ответы уже записаны по ходу сессии, ждём только последний
    await refreshTree();
    const ok = results.filter((r) => r.correct).length;
    const wrong = results.filter((r) => !r.correct);
    const pct = Math.round((ok / results.length) * 100);
    clear(stage).append(h('div', { class: 'summary' },
      h('h2', null, pct === 100 ? 'Отлично! 🎉' : pct >= 70 ? 'Хороший результат' : 'Есть над чем поработать'),
      h('div', { class: 'score' }, h('b', null, `${pct}%`), h('span', { class: 'muted' }, `${ok} из ${results.length}`)),
      note ? h('p', null, note) : null,
      practice ? h('p', { class: 'muted small' }, 'Это тренировка ошибок — коробки Лейтнера не менялись.')
        : saveError ? h('p', { class: 'badge err' }, `Не удалось сохранить прогресс: ${saveError}`)
        : h('p', { class: 'muted small' }, 'Прогресс сохранён: верные ответы поднимают карточки на коробку выше, ошибки возвращают в коробку 1.'),
      wrong.length ? h('div', { class: 'panel left' }, h('h3', null, `Ошибки (${wrong.length})`),
        h('ul', { class: 'mistakes' }, wrong.map((r) => h('li', null, h('b', null, r.card.term), h('span', { class: 'muted' }, ` — ${r.card.definition}`))))) : null,
      h('div', { class: 'row gap center-row wrap' },
        wrong.length ? h('button', { class: 'btn primary', onClick: () => start(wrong.map((r) => r.card), true) }, 'Повторить ошибки') : null,
        h('button', { class: 'btn', onClick: () => go(location.hash) }, 'Начать заново'),
        h('a', { class: 'btn', href: back }, 'Закрыть'))));
  }

  start(data.cards, false);
  return () => { current?.destroy(); pending.then(() => refreshTree()); };
}
