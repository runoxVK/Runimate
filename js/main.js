// Bootstraps the editor.
import { app, onChange, loadPrefs, setProject } from './app.js';
import { newProject, validateProject } from './model.js';
import { initStage, requestRender, fit } from './stage.js';
import { initTimeline } from './timeline.js';
import { initPanels, initLibraryData } from './panels.js';
import { initShell } from './shell.js';
import { initKeys } from './commands.js';
import { initAutosave, saveLocal } from './projects.js';
import { loadClipboard } from './actions.js';
import { loadProjectRecord, getLastProject, requestPersistence } from './storage.js';
import { toast } from './ui.js';

async function boot() {
  loadPrefs();
  loadClipboard();
  initStage(document.getElementById('stage-canvas'));
  initShell();
  initTimeline(document.getElementById('timeline'));
  initPanels(document.getElementById('panel'));
  initKeys();
  initAutosave();
  onChange((f) => {
    if (!(f.size === 1 && (f.has('saved') || f.has('assets') || f.has('panel')))) requestRender();
    if (f.has('panel')) setTimeout(requestRender, 220);
  });

  let project = null;
  try {
    const last = getLastProject();
    if (last) project = await loadProjectRecord(last);
    if (project) project = validateProject(project);
  } catch (e) {
    console.warn('Could not restore the last project', e);
    project = null;
  }
  const fresh = !project;
  setProject(project || newProject());
  fit();
  if (fresh) saveLocal();
  initLibraryData();
  requestPersistence();
  document.body.classList.add('ready');

  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (fresh && !localStorage.getItem('runimate.welcomed')) {
    try { localStorage.setItem('runimate.welcomed', '1'); } catch {}
    toast('Welcome! Drag the red nodes to pose · N adds a frame · Space plays · ? shows shortcuts', { ms: 6000 });
  }
}

window.addEventListener('error', (e) => console.error(e.error || e.message));
boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal">Runimate failed to start: ${String(e.message || e)}</div>`);
});

window.runimate = app;
