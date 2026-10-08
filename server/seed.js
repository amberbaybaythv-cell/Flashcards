// Демо-данные: node server/seed.js (добавляет модуль, только если база пуста)
import { db } from './db.js';
import { localDate } from './leitner.js';

if (db.prepare('SELECT COUNT(*) AS n FROM modules').get().n > 0) {
  console.log('База не пуста — демо-данные не добавлены.');
  process.exit(0);
}

const demo = {
  name: 'English B1 (демо)', description: 'Пример модуля: английский → русский',
  topics: {
    'Повседневные слова': [
      ['apple', 'яблоко'], ['to run', 'бегать'], ['beautiful', 'красивый'], ['house', 'дом'], ['friend', 'друг'],
      ['to understand', 'понимать'], ['quickly', 'быстро'], ['weather', 'погода'],
    ],
    'Путешествия': [
      ['luggage', 'багаж'], ['ticket', 'билет'], ['to book', 'бронировать'], ['departure', 'отправление / вылет'],
      ['customs', 'таможня'], ['passport', 'паспорт'],
    ],
  },
};

db.transaction(() => {
  const mid = db.prepare('INSERT INTO modules (name, description, term_lang, def_lang) VALUES (?,?,?,?)').run(demo.name, demo.description, 'en', 'ru').lastInsertRowid;
  let pos = 0;
  for (const [tname, cards] of Object.entries(demo.topics)) {
    const tid = db.prepare('INSERT INTO topics (module_id, name, position) VALUES (?,?,?)').run(mid, tname, ++pos).lastInsertRowid;
    for (const [term, def] of cards) db.prepare('INSERT INTO cards (topic_id, term, definition, next_review) VALUES (?,?,?,?)').run(tid, term, def, localDate());
  }
})();
console.log('Демо-модуль добавлен.');
