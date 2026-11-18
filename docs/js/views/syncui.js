// Общие части интерфейса синхронизации: подключение с выбором, QR-код, подписи статуса.
import { h, modal, toast, confirmDialog } from '../ui.js';
import { connect, finishConnect, cancelConnect, makeCode, makeLink, getConfig } from '../sync.js';
import { drawQr } from '../lib/qr.js';
import { refreshTree, render } from '../app.js';

export const timeStr = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function statusText(s) {
  if (s.state === 'syncing') return '⟳ Синхронизация…';
  if (s.state === 'offline') return '⚠ Нет сети: синхронизируем позже';
  if (s.state === 'error') return '⚠ Ошибка синхронизации';
  if (s.state === 'idle' && s.skipped) return `✓ Синхронизировано, но ${s.skipped} карт. без картинки: её нет в облаке`;
  if (s.state === 'idle') return s.lastSync ? `✓ Синхронизировано · ${timeStr(s.lastSync)}` : '✓ Подключено';
  return '';
}

/** Что делать, когда данные есть и на этом устройстве, и в облаке. Возвращает 'merge' | 'replace' | null. */
function askChoice(info) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (!done) { done = true; resolve(v); } close?.(); };
    modal('Данные есть и здесь, и в облаке', (close) => h('div', { class: 'stack' },
      h('p', null, `На этом устройстве: ${info.local.cards} карт. в ${info.local.topics} темах. В облаке: ${info.remote.cards} карт. в ${info.remote.topics} темах.`),
      h('p', { class: 'muted small' }, 'Если объединить, одинаковые наборы, которые вы создавали на устройствах по отдельности (например, дважды загружали один и тот же файл), могут задвоиться. Чтобы этого не было, замените данные этого устройства облачными.'),
      h('div', { class: 'stack tight' },
        h('button', { class: 'btn primary', onClick: () => finish('merge', close) }, 'Объединить данные'),
        h('button', { class: 'btn', onClick: () => finish('replace', close) }, 'Заменить данные этого устройства облачными'),
        h('button', { class: 'btn', onClick: () => finish(null, close) }, 'Отмена'))),
    { onClose: () => finish(null) });
  });
}

/** Полный сценарий подключения. Возвращает true, если устройство подключено. */
export async function runConnect(repo, token) {
  try {
    const r = await connect(repo, token);
    if (r.choice) {
      const choice = await askChoice(r);
      if (!choice) { cancelConnect(); return false; }
      if (choice === 'replace' && !(await confirmDialog('Данные на этом устройстве будут стёрты и заменены облачными. Продолжить?', { okLabel: 'Заменить' }))) { cancelConnect(); return false; }
      await finishConnect(choice);
    }
    toast('Синхронизация подключена', 'success');
    await refreshTree();
    render();
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

/** Окно с QR-кодом и кодом подключения для другого устройства. Закрывается само через 2 минуты. */
export function openQr() {
  const link = makeLink(), code = makeCode();
  if (!link) { toast('Сначала подключите синхронизацию', 'error'); return; }
  let timer;
  modal('Подключить другое устройство', (close) => {
    const canvas = h('canvas', { class: 'qr', role: 'img', 'aria-label': 'QR-код для подключения устройства' });
    drawQr(canvas, link);
    const copy = (text, label) => navigator.clipboard?.writeText(text).then(() => toast(`${label} скопирован`, 'success')).catch(() => toast('Не удалось скопировать', 'error'));
    timer = setTimeout(close, 120_000);
    return h('div', { class: 'stack center' },
      h('p', null, 'Наведите камеру телефона или планшета на QR-код и откройте ссылку. Устройство подключится после подтверждения.'),
      h('div', { class: 'qr-box' }, canvas),
      h('p', { class: 'badge warn' }, 'В коде зашит ваш токен доступа. Показывайте его только своим устройствам. Окно закроется через 2 минуты.'),
      h('div', { class: 'row gap center-row wrap' },
        h('button', { class: 'btn', onClick: () => copy(code, 'Код') }, 'Скопировать код'),
        h('button', { class: 'btn', onClick: () => copy(link, 'Ссылка') }, 'Скопировать ссылку')),
      h('p', { class: 'muted small' }, 'Нет камеры или приложение установлено на главный экран (iPhone)? Скопируйте код, на другом устройстве откройте ⚙️ Настройки → Синхронизация и вставьте его в поле «Код подключения».'),
      h('button', { class: 'btn', onClick: close }, 'Закрыть'));
  }, { onClose: () => clearTimeout(timer) });
}

export const repoName = () => getConfig().repo || '';
