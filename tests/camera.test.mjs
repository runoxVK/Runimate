// Animated camera: tool handles, keyboard, tweening, shake, playback view.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, exportVia, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

const cams = () => app.run((m) => m.app.project.frames.map((f) => f.cam && { ...f.cam }));

test('camera tool: corner zooms, dragging inside pans', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('n');
  await app.key('c');
  await app.dragStage([[1280, 720], [960, 540]], 10);
  await app.dragStage([[640, 360], [740, 360]], 10);
  const [c0, c1] = await cams();
  assert.ok(!c0, 'first frame untouched');
  assert.ok(Math.abs(c1.z - 2) < 0.01, 'zoomed to 200%');
  assert.ok(Math.abs(c1.x - 740) < 0.5 && Math.abs(c1.y - 360) < 0.5, 'panned 100px');
  await app.shot('camera-tool');
});

test('Ctrl+arrow turns the camera', async () => {
  await app.key('ArrowRight', ['Control']);
  const c1 = (await cams())[1];
  assert.ok(Math.abs(c1.r - (5 * Math.PI) / 180) < 1e-6);
});

test('in-betweens glide between camera keys (zoom geometrically)', async () => {
  const r = await app.run((m) => {
    m.goto(0);
    m.A.nudgeInbetweens(3);
    const p = m.app.project;
    return m.T.expand(p).map((e) => { const c = m.T.evalEntry(p, e).cam; return [c.x, c.z]; });
  });
  assert.equal(r.length, 5);
  assert.ok(Math.abs(r[2][0] - 690) < 0.01, 'halfway pan');
  assert.ok(Math.abs(r[2][1] - Math.SQRT2) < 0.001, 'halfway zoom is sqrt(2)');
});

test('shake is deterministic and bounded', async () => {
  const r = await app.run((m) => {
    const p = m.app.project;
    p.frames[1].cam.shake = 10;
    const e = m.T.expand(p).at(-1);
    const a = m.T.evalEntry(p, e).cam, b = m.T.evalEntry(p, e).cam;
    p.frames[1].cam.shake = 0;
    return [a.sx, b.sx];
  });
  assert.equal(r[0], r[1]);
  assert.ok(Math.abs(r[0]) <= 10);
});

test('timeline badges camera keyframes; export uses the camera', async () => {
  const badges = await app.page.$$eval('.frame-thumb', (els) => els.map((e) => e.classList.contains('has-cam')));
  assert.deepEqual(badges, [false, true]);
  const out = await exportVia(app, 'mp4');
  assert.ok(out.name?.includes('.mp4'), `got ${out.name}`);
  assert.deepEqual(out.preview.slice(0, 2), [1280, 720]);
});

test('scrubbing previews through the camera', async () => {
  await app.run((m) => m.player.preview(4));
  await sleep(200);
  await app.shot('camera-view');
  const r = await app.run((m) => [m.app.preview, m.app.camView]);
  assert.deepEqual(r, [4, true]);
  await app.run((m) => m.player.preview(null));
});

test('undo removes the camera keys', async () => {
  const r = await app.run((m) => { while (m.undo()); return m.app.project.frames.map((f) => !!f.cam); });
  assert.deepEqual(r, [false]);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
