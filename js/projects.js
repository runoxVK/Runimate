// Project lifecycle: autosave to the browser, save/open files, new-project and projects dialogs.
import { app, P, onChange, changed, setProject } from './app.js';
import { newProject, validateProject, uid, deepClone } from './model.js';
import { renderToCanvas } from './render.js';
import { evalKey } from './tween.js';
import { saveProjectRecord, listProjects, loadProjectRecord, del, setLastProject, get } from './storage.js';
import { saveProjectFile, openProjectFile, projectBlob, downloadBlob, safeName, EXT } from './fileio.js';
import { h, icon, ibtn, openDialog, toast, confirmDialog, promptDialog, popupMenu } from './ui.js';
import { fit } from './stage.js';

let timer = 0;
let inflight = null;

export function projectThumb(p) {
  const w = 192, hh = Math.max(1, Math.round((192 * p.height) / p.width));
  return renderToCanvas(p, evalKey(p, 0), w, hh).toDataURL('image/jpeg', 0.8);
}

export async function saveLocal() {
  clearTimeout(timer);
  const p = P();
  if (!p) return;
  const rev = app.rev;
  if (inflight) await inflight;
  inflight = saveProjectRecord(p, projectThumb(p))
    .then(() => {
      setLastProject(p.id);
      if (P() === p || P()?.id === p.id) app.savedRev = Math.max(app.savedRev, rev);
      changed('saved');
    })
    .catch((e) => {
      console.error(e);
      toast('Could not save to browser storage — use “Save to file”', { kind: 'error', ms: 5000 });
    })
    .finally(() => (inflight = null));
  return inflight;
}

export function initAutosave() {
  onChange(() => {
    if (app.project && app.rev !== app.savedRev) {
      clearTimeout(timer);
      timer = setTimeout(saveLocal, 1200);
    }
  });
  // iPad apps get suspended without warning: save whenever we lose visibility.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && app.rev !== app.savedRev && saveLocal());
  window.addEventListener('pagehide', () => app.rev !== app.savedRev && saveLocal());
}

export async function save() {
  await saveLocal();
  if (app.fileHandle) {
    try {
      await saveProjectFile(P(), app.fileHandle);
      toast(`Saved to ${app.fileHandle.name}`);
    } catch (e) {
      toast(`Couldn’t write the file: ${e.message}`, { kind: 'error' });
    }
  } else toast('Saved in this browser · Ctrl+Shift+S saves a file', { ms: 2200 });
}

export async function saveAs() {
  try {
    const handle = await saveProjectFile(P());
    if (handle) {
      app.fileHandle = handle;
      toast(`Saved ${handle.name}`);
    }
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Save failed: ${e.message}`, { kind: 'error' });
  }
}

async function switchTo(project, handle = null) {
  if (P()) await saveLocal();
  setProject(project);
  app.fileHandle = handle;
  fit();
  saveLocal();
}

export async function openFile() {
  try {
    const r = await openProjectFile();
    if (!r) return;
    await switchTo(r.project, r.handle);
    toast(`Opened “${r.project.name}”`);
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Couldn’t open: ${e.message}`, { kind: 'error', ms: 4000 });
  }
}

export async function openLocal(id) {
  const data = await loadProjectRecord(id);
  if (!data) return toast('That project is missing', { kind: 'error' });
  await switchTo(validateProject(data));
}

const SIZES = [
  ['HD landscape', 1280, 720],
  ['Full HD', 1920, 1080],
  ['Square', 1080, 1080],
  ['Vertical (phone)', 1080, 1920],
  ['Small', 640, 360],
];

// Project settings form used by both the new-project dialog and the Properties panel.
export function projectForm(vals, onInput) {
  const name = h('input', { type: 'text', class: 'text', value: vals.name, oninput: (e) => onInput('name', e.target.value) });
  const w = h('input', { type: 'number', class: 'num', min: 16, max: 4096, value: vals.width, oninput: (e) => onInput('width', +e.target.value) });
  const hh = h('input', { type: 'number', class: 'num', min: 16, max: 4096, value: vals.height, oninput: (e) => onInput('height', +e.target.value) });
  const size = h('select', { class: 'sel', onchange: (e) => {
    const s = SIZES[+e.target.value];
    if (!s) return;
    w.value = s[1];
    hh.value = s[2];
    onInput('width', s[1]);
    onInput('height', s[2]);
  } }, SIZES.map((s, i) => h('option', { value: i, selected: s[1] === vals.width && s[2] === vals.height }, `${s[0]} · ${s[1]}×${s[2]}`)), h('option', { value: -1, selected: !SIZES.some((s) => s[1] === vals.width && s[2] === vals.height) }, 'Custom'));
  const fps = h('input', { type: 'number', class: 'num', min: 1, max: 60, value: vals.fps, oninput: (e) => onInput('fps', Math.max(1, Math.min(60, +e.target.value || 12))) });
  const bg = h('input', { type: 'color', class: 'color', value: vals.bg, oninput: (e) => onInput('bg', e.target.value) });
  return h('div', { class: 'form' },
    h('label', { class: 'field col' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field col' }, h('span', {}, 'Canvas size'), size),
    h('div', { class: 'row gap' }, h('label', { class: 'field' }, h('span', {}, 'W'), w), h('label', { class: 'field' }, h('span', {}, 'H'), hh)),
    h('div', { class: 'row gap' }, h('label', { class: 'field' }, h('span', {}, 'FPS'), fps), h('label', { class: 'field' }, h('span', {}, 'Background'), bg)),
  );
}

export function newProjectDialog() {
  const vals = { name: 'Untitled animation', width: 1280, height: 720, fps: 12, bg: '#ffffff', starter: true };
  const starter = h('input', { type: 'checkbox', checked: true, onchange: (e) => (vals.starter = e.target.checked) });
  const body = h('div', {}, projectForm(vals, (k, v) => (vals[k] = v)), h('label', { class: 'field check' }, starter, h('span', {}, 'Start with a stickman')));
  const { dlg } = openDialog({
    title: 'New animation',
    body,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Create', primary: true, run: async (close) => {
        close();
        const p = newProject({ ...vals, width: Math.max(16, Math.min(4096, vals.width | 0)), height: Math.max(16, Math.min(4096, vals.height | 0)) });
        await switchTo(p);
      } },
    ],
  });
  dlg.querySelector('input').select();
}

export async function projectsDialog() {
  const grid = h('div', { class: 'proj-grid' });
  const { close } = openDialog({
    title: 'Your animations',
    wide: true,
    body: h('div', {},
      h('div', { class: 'row gap wrap', style: { marginBottom: '14px' } },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); newProjectDialog(); } }, icon('new', 16), ' New animation'),
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); openFile(); } }, icon('folder', 16), ` Open ${EXT} file…`),
      ),
      h('p', { class: 'muted small' }, 'Animations autosave in this browser. Save a file now and then as a backup, or to move work between your PC and iPad.'),
      grid),
  });

  async function fill() {
    const list = await listProjects();
    grid.replaceChildren();
    if (!list.length) grid.append(h('p', { class: 'muted' }, 'No saved animations yet.'));
    for (const r of list) {
      const isCur = r.id === P()?.id;
      const open = async () => { close(); if (!isCur) await openLocal(r.id); };
      const more = ibtn('dots', `More actions for ${r.name}`, (e) => popupMenu(e.currentTarget, [
        { label: 'Rename', icon: 'pen', run: async () => {
          const n = await promptDialog('Rename animation', r.name, { ok: 'Rename' });
          if (!n) return;
          if (isCur) { P().name = n; changed('project'); await saveLocal(); }
          else { const rec = await get('projects', r.id); rec.name = n; rec.data.name = n; await saveProjectRecord(rec.data, rec.thumb); }
          fill();
        } },
        { label: 'Duplicate', icon: 'copy', run: async () => {
          const data = isCur ? deepClone(P()) : await loadProjectRecord(r.id);
          data.id = uid('p');
          data.name = `${data.name} copy`;
          await saveProjectRecord(data, r.thumb);
          fill();
        } },
        { label: `Download ${EXT} file`, icon: 'download', run: async () => {
          const data = isCur ? P() : await loadProjectRecord(r.id);
          downloadBlob(projectBlob(data), safeName(data.name) + EXT);
        } },
        '-',
        { label: 'Delete', icon: 'trash', disabled: isCur, run: async () => {
          if (await confirmDialog(`Delete “${r.name}”? This can’t be undone.`, { ok: 'Delete', danger: true })) {
            await del('projects', r.id);
            fill();
          }
        } },
      ]), 'ghost');
      grid.append(h('div', { class: `proj ${isCur ? 'current' : ''}` },
        h('button', { class: 'proj-open', type: 'button', onclick: open, 'aria-label': `Open ${r.name}` },
          r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('div', { class: 'noimg' }),
        ),
        h('div', { class: 'proj-meta' },
          h('div', {}, h('b', {}, r.name), isCur ? h('span', { class: 'pill' }, 'open') : null,
            h('div', { class: 'muted small' }, `${r.frames || '?'} frames · ${new Date(r.updated).toLocaleString()}`)),
          more)));
    }
    grid.querySelector('.proj-open')?.focus();
  }
  if (app.rev !== app.savedRev) await saveLocal();
  fill();
}
