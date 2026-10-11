// Storage decision (Phase 0 check #5): crop blobs live in IndexedDB (binary,
// no base64 bloat, large quota), tray metadata lives in chrome.storage.local
// (small, mirrored so a crash mid-collection doesn't lose the assembly).
// unlimitedStorage is also declared in the manifest as free insurance.

const DB_NAME = "design-compositor";
const DB_VERSION = 1;
const STORE = "crops"; // key: string id -> value: Blob

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?._value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("The image storage transaction was aborted."));
  });
}

export async function putCrop(id, blob) {
  const db = await openDb();
  try { await tx(db, "readwrite", (s) => s.put(blob, id)); }
  finally { db.close(); }
  return id;
}

export async function getCrop(id) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const r = t.objectStore(STORE).get(id);
      let blob = null;
      r.onsuccess = () => { blob = r.result || null; };
      r.onerror = () => reject(r.error);
      t.oncomplete = () => resolve(blob);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("The image storage transaction was aborted."));
    });
  } finally { db.close(); }
}

export async function deleteCrop(id) {
  const db = await openDb();
  try { await tx(db, "readwrite", (s) => s.delete(id)); }
  finally { db.close(); }
}

// Tray metadata: [{ id, sourceUrl, role, note, order, w, h, bytes, createdAt }]
export async function getTrayMeta() {
  const { tray } = await chrome.storage.local.get("tray");
  return tray || [];
}

export async function setTrayMeta(tray) {
  await chrome.storage.local.set({ tray });
}

export async function estimateStorage() {
  if (navigator.storage?.estimate) return await navigator.storage.estimate();
  return null;
}
