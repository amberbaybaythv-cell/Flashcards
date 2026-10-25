import { h, field, toast, fold, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { getSettings, saveSettings } from '../lib/enrich.js';
import { state, refreshTree, ACCENTS, currentAccent, applyAccent } from '../app.js';
import { getConfig, getStatus, isConnected, syncNow, disconnect, parseCode } from '../sync.js';
import { runConnect, openQr, statusText, timeStr } from './syncui.js';

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

  /* ---------- синхронизация между устройствами ---------- */
  const syncBox = h('section', { class: 'panel stack', style: 'margin-top:16px' });
  const drawSync = () => {
    syncBox.replaceChildren(h('h2', null, 'Синхронизация между устройствами'));
    if (isConnected()) {
      const st = getStatus(), cfg = getConfig();
      syncBox.append(
        h('p', { class: st.state === 'error' || st.state === 'offline' ? 'badge err' : 'small' }, statusText(st) || 'Подключено'),
        st.error ? h('p', { class: 'small muted' }, st.error) : null,
        h('p', { class: 'small muted' }, `Репозиторий: ${cfg.repo}. Синхронизируются темы, блоки, карточки, фото, прогресс и история ответов. Изменения уходят сами через пару секунд после правки и при выходе из приложения; новое с других устройств подтягивается при открытии.`),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', disabled: st.state === 'syncing', onClick: async () => { try { await syncNow({ manual: true, force: true }); toast('Синхронизировано', 'success'); } catch (e) { toast(e.message, 'error'); } } }, 'Синхронизировать сейчас'),
          h('button', { class: 'btn', onClick: openQr }, 'Подключить другое устройство (QR)'),
          h('button', { class: 'btn danger-ghost', onClick: async () => {
            if (!(await confirmDialog('Отключить синхронизацию на этом устройстве? Данные на нём останутся, но перестанут обмениваться с облаком.', { okLabel: 'Отключить', danger: false }))) return;
            disconnect(); drawSync();
          } }, 'Отключить')),
        h('p', { class: 'muted small' }, `Последняя синхронизация: ${timeStr(st.lastSync)}`));
      return;
    }
    const code = h('input', { type: 'text', placeholder: 'K1.… или ссылка из QR-кода', autocomplete: 'off', 'aria-label': 'Код подключения' });
    const repo = h('input', { type: 'text', placeholder: 'владелец/репозиторий, например ivan/flashcards-data', autocomplete: 'off', 'aria-label': 'Репозиторий' });
    const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'Токен GitHub' });
    const byCode = h('button', { class: 'btn primary', type: 'button', onClick: async () => {
      const p = parseCode(code.value);
      if (!p) { toast('Не получилось разобрать код. Скопируйте его целиком с первого устройства', 'error'); return; }
      byCode.disabled = true; if (await runConnect(p.repo, p.token)) drawSync(); byCode.disabled = false;
    } }, 'Подключить по коду');
    const byToken = h('button', { class: 'btn primary', type: 'button', onClick: async () => {
      byToken.disabled = true; if (await runConnect(repo.value, token.value)) drawSync(); byToken.disabled = false;
    } }, 'Подключить');
    syncBox.append(
      h('p', { class: 'muted small' }, 'Карточки, блоки, фото и прогресс будут одинаковыми на всех ваших устройствах. Данные хранятся в вашем приватном репозитории на GitHub (бесплатно). Настройка занимает около 5 минут один раз.'),
      fold('Как подготовить репозиторий и токен', h('ol', { class: 'steps small' },
        h('li', null, 'На github.com нажмите «+» → New repository. Название, например, flashcards-data. Выберите Private и отметьте «Add a README file». Create repository.'),
        h('li', null, 'Фото профиля → Settings → внизу слева Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
        h('li', null, 'Имя токена любое, срок действия, например, 1 год. Repository access: Only select repositories и выберите flashcards-data.'),
        h('li', null, 'Repository permissions → Contents: Read and write. Нажмите Generate token и скопируйте токен (он показывается один раз).'),
        h('li', null, 'Здесь вставьте название репозитория (владелец/flashcards-data) и токен, нажмите «Подключить».'),
        h('li', null, 'Для остальных устройств: «Подключить другое устройство (QR)» на этом, там отсканируйте код или вставьте его в поле «Код подключения».')),
      { key: 'sync-howto', open: false, cls: 'panel' }),
      field('Код подключения (для второго и следующих устройств)', h('div', { class: 'row gap wrap' }, h('div', { style: 'flex:1 1 220px;min-width:0' }, code), byCode)),
      h('div', { class: 'grid2' }, field('Репозиторий', repo), field('Токен', token)),
      h('div', { class: 'row end' }, byToken));
  };
  drawSync();
  const onStatus = () => { if (document.body.contains(syncBox)) drawSync(); else window.removeEventListener('sync-status', onStatus); };
  window.addEventListener('sync-status', onStatus);

  main.append(
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Настройки'), h('p', { class: 'muted' }, 'Данные хранятся на этом устройстве, а при желании синхронизируются между устройствами'))),
    h('section', { class: 'panel stack' },
      h('h2', null, 'Оформление'),
      h('p', { class: 'muted small' }, 'Цвет кнопок, ссылок и графиков. Светлая и тёмная тема переключается кнопкой 🌓 в боковой панели.'),
      swatches),
    syncBox,
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
