// Exports, autosave + reload, project file round trip and the asset library.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, exportVia, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

test('build a small animation', async () => {
  await app.run((m) => {
    m.A.newFrame(false);
    m.A.newFrame(false);
    m.A.newFrame(false);
    const p = m.app.project, l = p.layers[0];
    p.frames[3].poses[l.id].x += 200;
    m.changed('content', 'frames');
  });
  assert.equal(await app.run((m) => m.T.totalFrames(m.app.project)), 4);
});

for (const [fmt, ext, size] of [['gif', '.gif', [1280, 720]], ['mp4', '.mp4', [1280, 720]], ['png-seq', '_png.zip', null], ['sheet', '.png', [2560, 1440]], ['png', '.png', [1280, 720]]]) {
  test(`exports ${fmt}`, async () => {
    const out = await exportVia(app, fmt);
    assert.ok(out.name?.includes(ext), `got ${out.name}`);
    if (size) assert.deepEqual(out.preview.slice(0, 2), size);
    if (fmt === 'mp4') assert.ok(Math.abs(out.preview[2] - 4 / 12) < 0.05, 'video is 4 frames long at 12 fps');
  });
}

test('project file round-trips', async () => {
  const r = await app.run(async (m) => {
    const { projectBlob } = await import('/js/fileio.js');
    const { validateProject } = await import('/js/model.js');
    const text = await projectBlob(m.app.project).text();
    const p = validateProject(JSON.parse(text));
    return [p.frames.length, p.layers.length, JSON.stringify(p) === JSON.stringify(m.app.project)];
  });
  assert.deepEqual(r, [4, 2, true]);
});

test('figures save to the library and insert back', async () => {
  await app.run((m) => { const l = m.app.project.layers[0]; m.select({ type: 'figure', id: l.id, node: null }); });
  await app.page.focus('#stage-canvas');
  await app.key('l', ['Control', 'Shift']);
  await app.page.waitForSelector('dialog[open] input');
  await app.page.keyboard.type('hero');
  await app.page.keyboard.press('Enter');
  await sleep(400);
  const names = await app.run((m) => m.lib.assets.map((a) => `${a.kind}:${a.name}`));
  assert.deepEqual(names, ['figure:hero']);
  await app.run((m) => m.lib.insertAsset(m.lib.assets[0]));
  assert.equal(await app.run((m) => m.app.project.layers.filter((l) => l.kind === 'figure').length), 2);
});

test('autosave survives a reload', async () => {
  await sleep(1800);
  await app.page.reload({ waitUntil: 'networkidle0' });
  await app.page.waitForFunction(() => document.body.classList.contains('ready'));
  const r = await app.run((m) => [m.app.project.frames.length, m.app.project.layers.length]);
  assert.deepEqual(r, [4, 3]);
});

test('older projects with in-betweens open as real frames that play the same', async () => {
  const r = await app.run(async (m) => {
    const { newProject, validateProject } = await import('/js/model.js');
    const p = newProject({ name: 'old' });
    const l = p.layers[0];
    p.frames.push(JSON.parse(JSON.stringify(p.frames[0])));
    p.frames[1].id = 'f2';
    p.frames[1].poses[l.id].x += 90;
    // The old format: 2 tweened in-betweens after frame 1, 1 held after frame 2, loop off.
    Object.assign(p.frames[0], { inb: 2, tween: true, ease: 'linear' });
    Object.assign(p.frames[1], { inb: 1, tween: false, ease: 'linear' });
    p.loop = false;
    const q = validateProject(JSON.parse(JSON.stringify(p)));
    const { totalFrames } = await import('/js/tween.js');
    return { n: q.frames.length, total: totalFrames(q), holds: q.frames.map((f) => f.hold), xs: q.frames.map((f) => Math.round(f.poses[l.id].x - q.frames[0].poses[l.id].x)), leftover: q.frames.some((f) => 'inb' in f || 'tween' in f) };
  });
  assert.equal(r.n, 4);
  assert.equal(r.total, 5, 'still plays 5 frames');
  assert.deepEqual(r.xs, [0, 30, 60, 90]);
  assert.deepEqual(r.holds, [1, 1, 1, 2], 'the held in-between became a hold of 2');
  assert.equal(r.leftover, false);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
