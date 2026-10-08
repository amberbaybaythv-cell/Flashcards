import { DatabaseSync } from 'node:sqlite'; // встроенный SQLite, ничего компилировать не нужно
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const raw = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// LIKE в SQLite не умеет регистронезависимый поиск по кириллице
raw.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

export const db = {
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  /** Оборачивает функцию в транзакцию (как у better-sqlite3). */
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  term_lang TEXT NOT NULL DEFAULT 'en',
  def_lang TEXT NOT NULL DEFAULT 'ru',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  ipa TEXT,
  ipa_tried INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  box INTEGER NOT NULL DEFAULT 1,
  learned INTEGER NOT NULL DEFAULT 0,
  next_review TEXT NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  correct INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_module ON topics(module_id);
CREATE INDEX IF NOT EXISTS idx_cards_topic ON cards(topic_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(next_review);
CREATE INDEX IF NOT EXISTS idx_reviews_day ON reviews(day);
`);
