// IndexedDB persistence for projects (autosaved) and the asset library.
const DB_NAME = 'runimate';
let dbp = null;

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value));
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());

// Project records keep a lightweight summary next to the data for the gallery.
export async function listProjects() {
  const rows = await all('projects');
  return rows.map(({ id, name, updated, thumb, frames }) => ({ id, name, updated, thumb, frames })).sort((a, b) => b.updated - a.updated);
}
export function saveProjectRecord(project, thumb) {
  return put('projects', { id: project.id, name: project.name, updated: Date.now(), thumb, frames: project.frames.length, data: project });
}
export async function loadProjectRecord(id) {
  const r = await get('projects', id);
  return r ? r.data : null;
}

export async function listAssets() {
  return (await all('assets')).sort((a, b) => b.created - a.created);
}

export function requestPersistence() {
  try {
    navigator.storage?.persist?.();
  } catch {}
}

export const setLastProject = (id) => { try { localStorage.setItem('runimate.last', id); } catch {} };
export const getLastProject = () => { try { return localStorage.getItem('runimate.last'); } catch { return null; } };
