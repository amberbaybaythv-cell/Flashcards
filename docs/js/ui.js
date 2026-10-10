export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const cardsWord = (n) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;

export function toast(msg, kind = 'info') {
  const root = $('#toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  root.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 6000 : 3000);
}

/** Модальное окно. build(close) возвращает содержимое. */
export function modal(title, build, { wide = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    onClose?.();
    if (prevFocus?.focus) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onClick: close }, '✕')),
    h('div', { class: 'modal-body' }, build(close)));
  const backdrop = h('div', { class: 'backdrop', onMousedown: (e) => { if (e.target === backdrop) close(); } }, box);
  $('#modals').append(backdrop);
  document.addEventListener('keydown', onKey, true);
  const first = box.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, select');
  (first || box.querySelector('button.primary') || box).focus?.();
  return close;
}

export function confirmDialog(text, { okLabel = 'Удалить', danger = true } = {}) {
  return new Promise((resolve) => {
    modal('Подтверждение', (close) => h('div', null,
      h('p', null, text),
      h('div', { class: 'row end gap' },
        h('button', { class: 'btn', onClick: close }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => { resolve(true); close(); } }, okLabel))),
    { onClose: () => resolve(false) }); // повторный resolve игнорируется
  });
}

/** Сворачиваемый блок со стрелкой справа от заголовка. Состояние запоминается по key. */
export function fold(title, body, { key, open = false, level = 'h3', cls = '' } = {}) {
  const saved = key ? store.get('fold:' + key, open) : open;
  const el = h('details', { class: `fold ${cls}`.trim(), open: !!saved },
    h('summary', null, h(level, null, title), h('span', { class: 'chev', 'aria-hidden': 'true' })),
    h('div', { class: 'fold-body' }, body));
  if (key) el.addEventListener('toggle', () => store.set('fold:' + key, el.open));
  return el;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
