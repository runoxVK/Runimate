// Projects folder on disk (Chrome / Edge on a computer): once picked, every project
// autosaves into it as "<name>.runimate", and the library as "Runimate library.runilib".
// Browser storage stays as the safety copy. iPad Safari has no folder access.
import { app, changed } from './app.js';
import { get, put, del } from './storage.js';
import { projectBlob, EXT, safeName } from './fileio.js';
import { validateProject } from './model.js';
import { isIOS } from './ui.js';

export const LIBRARY_FILE = 'Runimate library.runilib';
let dir = null;
app.folder = 'none'; // 'none' | 'ok' | 'reconnect'

export const folderSupported = () => typeof window.showDirectoryPicker === 'function' && !isIOS;
export const folderName = () => (dir ? dir.name || 'your folder' : '');

export async function initFolder() {
  try {
    dir = (await get('meta', 'folder'))?.handle || null;
  } catch {
    dir = null;
  }
  await refreshFolderState();
}

async function permission(interactive) {
  if (!dir) return false;
  if (!dir.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  if (!interactive) return false;
  return (await dir.requestPermission(opts)) === 'granted';
}

export async function refreshFolderState() {
  app.folder = !dir ? 'none' : (await permission(false).catch(() => false)) ? 'ok' : 'reconnect';
  changed('saved', 'folder');
}

export async function chooseFolder() {
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'runimate-projects', startIn: 'documents' });
  await useFolder(h);
}
export async function useFolder(handle) {
  dir = handle;
  await put('meta', { id: 'folder', handle });
  await refreshFolderState();
}
export async function forgetFolder() {
  dir = null;
  await del('meta', 'folder');
  await refreshFolderState();
}
// Browsers ask again after a restart; this must run from a click / key press.
export async function reconnectFolder() {
  const ok = await permission(true).catch(() => false);
  await refreshFolderState();
  return ok;
}

async function fileId(name) {
  try {
    const f = await (await dir.getFileHandle(name)).getFile();
    return JSON.parse(await f.text()).id || null;
  } catch {
    return undefined; // missing or unreadable
  }
}

async function writeFile(name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

// Writes the project into the folder; returns the file name, or null when no folder is usable.
export async function writeProjectToFolder(p) {
  if (!dir || app.folder !== 'ok') return null;
  const base = safeName(p.name);
  let name = base + EXT;
  if (p.file !== name) {
    // Don't overwrite a different animation that happens to share the name.
    for (let i = 2; ; i++) {
      const id = await fileId(name);
      if (id === undefined || id === p.id) break;
      name = `${base} (${i})${EXT}`;
    }
  }
  await writeFile(name, projectBlob(p));
  // Renamed: tidy away the old file if it's ours.
  if (p.file && p.file !== name && (await fileId(p.file)) === p.id) await dir.removeEntry(p.file).catch(() => {});
  p.file = name;
  return name;
}

export async function writeLibraryToFolder(assets) {
  if (!dir || app.folder !== 'ok') return;
  const blob = new Blob([JSON.stringify({ format: 'runimate-library', version: 1, assets })], { type: 'application/octet-stream' });
  await writeFile(LIBRARY_FILE, blob).catch(() => {});
}

export async function listFolder() {
  if (!dir || app.folder !== 'ok') return [];
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !name.toLowerCase().endsWith(EXT)) continue;
    const f = await h.getFile();
    out.push({ name, modified: f.lastModified, size: f.size });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export async function readFolderFile(name) {
  const f = await (await dir.getFileHandle(name)).getFile();
  return f;
}

export async function openFromFolder(name) {
  const p = validateProject(JSON.parse(await (await readFolderFile(name)).text()));
  p.file = name;
  return p;
}

export async function folderHasLibrary() {
  if (!dir || app.folder !== 'ok') return false;
  return dir.getFileHandle(LIBRARY_FILE).then(() => true, () => false);
}
