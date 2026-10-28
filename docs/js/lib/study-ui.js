import { h } from '../ui.js';
import { speak, speechSupported } from './speech.js';

/** Текст вопроса/ответа карточки в заданном направлении ('td' термин→определение, 'dt' обратно). */
export function sides(card, dir) {
  return dir === 'td'
    ? { q: card.term, a: card.definition, qIsTerm: true }
    : { q: card.definition, a: card.term, qIsTerm: false };
}

export function speakBtn(card) {
  if (!speechSupported) return null;
  return h('button', { class: 'icon-btn speak', type: 'button', 'aria-label': 'Озвучить', title: 'Озвучить (S)', tabindex: '-1',
    onClick: (e) => { e.stopPropagation(); speak(card.term, card.term_lang); } }, '🔊');
}

/** К какой стороне прикреплена картинка: 'definition' (по умолчанию) или 'term'. */
export const imageSide = (card) => (card.image_side === 'term' ? 'term' : 'definition');

const picture = (card) => (card.image ? h('img', { class: 'assoc', src: card.image, alt: `Картинка-ассоциация к «${card.term}»` }) : null);

/** Картинка карточки, если она прикреплена к определению: показывается как «ответ» после проверки, когда вопрос был по термину. */
export const answerImage = (card) => (imageSide(card) === 'definition' ? picture(card) : null);

/** Сторона с термином: слово, транскрипция, озвучка; картинка только если она прикреплена к термину. */
export function termBlock(card) {
  return h('div', { class: 'term-block' },
    h('div', { class: 'term-line' }, h('span', { class: 'term-text' }, card.term), speakBtn(card)),
    card.ipa ? h('div', { class: 'ipa big' }, card.ipa) : null,
    imageSide(card) === 'term' ? picture(card) : null);
}

/** Сторона с определением; картинка показывается здесь, если она прикреплена к определению. */
export const defBlock = (card, text) => h('div', { class: 'def-block' },
  h('div', { class: 'def-text' }, text),
  imageSide(card) === 'definition' ? picture(card) : null);

/** Автоозвучка термина, если включена. */
export function autoSpeak(ctx, card) {
  if (ctx.autoSpeak()) speak(card.term, card.term_lang);
}

/** Подписка на клавиши с автоотпиской. Возвращает функцию отписки. */
export function onKeys(handler) {
  const fn = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.backdrop')) return; // открыт диалог
    if (e.target.closest?.('button, a, select, textarea')) return; // нативное поведение элемента
    handler(e);
  };
  window.addEventListener('keydown', fn);
  return () => window.removeEventListener('keydown', fn);
}
