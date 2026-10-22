// Projects folder: autosaving .runimate files (and the library) into a folder on disk.
// The real folder picker can't be automated, so the browser's private file system
// (which has the same directory-handle API) stands in for a folder the user picked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

const files = () => app.page.evaluate(async () => {
  const dir = await navigator.storage.getDirectory();
  const out = [];
  for await (const [name] of dir.entries()) out.push(name);
  return out.sort();
});
const fileJSON = (name) => app.page.evaluate(async (name) => {
  const dir = await navigator.storage.getDirectory();
  return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
}, name);

test('connecting a folder saves the current animation into it', async () => {
  await app.run(async (m) => {
    await m.folder.useFolder(await navigator.storage.getDirectory());
    await m.projects.saveLocal();
  });
  assert.equal(await app.run((m) => m.app.folder), 'ok');
  assert.deepEqual(await files(), ['Untitled animation.runimate']);
  const data = await fileJSON('Untitled animation.runimate');
  assert.equal(data.id, await app.run((m) => m.app.project.id));
});

test('edits autosave into the file', async () => {
  await app.run((m) => { m.A.newFrame(false); });
  await sleep(1800);
  const data = await fileJSON('Untitled animation.runimate');
  assert.equal(data.frames.length, 2);
  const label = await app.page.$eval('.save-state', (el) => el.textContent);
  assert.match(label, /Saved to/);
});

test('renaming renames the file; a different animation never overwrites it', async () => {
  await app.run(async (m) => { m.app.project.name = 'Fight scene'; m.changed('project'); await m.projects.saveLocal(); });
  assert.deepEqual(await files(), ['Fight scene.runimate']);
  // A second animation with the same name gets its own file.
  await app.run(async (m) => {
    const { newProject } = await import('/js/model.js');
    m.setProject(newProject({ name: 'Fight scene' }));
    await m.projects.saveLocal();
  });
  assert.deepEqual(await files(), ['Fight scene (2).runimate', 'Fight scene.runimate']);
});

test('the library is saved into the folder too', async () => {
  await app.run(async (m) => {
    const { put } = await import('/js/storage.js');
    await put('assets', { id: 'a1', kind: 'drawing', name: 'dot', created: 1, thumb: '', data: { strokes: [] } });
    await m.lib.refreshAssets();
  });
  await sleep(200);
  const lib = await fileJSON('Runimate library.runilib');
  assert.deepEqual(lib.assets.map((a) => a.name), ['dot']);
});

test('the projects dialog lists the folder and opens files from it', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('o', ['Control']);
  await app.page.waitForSelector('.folder-box .file-row');
  const rows = await app.page.$$eval('.folder-box .file-row', (els) => els.map((e) => e.textContent));
  assert.equal(rows.length, 2);
  await app.shot('folder-dialog');
  // Open the first "Fight scene" (2 frames).
  const idx = await app.page.$$eval('.folder-box .file-row', (els) => els.findIndex((e) => e.textContent.startsWith('Fight scene') && !e.textContent.includes('(2)')));
  await (await app.page.$$('.folder-box .file-row'))[idx].click();
  await sleep(400);
  const r = await app.run((m) => [m.app.project.name, m.app.project.frames.length, m.app.project.file]);
  assert.deepEqual(r, ['Fight scene', 2, 'Fight scene.runimate']);
});

test('stopping the folder falls back to browser-only saving', async () => {
  await app.run(async (m) => { await m.folder.forgetFolder(); });
  assert.equal(await app.run((m) => m.app.folder), 'none');
});

test('no console errors', () => assert.deepEqual(app.errors, []));
