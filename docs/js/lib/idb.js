// Тонкая обёртка над IndexedDB: все данные живут в браузере устройства.
export const STORES = ['modules', 'topics', 'cards', 'reviews', 'blocks'];

export function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB недоступна'));
    const req = indexedDB.open('kartochki', 2); // v2: добавлена таблица блоков, существующие данные сохраняются
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База данных заблокирована другой вкладкой'));
  });
}

export const getAll = (db, store) => new Promise((resolve, reject) => {
  const r = db.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/** Пишет пачку операций одной транзакцией: { store, put } или { store, del }. */
export function commit(db, ops) {
  if (!db || !ops.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(ops.map((o) => o.store))], 'readwrite');
    for (const o of ops) {
      const s = tx.objectStore(o.store);
      if (o.del != null) s.delete(o.del); else s.put(o.put);
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => {
      const e = tx.error;
      reject(e && e.name === 'QuotaExceededError' ? new Error('На устройстве не хватает места для сохранения') : e || new Error('Не удалось сохранить данные'));
    };
  });
}
