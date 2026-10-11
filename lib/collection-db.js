// A separate database: existing capture blobs and schema remain untouched.
// Metadata and snapshot writes commit together. Lists never read image payloads.
const DB = 'design-claw-collections';
function openDb() {
  return new Promise((resolve, reject) => {
    let blocked=false;
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('metadata', {keyPath:'id'}); req.result.createObjectStore('snapshots'); };
    req.onsuccess = () => {if(blocked){req.result.close();return;}resolve(req.result);};
    req.onerror = () => reject(req.error || new Error('Could not open saved collections.'));
    req.onblocked = () => {blocked=true;reject(new Error('Another window is blocking saved collections. Close it and try again.'));};
  });
}
async function transaction(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['metadata','snapshots'], mode); let value;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Saved collection transaction failed.')); };
    try { run(tx.objectStore('metadata'), tx.objectStore('snapshots'), result => { value = result; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
export const collectionRepository = {
  list: () => transaction('readonly', (meta, _snap, done) => { meta.getAll().onsuccess = e => done(e.target.result); }),
  get: id => transaction('readonly', (_meta, snap, done) => { snap.get(id).onsuccess = e => done(e.target.result); }),
  put: (meta, text) => transaction('readwrite', (store, snap) => { store.put(meta); snap.put(text, meta.id); }),
  remove: id => transaction('readwrite', (meta, snap) => { meta.delete(id); snap.delete(id); }),
};
