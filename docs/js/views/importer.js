import { h, modal, field, toast, store } from '../ui.js';
import { api } from '../api.js';
import { parseCards, parseSections, TERM_SEPS } from '../lib/parse.js';
import { refreshTree, go, watchQueue } from '../app.js';

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Окно массового импорта в тему: сплошной текст → предпросмотр → сохранение. */
export async function openBulkImport(topic, onDone) {
  const existing = new Set((await api.moduleCards(topic.module_id)).map((c) => norm(c.term)));
  const saved = store.get('importOpts', { termSep: 'dash', customSep: '', cardSep: 'newline' });

  modal(`Импорт карточек в «${topic.name}»`, (close) => {
    const text = h('textarea', { rows: 10, class: 'mono', placeholder: 'apple - яблоко\nto run - бегать\nbeautiful - красивый' });
    const termSep = h('select', null, Object.entries(TERM_SEPS).map(([k, v]) => h('option', { value: k, selected: saved.termSep === k }, v.label)));
    const customSep = h('input', { type: 'text', maxlength: 5, value: saved.customSep, placeholder: 'напр. =>', style: 'width:90px' });
    const cardSep = h('select', null,
      h('option', { value: 'newline', selected: saved.cardSep === 'newline' }, 'Новая строка'),
      h('option', { value: 'blank', selected: saved.cardSep === 'blank' }, 'Пустая строка (определение в несколько строк)'));
    const preview = h('div', { class: 'preview' });
    const summary = h('p', { class: 'muted small' });
    const optIpa = h('input', { type: 'checkbox', checked: topic.module.term_lang === 'en' });
    const optImg = h('input', { type: 'checkbox' });
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Добавить карточки');
    let rows = [];

    const rebuild = () => {
      customSep.hidden = termSep.value !== 'custom';
      store.set('importOpts', { termSep: termSep.value, customSep: customSep.value, cardSep: cardSep.value });
      const parsed = parseCards(text.value, { termSep: termSep.value, customSep: customSep.value, cardSep: cardSep.value });
      const seen = new Set();
      rows = parsed.map((p) => {
        const key = norm(p.term);
        const dupExisting = existing.has(key);
        const dupBatch = seen.has(key);
        seen.add(key);
        return { ...p, dup: dupExisting ? 'есть в модуле' : dupBatch ? 'повтор в списке' : '', include: p.valid && !dupExisting && !dupBatch };
      });
      draw();
    };

    const count = () => rows.filter((r) => r.include && r.term.trim() && r.definition.trim()).length;
    const refreshCount = () => {
      const n = count();
      const bad = rows.filter((r) => !r.valid && !(r.term.trim() && r.definition.trim())).length;
      summary.textContent = rows.length ? `Распознано: ${rows.length}. К добавлению: ${n}.` + (bad ? ` Без разделителя: ${bad} — допишите определение или снимите галочку.` : '') : 'Вставьте текст — карточки появятся здесь.';
      saveBtn.disabled = n === 0;
      saveBtn.textContent = n ? `Добавить карточки (${n})` : 'Добавить карточки';
    };

    const draw = () => {
      preview.replaceChildren();
      rows.forEach((r) => {
        const inc = h('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Добавить', onChange: () => { r.include = inc.checked; refreshCount(); } });
        const t = h('input', { type: 'text', value: r.term, 'aria-label': 'Термин', onInput: () => { r.term = t.value; refreshCount(); } });
        const d = h('input', { type: 'text', value: r.definition.replace(/\n/g, ' ⏎ '), 'aria-label': 'Определение', onInput: () => { r.definition = d.value.replace(/\s*⏎\s*/g, '\n'); if (r.definition.trim() && r.term.trim() && !r.valid) { r.valid = true; r.include = true; inc.checked = true; row.classList.remove('invalid'); } refreshCount(); } });
        const row = h('div', { class: 'prow' + (!r.valid ? ' invalid' : '') + (r.dup ? ' dup' : '') }, inc, t, d, r.dup ? h('span', { class: 'badge warn' }, r.dup) : null);
        preview.append(row);
      });
      refreshCount();
    };

    [text, termSep, customSep, cardSep].forEach((el) => el.addEventListener('input', rebuild));
    saveBtn.addEventListener('click', async () => {
      const cards = rows.filter((r) => r.include).map((r) => ({ term: r.term.trim(), definition: r.definition.trim() })).filter((c) => c.term && c.definition);
      if (!cards.length) return;
      saveBtn.disabled = true;
      try {
        const { ids } = await api.bulk(topic.id, cards);
        if (ids.length && (optIpa.checked || optImg.checked)) {
          await api.enrich({ cardIds: ids, ipa: optIpa.checked, images: optImg.checked });
          watchQueue(true);
        }
        toast(`Добавлено карточек: ${ids.length}`, 'success');
        close();
        await refreshTree();
        onDone?.();
      } catch (e) { toast(e.message, 'error'); saveBtn.disabled = false; }
    });

    const body = h('div', { class: 'stack' },
      field('Вставьте текст', text, 'По одной карточке в строке: «термин - определение»'),
      h('div', { class: 'row gap wrap end-align' },
        field('Термин / определение', termSep), customSep, field('Карточки разделены', cardSep)),
      summary, preview,
      h('div', { class: 'stack tight' },
        topic.module.term_lang === 'en' ? h('label', { class: 'check' }, optIpa, ' Подтянуть транскрипцию (нужен интернет)') : null,
        h('label', { class: 'check' }, optImg, ' Сгенерировать ассоциативные картинки ИИ (нужен интернет, может занять время)')),
      h('div', { class: 'row end gap' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Отмена'), saveBtn));
    rebuild();
    return body;
  }, { wide: true });
}

/** Импорт модуля из JSON (экспорт приложения) или текстового файла с заголовками «## Тема». */
export function openImportModule() {
  modal('Импорт модуля', (close) => {
    const file = h('input', { type: 'file', accept: '.json,.txt,text/plain,application/json' });
    const name = h('input', { type: 'text', placeholder: 'Название модуля (для текстового файла)' });
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Импортировать');
    btn.addEventListener('click', async () => {
      const f = file.files[0];
      if (!f) { toast('Выберите файл', 'error'); return; }
      btn.disabled = true;
      try {
        const content = await f.text();
        let res;
        if (f.name.toLowerCase().endsWith('.json')) {
          let data;
          try { data = JSON.parse(content); } catch { throw new Error('Файл повреждён: это не JSON'); }
          res = await api.importModule(data);
        } else {
          const sections = parseSections(content, { termSep: 'dash', cardSep: 'newline' });
          if (!sections) throw new Error('В текстовом файле нет заголовков «## Название темы». Для одной темы используйте импорт внутри темы.');
          const mod = await api.addModule({ name: name.value.trim() || f.name.replace(/\.[^.]+$/, ''), term_lang: 'en', def_lang: 'ru' });
          for (const s of sections) {
            const t = await api.addTopic(mod.id, s.name);
            await api.bulk(t.id, s.cards);
          }
          res = { moduleId: mod.id };
        }
        close();
        await refreshTree();
        toast('Модуль импортирован', 'success');
        go(`#/m/${res.moduleId}`);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
    return h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'JSON-файл, выгруженный из приложения (один модуль или резервная копия всех модулей, вместе с картинками и прогрессом), либо текстовый файл, где темы отмечены строками «## Тема», а карточки — «термин - определение». Импорт всегда создаёт новые модули и ничего не перезаписывает.'),
      field('Файл', file), field('Название модуля', name, 'Только для текстового файла'),
      h('div', { class: 'row end gap' }, h('button', { class: 'btn', type: 'button', onClick: close }, 'Отмена'), btn));
  });
}
