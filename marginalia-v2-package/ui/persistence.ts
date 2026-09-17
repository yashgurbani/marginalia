import type { Persistence } from './journal.ts';

/** Only used inside the trusted local page or extension-origin margin. */
export function localPersistence(name = 'marginalia-reader') {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function read<T>(key: string): Promise<T | undefined> {
    const db = await database;
    return new Promise((resolve, reject) => {
      const request = db.transaction('reader').objectStore('reader').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function write(key: string, value: unknown): Promise<void> {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('reader', 'readwrite');
      transaction.objectStore('reader').put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted.'));
    });
  }
  const journal: Persistence = { load: () => read('journal'), save: value => write('journal', value) };
  return { read, write, journal };
}
