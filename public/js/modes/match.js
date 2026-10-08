import { h, clear, shuffle, store } from '../ui.js';

const PER_ROUND = 6;
const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Сопоставление на время: раунды по 6 пар, ошибки считаются по карточкам. */
export function runMatch(ctx) {
  const stage = clear(ctx.stage);
  const mistakes = new Set();
  const total = ctx.cards.length;
  let matched = 0, sel = null, timerId = null;
  const t0 = Date.now();

  // раунды без повторяющихся терминов/определений внутри раунда
  const rounds = [];
  let rest = shuffle(ctx.cards);
  while (rest.length) {
    const take = [], later = [], terms = new Set(), defs = new Set();
    for (const c of rest) {
      if (take.length < PER_ROUND && !terms.has(c.term) && !defs.has(c.definition)) { take.push(c); terms.add(c.term); defs.add(c.definition); }
      else later.push(c);
    }
    rounds.push(take); rest = later;
  }

  const clock = h('span', { class: 'timer', 'aria-label': 'Время' }, '0:00');
  timerId = setInterval(() => { clock.textContent = fmt(Date.now() - t0); }, 500);
  const board = h('div', { class: 'match-board' });
  stage.append(h('div', { class: 'row between' }, h('p', { class: 'muted small' }, 'Кликните термин, затем подходящее определение'), clock), board);

  let r = 0, left = 0;
  function startRound() {
    sel = null;
    const cards = rounds[r];
    left = cards.length;
    const mk = (side, c, text) => {
      const b = h('button', { class: 'tile-btn ' + side, onClick: () => click(b) }, text);
      b.card = c; b.side = side;
      return b;
    };
    clear(board).append(
      h('div', { class: 'col' }, shuffle(cards).map((c) => mk('t', c, c.term))),
      h('div', { class: 'col' }, shuffle(cards).map((c) => mk('d', c, c.definition))));
  }

  function click(b) {
    if (b.classList.contains('done')) return;
    if (!sel) { sel = b; b.classList.add('sel'); return; }
    if (sel === b) { b.classList.remove('sel'); sel = null; return; }
    if (sel.side === b.side) { sel.classList.remove('sel'); sel = b; b.classList.add('sel'); return; }
    const a = sel; sel = null;
    if (a.card.id === b.card.id) {
      [a, b].forEach((x) => { x.classList.remove('sel'); x.classList.add('done'); x.disabled = true; });
      matched++; left--;
      ctx.setProgress(matched, total, `${matched} из ${total}`);
      if (!left) setTimeout(() => (++r < rounds.length ? startRound() : end()), 350);
    } else {
      mistakes.add(a.card.id); mistakes.add(b.card.id);
      [a, b].forEach((x) => { x.classList.remove('sel'); x.classList.add('shake'); setTimeout(() => x.classList.remove('shake'), 400); });
    }
  }

  function end() {
    clearInterval(timerId);
    const ms = Date.now() - t0;
    const key = `best:match:${ctx.bestKey}`;
    const best = store.get(key, null);
    const record = best == null || (mistakes.size === 0 && ms < best);
    if (!ctx.practice && mistakes.size === 0 && record) store.set(key, ms);
    const note = `Время: ${fmt(ms)}` + (best != null && !(record && mistakes.size === 0) ? ` · рекорд: ${fmt(best)}` : mistakes.size === 0 && !ctx.practice ? (best == null ? ' · первый результат!' : ' · новый рекорд! 🎉') : '');
    ctx.finish(ctx.cards.map((c) => ({ card: c, correct: !mistakes.has(c.id) })), note);
  }

  ctx.setProgress(0, total, `0 из ${total}`);
  startRound();
  return { destroy: () => clearInterval(timerId) };
}
