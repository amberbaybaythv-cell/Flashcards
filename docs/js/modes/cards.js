import { h, clear } from '../ui.js';
import { sides, termBlock, defBlock, autoSpeak, onKeys } from '../lib/study-ui.js';
import { speak } from '../lib/speech.js';

/** Флеш-карточки. Первый ответ по карточке идёт в систему Лейтнера, «Не знаю» возвращает карточку в конец очереди. */
export function runCards(ctx) {
  const queue = [...ctx.cards];
  const first = new Map();
  const known = new Set();
  const total = ctx.cards.length;
  let flipped = false;
  let current = null;

  const stage = clear(ctx.stage);
  const cardEl = h('div', { class: 'flip', role: 'button', tabindex: '0', 'aria-label': 'Перевернуть карточку', onClick: () => flip() });
  const hint = h('p', { class: 'muted small center' }, 'Пробел — перевернуть · → знаю · ← не знаю · S — озвучить');
  const btnNo = h('button', { class: 'btn big no', onClick: () => answer(false) }, '✗ Не знаю');
  const btnYes = h('button', { class: 'btn big yes', onClick: () => answer(true) }, '✓ Знаю');
  stage.append(cardEl, h('div', { class: 'row gap center-row' }, btnNo, btnYes), hint);

  const face = (card, which, dir) => {
    const s = sides(card, dir);
    const isTermFace = which === 'front' ? s.qIsTerm : !s.qIsTerm;
    return isTermFace ? termBlock(card) : defBlock(which === 'front' ? s.q : s.a);
  };

  function show() {
    current = queue[0];
    if (!current) return ctx.finish(ctx.cards.map((c) => ({ card: c, correct: first.get(c.id) })));
    flipped = false;
    const dir = ctx.dirOf(current);
    clear(cardEl).append(
      h('div', { class: 'flip-inner' },
        h('div', { class: 'face front' }, face(current, 'front', dir)),
        h('div', { class: 'face back' }, face(current, 'back', dir))));
    cardEl.classList.remove('flipped');
    if (sides(current, dir).qIsTerm) autoSpeak(ctx, current);
    ctx.setProgress(known.size, total, `${known.size} из ${total}`);
  }

  function flip() {
    flipped = !flipped;
    cardEl.classList.toggle('flipped', flipped);
    if (flipped && !sides(current, ctx.dirOf(current)).qIsTerm) autoSpeak(ctx, current);
  }

  function answer(ok) {
    if (!current) return;
    if (!first.has(current.id)) { first.set(current.id, ok); ctx.record(current, ok); }
    if (ok) { known.add(current.id); queue.shift(); }
    else queue.push(queue.shift());
    show();
  }

  const off = onKeys((e) => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); answer(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); answer(false); }
    else if ((e.key === 's' || e.key === 'ы' || e.key === 'S') && current) speak(current.term, current.term_lang);
  });

  show();
  return { destroy: off };
}
