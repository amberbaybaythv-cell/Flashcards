import { h, clear } from '../ui.js';
import { sides, termBlock, defBlock, autoSpeak, onKeys } from '../lib/study-ui.js';
import { checkAnswer } from '../lib/fuzzy.js';

/** Ввод ответа: допускается 1 опечатка, несколько вариантов через «/», «,», «;». */
export function runType(ctx) {
  const results = [];
  let i = 0, checked = false, pending = null;
  const commit = () => { if (pending) { ctx.record(pending.card, pending.correct); pending = null; } };
  const total = ctx.cards.length;
  const stage = clear(ctx.stage);

  function show() {
    checked = false;
    if (i >= total) return ctx.finish(results);
    const card = ctx.cards[i];
    const s = sides(card, ctx.dirOf(card));
    ctx.setProgress(i, total, `${i + 1} из ${total}`);
    const input = h('input', { type: 'text', class: 'answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Ваш ответ', placeholder: s.qIsTerm ? 'Введите определение…' : 'Введите термин…' });
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const actions = h('div', { class: 'row gap center-row' });
    const checkBtn = h('button', { class: 'btn primary', onClick: () => check() }, 'Проверить (Enter)');
    const skipBtn = h('button', { class: 'btn', onClick: () => check(true) }, 'Не знаю');
    actions.append(checkBtn, skipBtn);
    clear(stage).append(
      h('div', { class: 'question' }, s.qIsTerm ? termBlock(card) : defBlock(s.q)),
      h('div', { class: 'answer-row' }, input), feedback, actions);
    show.ctx = { card, s, input, feedback, actions };
    if (s.qIsTerm) autoSpeak(ctx, card);
    input.focus();
  }

  function check(skip = false) {
    if (checked) return next();
    const { card, s, input, feedback, actions } = show.ctx;
    const verdict = skip ? 'wrong' : checkAnswer(input.value, s.a);
    checked = true;
    input.disabled = true;
    const entry = { card, correct: verdict !== 'wrong' };
    results.push(entry);
    pending = entry; // сохраняется при переходе дальше или выходе (вердикт можно поправить)
    const msg = h('div', { class: 'feedback ' + (entry.correct ? 'ok' : 'bad') });
    const paint = () => {
      msg.className = 'feedback ' + (entry.correct ? 'ok' : 'bad');
      clear(msg).append(
        h('b', null, verdict === 'exact' ? 'Верно!' : verdict === 'close' ? 'Почти верно — засчитано' : skip ? 'Правильный ответ' : 'Неверно'),
        verdict !== 'exact' ? h('div', null, 'Ответ: ', h('b', null, s.a)) : null,
        !skip && verdict === 'wrong' ? h('div', { class: 'muted small' }, `Вы ввели: ${input.value || '—'}`) : null);
    };
    paint();
    feedback.replaceWith(msg);
    if (!s.qIsTerm) { msg.after(h('div', { class: 'reveal' }, termBlock(card))); autoSpeak(ctx, card); }
    clear(actions);
    if (verdict === 'wrong') {
      actions.append(h('button', { class: 'btn', onClick: () => { entry.correct = !entry.correct; paint(); overrule.textContent = entry.correct ? 'Я ошибся' : 'Я был прав'; } }, 'Я был прав'));
    }
    const overrule = actions.firstChild;
    actions.append(h('button', { class: 'btn primary', onClick: next }, 'Далее (Enter)'));
    ctx.setProgress(i + 1, total, `${i + 1} из ${total}`);
  }

  function next() { if (!checked) return; commit(); i++; show(); }

  const off = onKeys((e) => {
    if (e.key === 'Enter') { e.preventDefault(); check(); }
  });

  show();
  return { destroy: () => { off(); commit(); } };
}
