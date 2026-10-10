import { h, field, toast } from '../ui.js';
import { api } from '../api.js';
import { getSettings, saveSettings } from '../lib/enrich.js';
import { state, refreshTree, ACCENTS, currentAccent, applyAccent } from '../app.js';

const PROVIDERS = [
  ['huggingface', 'Hugging Face (бесплатный токен, рекомендуется)'],
  ['openai', 'OpenAI (платно)'],
  ['pollinations', 'Pollinations (часто требует ключ)'],
];

export async function renderSettings({ main }) {
  const s = getSettings();
  const provider = h('select', null, PROVIDERS.map(([v, l]) => h('option', { value: v, selected: (s.imageProvider || (s.openaiKey && !s.hfToken ? 'openai' : 'huggingface')) === v }, l)));
  const hf = h('input', { type: 'password', value: s.hfToken || '', placeholder: 'hf_…', autocomplete: 'off' });
  const oa = h('input', { type: 'password', value: s.openaiKey || '', placeholder: 'sk-…', autocomplete: 'off' });
  const pl = h('input', { type: 'password', value: s.pollinationsToken || '', placeholder: 'необязательно', autocomplete: 'off' });
  const last = (() => { try { return localStorage.getItem('lastBackup'); } catch { return null; } })();

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Акцентный цвет' });
  const drawSwatches = () => {
    swatches.replaceChildren(...ACCENTS.map((a) => h('button', {
      class: 'swatch', role: 'radio', 'aria-checked': String(currentAccent() === a.id),
      onClick: () => { applyAccent(a.id); drawSwatches(); },
    }, h('span', { class: 'dot', style: `background:${a.color}` }), a.name)));
  };
  drawSwatches();

  main.append(
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Настройки'), h('p', { class: 'muted' }, 'Всё хранится только на этом устройстве'))),
    h('section', { class: 'panel stack' },
      h('h2', null, 'Оформление'),
      h('p', { class: 'muted small' }, 'Цвет кнопок, ссылок и графиков. Светлая и тёмная тема переключается кнопкой ◐ в боковой панели.'),
      swatches),
    h('section', { class: 'panel stack', style: 'margin-top:16px' },
      h('h2', null, 'Картинки от ИИ'),
      h('p', { class: 'muted small' }, 'Запросы идут из браузера напрямую к выбранному сервису, нужен интернет. Ключи хранятся только в этом браузере и никуда, кроме выбранного сервиса, не отправляются.'),
      field('Провайдер', provider),
      field('Токен Hugging Face', hf, 'Получить: huggingface.co/settings/tokens → Fine-grained → право «Make calls to Inference Providers»'),
      field('Ключ OpenAI', oa),
      field('Токен Pollinations', pl),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onClick: () => {
        saveSettings({ ...getSettings(), imageProvider: provider.value, hfToken: hf.value.trim(), openaiKey: oa.value.trim(), pollinationsToken: pl.value.trim() });
        toast('Настройки сохранены', 'success');
        api.config().then((c) => { state.config = c; });
      } }, 'Сохранить'))),
    h('section', { class: 'panel stack', style: 'margin-top:16px' },
      h('h2', null, 'Резервная копия'),
      h('p', { class: 'muted small' }, 'Данные лежат в памяти браузера. Если очистить данные сайта или удалить приложение с экрана, они пропадут, поэтому иногда скачивайте копию. Тот же файл переносит карточки между устройствами: в приложении на другом устройстве нажмите «Импорт».'),
      h('p', { class: 'small' }, last ? `Последняя копия: ${last}` : 'Копия ещё не делалась'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onClick: async () => { const r = await api.downloadBackup(); toast(`Скачана копия: модулей ${r.modules}`, 'success'); } }, 'Скачать копию всех модулей'),
        h('button', { class: 'btn', onClick: async () => { await refreshTree(); location.hash = '#/'; } }, 'На главную'))),
    h('section', { class: 'panel stack', style: 'margin-top:16px' },
      h('h2', null, 'Хранилище'),
      state.config.storage?.persistent
        ? h('p', { class: 'small' }, 'Данные сохраняются на устройстве. Чтобы система не удаляла их при нехватке места, добавьте сайт на главный экран (меню браузера → «Добавить на главный экран» / «Установить»).')
        : h('p', { class: 'badge err' }, `Хранилище недоступно (${state.config.storage?.error || 'неизвестная причина'}): данные не сохранятся после закрытия вкладки. Откройте сайт не в приватном режиме.`)));
}
