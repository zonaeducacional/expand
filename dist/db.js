import { cleanAcervo, seed } from './seed.js';

const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('expand-local', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('acervo');
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Feche outras abas do Expand e tente de novo.'));
});

export async function update(change = data => data) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('acervo', 'readwrite');
    const store = transaction.objectStore('acervo');
    const request = store.get('main');
    let result;
    let error;
    request.onsuccess = () => {
      try {
        const data = request.result ?? { ...seed(), saved: [], draft: {}, echoDrafts: {} };
        result = cleanAcervo(change(cleanAcervo(data)));
        store.put(result, 'main');
      } catch (cause) {
        error = cause;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(error ?? transaction.error ?? new Error('Gravação interrompida.'));
  });
}
