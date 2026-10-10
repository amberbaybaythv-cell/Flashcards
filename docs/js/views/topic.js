import { h, clear, confirmDialog, modal, toast, cardsWord, field, fold } from '../ui.js';
import { pickImage, toBlob, readClipboardImage } from '../lib/clip.js';
import { api } from '../api.js';
import { state, refreshTree, go, watchQueue, openTopicForm } from '../app.js';
import { openStudyLauncher } from './launcher.js';
import { openBulkImport } from './importer.js';
import { statsSection } from './stats.js';
import { speak, speechSupported } from '../lib/speech.js';

const BOX_COLORS = ['b1', 'b2', 'b3', 'b4', 'b5'];

export async function renderTopic({ main, id }) {
  const topic = await api.topic(id);
  const lang = topic.module.term_lang;
  let cards = await api.cards(id);
  const head = h('div'), body = h('div'), statsHolder = h('div');
  main.append(head, body, statsHolder);

  const onChanged = () => { if (document.body.contains(main)) reload(); };
  window.addEventListener('cards-changed', onChanged);

  async function reload() {
    cards = await api.cards(id);
    await refreshTree();
    draw();
  }

  async function drawStats() {
    clear(statsHolder);
    if (!cards.length) return;
    statsHolder.append(statsSection('Статистика темы', 'topic', await api.stats('topic', id)));
  }

  function mediaDialog(card) {
    let cleanup = () => {};
    modal(`Фото: ${card.term}`, (close) => {
      const cur = { ...card };
      const imgBox = h('div', { class: 'media-preview' });
      const creditLine = h('p', { class: 'small muted' });
      const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
      const ipaIn = h('input', { type: 'text', value: cur.ipa || '', placeholder: '/ˈæp.əl/' });
      const genBtn = h('button', { class: 'btn primary' });
      const promptIn = h('textarea', { rows: 3, class: 'mono', 'aria-label': 'Запрос для ИИ' });
      api.imagePrompt(card.id).then((r) => { promptIn.value = r.prompt; }).catch(() => {});

      const drawImg = () => {
        clear(imgBox).append(cur.image ? h('img', { src: cur.image, alt: `Картинка к «${cur.term}»` }) : h('p', { class: 'muted' }, 'Картинки пока нет'));
        const cr = cur.image_credit;
        clear(creditLine).append(...(cur.image && cr ? ['Фото: ', cr.text ? `${cr.text} · ` : '', cr.url ? h('a', { href: cr.url, target: '_blank', rel: 'noopener' }, cr.source || 'источник') : cr.source || ''] : []));
        genBtn.textContent = cur.image ? 'Пересоздать (ИИ)' : 'Сгенерировать (ИИ)';
      };
      const run = async (label, fn) => {
        status.textContent = label;
        try { Object.assign(cur, await fn()); drawImg(); ipaIn.value = cur.ipa || ''; status.textContent = ''; return true; }
        catch (e) { status.textContent = ''; toast(e.message, 'error'); return false; }
      };
      genBtn.addEventListener('click', () => run('Генерирую картинку, это может занять до минуты…', () => api.genImage(card.id, promptIn.value)));

      /* --- вставка из буфера, перетаскивание, файл --- */
      const addFound = (found) => run('Добавляю картинку…', async () => api.uploadImage(card.id, await toBlob(found)));
      const onPaste = (e) => {
        const found = pickImage(e.clipboardData);
        if (!found) return;
        const inField = e.target.matches?.('input, textarea');
        if (inField && !found.file && (e.clipboardData.getData('text/plain') || '').trim()) return; // обычная вставка текста в поле
        e.preventDefault();
        addFound(found);
      };
      document.addEventListener('paste', onPaste);
      cleanup = () => document.removeEventListener('paste', onPaste);

      const zone = h('div', {
        class: 'paste-zone', contenteditable: 'true', inputmode: 'none', tabindex: '0', spellcheck: 'false', role: 'textbox', autocapitalize: 'off',
        'aria-label': 'Область для вставки картинки',
        'data-placeholder': '📋 Скопируйте картинку на сайте и вставьте сюда: Ctrl+V (на планшете: коснитесь и удерживайте → «Вставить»). Можно и перетащить картинку.',
      });
      zone.addEventListener('beforeinput', (e) => e.preventDefault()); // печатать в зоне нельзя, только вставлять
      for (const el of [zone, imgBox]) {
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
        el.addEventListener('dragleave', () => el.classList.remove('drag'));
        el.addEventListener('drop', (e) => {
          e.preventDefault(); el.classList.remove('drag');
          const found = pickImage(e.dataTransfer);
          if (found) addFound(found); else toast('В перетащенном нет картинки', 'error');
        });
      }
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onChange: () => { if (file.files[0]) addFound({ file: file.files[0] }); } });

      /* --- поиск фото в Википедии / Wikimedia Commons --- */
      const qIn = h('input', { type: 'text', placeholder: 'Что искать: слово или фраза', 'aria-label': 'Запрос для поиска фото' });
      const langSel = h('select', { 'aria-label': 'Язык Википедии' }, h('option', { value: 'ru' }, 'Википедия: русская'), h('option', { value: 'en' }, 'Википедия: English'));
      const grid = h('div', { class: 'stock-grid' });
      let touched = false;
      qIn.addEventListener('input', () => { touched = true; });
      langSel.addEventListener('change', () => { touched = true; });
      const searchBtn = h('button', { class: 'btn', type: 'button' }, 'Найти');
      const search = async () => {
        status.textContent = 'Ищу фото…'; clear(grid);
        try {
          const list = await api.stockSearch(card.id, touched ? { query: qIn.value.trim(), lang: langSel.value } : undefined);
          status.textContent = '';
          if (!list.length) { grid.append(h('p', { class: 'muted small' }, 'Ничего не найдено. Попробуйте другое слово, например по-английски.')); return; }
          for (const cand of list) {
            grid.append(h('button', { class: 'stock-item', type: 'button', title: `${cand.label} · ${cand.source}`, onClick: () => run('Скачиваю фото…', () => api.useStock(card.id, cand)) },
              h('img', { src: cand.thumb, alt: cand.label, loading: 'lazy' }),
              h('span', { class: 'cap' }, cand.label), h('small', { class: 'muted' }, cand.source)));
          }
        } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
      };
      searchBtn.addEventListener('click', search);
      qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); touched = true; search(); } });
      api.stockQueries(card.id).then((plan) => {
        qIn.value = plan.wiki[0]?.q || ''; langSel.value = plan.wiki[0]?.lang || lang;
        if (!cur.image) search();
      }).catch(() => {});

      drawImg();
      return h('div', { class: 'stack' },
        imgBox, creditLine,
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', onClick: () => run('Читаю буфер обмена…', async () => api.uploadImage(card.id, await readClipboardImage())) }, '📋 Вставить из буфера'),
          h('button', { class: 'btn', onClick: () => file.click() }, 'Загрузить файл'),
          h('button', { class: 'btn danger-ghost', onClick: () => run('Удаляю…', () => api.delImage(card.id)) }, 'Убрать')),
        zone, file,
        fold('Найти фото в Википедии и Wikimedia Commons',
          [h('p', { class: 'muted small' }, 'Настоящие фотографии из открытых источников, без генерации. Нажмите на картинку, чтобы выбрать. Для конкретных слов (предметы, животные, места) подходит лучше всего; для абстрактных (например, «анализ») результат может быть случайным.'),
            h('div', { class: 'row gap wrap search-row' }, h('div', { style: 'flex:1 1 220px;min-width:0' }, qIn), langSel, searchBtn), grid],
          { key: 'media-stock', open: true, cls: 'panel' }),
        fold('Картинка от ИИ',
          [promptIn, h('p', { class: 'muted small' }, 'Запрос можно поправить, лучше по-английски.'), h('div', { class: 'row' }, genBtn)],
          { key: 'media-ai', open: false, cls: 'panel' }),
        lang === 'en' ? field('Транскрипция (IPA)', h('div', { class: 'row gap' }, ipaIn,
          h('button', { class: 'btn', type: 'button', onClick: () => run('Ищу в словаре…', async () => { const c = await api.fetchIpa(card.id); if (!c.ipa) toast('В словаре такого слова нет — введите вручную', 'info'); return c; }) }, 'Найти'),
          h('button', { class: 'btn', type: 'button', onClick: () => run('Сохраняю…', () => api.editCard(card.id, { term: cur.term, definition: cur.definition, ipa: ipaIn.value })) }, 'Сохранить'))) : null,
        status,
        h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: close }, 'Готово')));
    }, { wide: true, onClose: () => { cleanup(); reload(); } });
  }

  function rowFor(c) {
    const tr = h('tr');
    const view = () => {
      clear(tr).append(
        h('td', { class: 'c-term' }, h('b', null, c.term), c.ipa ? h('div', { class: 'ipa' }, c.ipa) : null),
        h('td', { class: 'c-def' }, c.definition),
        h('td', { class: 'c-img' }, c.image ? h('img', { class: 'thumb', src: c.image, alt: '', loading: 'lazy' }) : null),
        h('td', null, h('span', { class: `box ${BOX_COLORS[c.box - 1]}`, title: c.learned ? 'Выучена' : `Коробка ${c.box}` }, c.learned ? '✓' : c.box)),
        h('td', { class: 'c-act' },
          speechSupported ? h('button', { class: 'icon-btn', 'aria-label': 'Озвучить', title: 'Озвучить', onClick: () => speak(c.term, lang) }, '🔊') : null,
          h('button', { class: 'icon-btn', 'aria-label': 'Картинка и транскрипция', title: 'Картинка и транскрипция', onClick: () => mediaDialog(c) }, '🖼'),
          h('button', { class: 'icon-btn', 'aria-label': 'Изменить', title: 'Изменить', onClick: edit }, '✎'),
          h('button', { class: 'icon-btn', 'aria-label': 'Удалить', title: 'Удалить', onClick: async () => {
            if (!(await confirmDialog(`Удалить карточку «${c.term}»?`))) return;
            try { await api.delCard(c.id); await reload(); } catch (e) { toast(e.message, 'error'); }
          } }, '🗑')));
    };
    const edit = () => {
      const t = h('input', { type: 'text', value: c.term, 'aria-label': 'Термин' });
      const d = h('textarea', { rows: 2, 'aria-label': 'Определение' }, c.definition);
      const save = async () => {
        try { Object.assign(c, await api.editCard(c.id, { term: t.value, definition: d.value })); view(); drawStats(); }
        catch (e) { toast(e.message, 'error'); }
      };
      const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') view(); };
      t.addEventListener('keydown', onKey); d.addEventListener('keydown', onKey);
      clear(tr).append(h('td', null, t), h('td', { colspan: 2 }, d), h('td'),
        h('td', { class: 'c-act' }, h('button', { class: 'btn primary small', onClick: save }, 'OK'), h('button', { class: 'btn small', onClick: view }, '✕')));
      t.focus();
    };
    view();
    return tr;
  }

  function draw() {
    const missingIpa = lang === 'en' ? cards.filter((c) => !c.ipa && !c.ipa_tried).length : 0;
    const missingImg = cards.filter((c) => !c.image).length;
    const due = cards.filter((c) => c.next_review <= state.tree.today).length;
    clear(head).append(h('header', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'crumbs small' }, h('a', { href: `#/m/${topic.module.id}` }, topic.module.name), ' ›'),
        h('h1', null, topic.name), h('p', { class: 'muted' }, cardsWord(cards.length) + (due ? ` · ${due} к повторению` : ''))),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', disabled: !cards.length, onClick: () => openStudyLauncher({ scope: 'topic', id, title: topic.name }) }, 'Учить'),
        h('button', { class: 'btn', onClick: () => openBulkImport(topic, reload) }, 'Импорт текстом'),
        h('button', { class: 'btn', onClick: () => openTopicForm(topic.module_id, topic) }, 'Переименовать'),
        h('button', { class: 'btn', disabled: !cards.length, onClick: () => api.downloadTopic(id) }, 'Экспорт текст'),
        h('button', { class: 'btn danger-ghost', onClick: async () => {
          if (!(await confirmDialog(`Удалить тему «${topic.name}» и ${cardsWord(cards.length)}? Это нельзя отменить.`))) return;
          try { await api.delTopic(id); await refreshTree(); toast('Тема удалена'); go(`#/m/${topic.module_id}`); } catch (e) { toast(e.message, 'error'); }
        } }, 'Удалить'))));

    const term = h('input', { type: 'text', placeholder: 'Термин', 'aria-label': 'Новый термин', required: true });
    const def = h('input', { type: 'text', placeholder: 'Определение', 'aria-label': 'Новое определение', required: true });
    const addForm = h('form', { class: 'addrow', onSubmit: async (e) => {
      e.preventDefault();
      try { await api.addCard(id, { term: term.value, definition: def.value }); await reload(); const t = body.querySelector('input[aria-label="Новый термин"]'); t?.focus(); }
      catch (err) { toast(err.message, 'error'); }
    } }, term, def, h('button', { class: 'btn primary', type: 'submit' }, 'Добавить'));

    const enrich = (opts, label) => async () => {
      try {
        const { queued } = await api.enrich({ scope: 'topic', id, ...opts });
        if (!queued) { toast('Нечего дополнять', 'info'); return; }
        toast(`${label}: в очереди ${queued}`, 'info'); watchQueue(true);
      } catch (e) { toast(e.message, 'error'); }
    };

    clear(body).append(
      addForm,
      cards.length ? h('div', { class: 'row gap wrap small toolbar' },
        lang === 'en' ? h('button', { class: 'btn small', disabled: !missingIpa, onClick: enrich({ ipa: true }, 'Транскрипции') }, `Подтянуть транскрипции${missingIpa ? ` (${missingIpa})` : ''}`) : null,
        h('button', { class: 'btn small', disabled: !missingImg, onClick: enrich({ stock: true }, 'Фото') }, `Найти фото (Wikimedia)${missingImg ? ` (${missingImg})` : ''}`),
        h('button', { class: 'btn small', disabled: !missingImg, onClick: enrich({ images: true }, 'Картинки') }, `Сгенерировать картинки${missingImg ? ` (${missingImg})` : ''}`),
        state.config.imageConfigured === false ? h('span', { class: 'badge warn' }, h('a', { href: '#/settings' }, 'Для картинок нужен ключ: откройте «Настройки»')) : null) : null,
      cards.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'cards-table' },
        h('thead', null, h('tr', null, h('th', null, 'Термин'), h('th', null, 'Определение'), h('th', null), h('th', { title: 'Коробка Лейтнера' }, 'Кор.'), h('th', null))),
        h('tbody', null, cards.map(rowFor)))) :
        h('div', { class: 'empty' }, h('h2', null, 'В теме пока нет карточек'), h('p', { class: 'muted' }, 'Добавьте карточку выше или вставьте сразу весь список текстом.'),
          h('button', { class: 'btn primary', onClick: () => openBulkImport(topic, reload) }, 'Импорт текстом')));
    drawStats();
  }

  draw();
  return () => window.removeEventListener('cards-changed', onChanged);
}
