import { h } from '../ui.js';
import { parseCode, isConnected, normalizeRepo } from '../sync.js';
import { runConnect } from './syncui.js';
import { go } from '../app.js';

let held = null; // код живёт в памяти, а из адресной строки сразу убирается: токен не должен оставаться в истории браузера

export async function renderConnect({ main, query }) {
  if (query.c) {
    held = parseCode(query.c);
    history.replaceState(null, '', `${location.pathname}#/connect`);
  }
  main.append(h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Подключение к синхронизации'))));
  if (!held) {
    main.append(h('div', { class: 'empty' }, h('h2', null, 'Код подключения не распознан'),
      h('p', { class: 'muted' }, 'Откройте ссылку из QR-кода целиком или вставьте код в «Настройки» → «Синхронизация».'),
      h('a', { class: 'btn primary', href: '#/settings' }, 'Открыть настройки')));
    return;
  }
  const { repo, token } = held;
  const btn = h('button', { class: 'btn primary', onClick: async () => {
    btn.disabled = true;
    if (await runConnect(repo, token)) { held = null; go('#/'); } else btn.disabled = false;
  } }, 'Подключить это устройство');
  main.append(h('div', { class: 'panel stack' },
    h('p', null, 'Подключить это устройство к синхронизации с репозиторием ', h('b', null, normalizeRepo(repo)), '?'),
    isConnected() ? h('p', { class: 'badge warn' }, 'Это устройство уже подключено; подключение заменит прежнее.') : null,
    h('p', { class: 'muted small' }, 'Карточки, блоки, фото и прогресс с других ваших устройств появятся здесь, а то, что вы добавите тут, окажется на них.'),
    h('div', { class: 'row gap' }, btn, h('a', { class: 'btn', href: '#/' }, 'Отмена'))));
}
