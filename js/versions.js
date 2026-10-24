// Version history: automatic snapshots every few minutes of editing, named versions on
// demand, and restore. Kept in browser storage per animation.
import { app, P, onChange } from './app.js';
import { put, del, all } from './storage.js';
import { deepClone, uid, validateProject } from './model.js';
import { projectThumb, switchTo, saveLocal } from './projects.js';
import { h, icon, openDialog, toast, formDialog, confirmDialog } from './ui.js';

const AUTO_EVERY = 5 * 60 * 1000;
const KEEP_AUTO = 30;
let lastSnap = Date.now(), lastRev = 0, projectId = null;

export function initVersions() {
  onChange((f) => {
    // A newly opened animation starts its own clock.
    if (P()?.id !== projectId) {
      projectId = P()?.id;
      lastSnap = Date.now();
      lastRev = app.rev;
    }
    if (f.has('saved')) maybeAuto();
  });
  setInterval(maybeAuto, 60 * 1000);
}

function maybeAuto() {
  if (!P() || app.rev === lastRev || Date.now() - lastSnap < AUTO_EVERY) return;
  snapshot('', true).catch((e) => console.warn('Version snapshot failed', e));
}

export async function snapshot(label = '', auto = false) {
  const p = P();
  lastSnap = Date.now();
  lastRev = app.rev;
  await put('versions', { id: uid('v'), projectId: p.id, name: p.name, created: Date.now(), label, auto, frames: p.frames.length, thumb: projectThumb(p), data: deepClone(p) });
  await prune(p.id);
}

async function prune(pid) {
  const list = (await all('versions')).filter((v) => v.projectId === pid && v.auto).sort((a, b) => b.created - a.created);
  for (const v of list.slice(KEEP_AUTO)) await del('versions', v.id);
}

export async function listVersions(pid = P().id) {
  return (await all('versions')).filter((v) => v.projectId === pid).sort((a, b) => b.created - a.created);
}

export async function restoreVersion(v) {
  await snapshot('Before restoring', true);
  const data = validateProject(deepClone(v.data));
  // Same animation, same file: restoring replaces what you have now.
  data.id = P().id;
  data.file = P().file;
  await switchTo(data, app.fileHandle);
  await saveLocal();
  toast(`Restored the version from ${new Date(v.created).toLocaleString()} — the previous state was kept as a version too`, { ms: 3600 });
}

export async function openVersionCopy(v) {
  const data = validateProject(deepClone(v.data));
  data.id = uid('p');
  data.name = `${data.name} (${new Date(v.created).toLocaleDateString()})`;
  delete data.file;
  await switchTo(data);
  toast(`Opened a copy: “${data.name}”`);
}

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export async function versionsDialog() {
  const list = h('div', { class: 'ver-list' });
  const usage = h('p', { class: 'muted small' });
  const { close } = openDialog({
    title: 'Version history',
    wide: true,
    body: h('div', {},
      h('p', { class: 'muted small' }, `Runimate keeps a snapshot of “${P().name}” every few minutes while you work (the last ${KEEP_AUTO}), plus any versions you save yourself. Restoring keeps your current state as a version too, so nothing is lost.`),
      h('div', { class: 'row gap', style: { margin: '10px 0 14px' } },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const v = await formDialog('Save a version', [{ key: 'label', label: 'Name (optional)', value: '' }], { ok: 'Save' });
          if (!v) return;
          await snapshot(v.label || 'Saved version', false);
          fill();
        } }, icon('save', 15), ' Save a version now')),
      list, usage),
  });
  async function fill() {
    const vs = await listVersions();
    list.replaceChildren(...(vs.length ? vs.map((v) => h('div', { class: `ver ${v.auto ? '' : 'named'}` },
      h('img', { src: v.thumb, alt: '' }),
      h('div', { class: 'grow' },
        h('b', {}, v.label || 'Autosave'),
        h('div', { class: 'muted small' }, `${ago(v.created)} · ${new Date(v.created).toLocaleString()} · ${v.frames} frame${v.frames === 1 ? '' : 's'}`)),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Replace the animation with this version? Your current state is saved as a version first.', { title: 'Restore version', ok: 'Restore' }))) return;
          close();
          await restoreVersion(v);
        } }, 'Restore'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { close(); await openVersionCopy(v); } }, 'Open copy'),
        h('button', { class: 'ibtn ghost', type: 'button', title: 'Delete this version', 'aria-label': 'Delete this version', onclick: async () => { await del('versions', v.id); fill(); } }, icon('trash', 16)))))
      : [h('p', { class: 'muted' }, 'No versions yet — the first snapshot is taken after a few minutes of editing, or save one now.')]));
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) usage.textContent = `Browser storage used: ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${(est.quota / 1073741824).toFixed(1)} GB` : ''}`;
    } catch {}
  }
  fill();
}
