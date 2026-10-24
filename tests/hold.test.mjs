// Hold (exposure): frames stay on screen for N rendered frames — animating on 1s, 2s, 3s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, exportVia, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

const holds = () => app.run((m) => m.app.project.frames.map((f) => f.hold));
const total = () => app.run((m) => m.T.totalFrames(m.app.project));

test('the timeline “2s” button holds the current frame for 2', async () => {
  await app.run((m) => { m.A.newFrame(false); m.A.newFrame(false); m.goto(0); });
  await app.page.click('.hold-ctl .seg button[data-v="2"]');
  assert.deepEqual(await holds(), [2, 1, 1]);
  assert.equal(await total(), 4);
  const chip = await app.page.$eval('.frame-thumb .hold-chip', (el) => el.textContent);
  assert.equal(chip, '×2');
});

test('K / Shift+K lengthen and shorten the hold', async () => {
  await app.page.focus('#stage-canvas');
  await app.run((m) => m.goto(1));
  await app.key('k');
  await app.key('k');
  await app.key('k', ['Shift']);
  assert.deepEqual(await holds(), [2, 2, 1]);
});

test('a 50% frame inherits the hold and is marked 中 on the timesheet', async () => {
  await app.run((m) => { m.goto(0); m.A.addMidFrame(); });
  assert.deepEqual(await holds(), [2, 2, 2, 1]);
  await sleep(100);
  const kinds = await app.page.$$eval('.frame-thumb', (els) => els.map((e) => e.querySelector('.kind').textContent));
  assert.deepEqual(kinds, ['', '中', '', '']);
  await app.shot('hold-timesheet');
});

test('playback and export follow the holds', async () => {
  assert.equal(await total(), 7);
  const entries = await app.run((m) => m.T.expand(m.app.project).map((e) => e.k));
  assert.deepEqual(entries, [0, 0, 1, 1, 2, 2, 3]);
  const out = await exportVia(app, 'mp4');
  assert.ok(Math.abs(out.preview[2] - 7 / 12) < 0.05, `video is 7 frames long, got ${out.preview[2]}`);
  const gif = await exportVia(app, 'gif');
  assert.deepEqual(gif.preview, [1280, 720]);
});

test('“Animate on 3s” holds every frame for 3', async () => {
  await app.run((m) => m.cmds.runCommand('shoot-3'));
  assert.deepEqual(await holds(), [3, 3, 3, 3]);
  await app.run((m) => m.undo());
  assert.deepEqual(await holds(), [2, 2, 2, 1]);
});

test('holds survive saving and reopening', async () => {
  const r = await app.run(async (m) => {
    const { projectBlob } = await import('/js/fileio.js');
    const { validateProject } = await import('/js/model.js');
    return validateProject(JSON.parse(await projectBlob(m.app.project).text())).frames.map((f) => [f.hold, f.kind || 'key']);
  });
  assert.deepEqual(r, [[2, 'key'], [2, 'mid'], [2, 'key'], [1, 'key']]);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
