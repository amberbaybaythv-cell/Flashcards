import { h, clear, shuffle } from '../ui.js';
import { sides, termBlock, defBlock, autoSpeak, onKeys } from '../lib/study-ui.js';
import { normalize } from '../lib/fuzzy.js';

/** Тест с 4 вариантами; неверные варианты берутся из других карточек модуля. */
export function runTest(ctx) {
  const results = [];
  let i = 0, answered = false, timer = null, opts = [];
  const total = ctx.cards.length;
  const stage = clear(ctx.stage);

  function distractors(card, dir, correctText) {
    const key = dir === 'td' ? 'definition' : 'term';
    const seen = new Set([normalize(correctText)]);
    const out = [];
    for (const p of shuffle(ctx.pool.filter((x) => x.module_id === card.module_id && x.id !== card.id))) {
      const t = p[key], n = normalize(t);
      if (seen.has(n)) continue;
      seen.add(n); out.push(t);
      if (out.length === 3) break;
    }
    return out;
  }

  function show() {
    clearTimeout(timer);
    answered = false;
    if (i >= total) return ctx.finish(results);
    const card = ctx.cards[i];
    const dir = ctx.dirOf(card);
    const s = sides(card, dir);
    opts = shuffle([s.a, ...distractors(card, dir, s.a)]);
    ctx.setProgress(i, total, `${i + 1} из ${total}`);
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const nextBtn = h('button', { class: 'btn primary', hidden: true, onClick: () => next() }, 'Далее (Enter)');
    const buttons = opts.map((t, k) => h('button', { class: 'option', onClick: () => choose(k) },
      h('kbd', null, k + 1), h('span', null, t)));
    clear(stage).append(
      h('div', { class: 'question' }, s.qIsTerm ? termBlock(card) : defBlock(s.q)),
      h('p', { class: 'muted center small' }, s.qIsTerm ? 'Выберите определение' : 'Выберите термин'),
      h('div', { class: 'options' }, buttons), feedback, h('div', { class: 'row center-row' }, nextBtn));
    show.ctx = { card, s, buttons, feedback, nextBtn };
    if (s.qIsTerm) autoSpeak(ctx, card);
  }

  function choose(k) {
    if (answered || k >= opts.length) return;
    answered = true;
    const { card, s, buttons, feedback, nextBtn } = show.ctx;
    const ok = normalize(opts[k]) === normalize(s.a);
    buttons.forEach((b, j) => {
      b.disabled = true;
      if (normalize(opts[j]) === normalize(s.a)) b.classList.add('correct');
      else if (j === k) b.classList.add('wrong');
    });
    results.push({ card, correct: ok });
    ctx.record(card, ok);
    feedback.textContent = ok ? 'Верно!' : 'Неверно. Правильный ответ подсвечен.';
    feedback.className = 'feedback ' + (ok ? 'ok' : 'bad');
    if (!s.qIsTerm) { feedback.after(h('div', { class: 'reveal' }, termBlock(card))); autoSpeak(ctx, card); }
    ctx.setProgress(i + 1, total, `${i + 1} из ${total}`);
    nextBtn.hidden = false;
    if (ok && s.qIsTerm) timer = setTimeout(next, 900);
  }

  function next() { if (!answered) return; clearTimeout(timer); i++; show(); }

  const off = onKeys((e) => {
    if (e.key >= '1' && e.key <= '4') choose(Number(e.key) - 1);
    else if (e.key === 'Enter' || e.key === ' ') { if (answered) { e.preventDefault(); next(); } }
  });

  show();
  return { destroy: () => { off(); clearTimeout(timer); } };
}
