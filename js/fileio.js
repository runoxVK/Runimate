// Project files, downloads and the share sheet (iPad: Save to Files / Photos).
import { validateProject } from './model.js';
import { isIOS } from './ui.js';

export const EXT = '.runimate';
export const safeName = (s) => (s || 'untitled').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'untitled';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function canShareFile(blob, filename) {
  try {
    return !!navigator.canShare?.({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}
export async function shareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    if (e?.name === 'AbortError') return false;
    throw e;
  }
}

export const projectBlob = (p) => new Blob([JSON.stringify(p)], { type: 'application/octet-stream' });

const hasFSA = () => typeof window.showSaveFilePicker === 'function' && !isIOS;
const fsaTypes = [{ description: 'Runimate project', accept: { 'application/octet-stream': [EXT] } }];

// Writes to the remembered file handle when possible; otherwise asks for a location / downloads.
// Returns the handle used (or null for a download).
export async function saveProjectFile(p, handle = null) {
  const blob = projectBlob(p);
  if (hasFSA()) {
    if (!handle) handle = await window.showSaveFilePicker({ suggestedName: safeName(p.name) + EXT, types: fsaTypes });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return handle;
  }
  if (isIOS && canShareFile(blob, safeName(p.name) + EXT)) {
    await shareFile(blob, safeName(p.name) + EXT);
    return null;
  }
  downloadBlob(blob, safeName(p.name) + EXT);
  return null;
}

export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // iOS greys out files whose extension it doesn't recognise, so leave project pickers open.
    if (accept && !(isIOS && accept.includes(EXT))) input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files[0] || null);
      input.remove();
    };
    document.body.append(input);
    input.click();
  });
}

export async function openProjectFile() {
  let handle = null, file;
  if (hasFSA() && window.showOpenFilePicker) {
    try {
      [handle] = await window.showOpenFilePicker({ types: [{ description: 'Runimate project', accept: { 'application/octet-stream': [EXT, '.json'] } }] });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
    file = await handle.getFile();
  } else {
    file = await pickFile(`${EXT},.json,application/json`);
    if (!file) return null;
  }
  const project = validateProject(JSON.parse(await file.text()));
  return { project, handle };
}

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Loads an image file, downscaling very large pictures so projects stay small.
export async function loadImageFile(file, maxSide = 2048) {
  const url = await readAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not read that image'));
    i.src = url;
  });
  let w = img.naturalWidth, h = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w, h));
  if (k >= 1 && file.size < 1.5e6) return { src: url, w, h };
  w = Math.round(w * k);
  h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { src: c.toDataURL(type, 0.9), w, h };
}
