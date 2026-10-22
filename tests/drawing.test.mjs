// Brush, eraser, lasso, copy/paste, bone art, rulers and mirror symmetry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

const ys = (pts) => pts.filter((_, i) => i % 2 === 1);

test('brush draws on the drawing layer', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('b');
  await app.dragStage([[150, 600], [300, 610], [450, 600]], 15);
  const s = await app.strokes();
  assert.equal(s.length, 1);
  assert.ok(s[0].length >= 10, 'stroke has points');
});

test('partial eraser cuts a stroke in two and undo restores it', async () => {
  await app.key('e');
  await app.dragStage([[300, 560], [300, 650]], 10);
  assert.equal((await app.strokes()).length, 2);
  await app.key('z', ['Control']);
  assert.equal((await app.strokes()).length, 1);
});

test('lasso selects strokes, copy + paste duplicates them', async () => {
  await app.key('s');
  await app.dragStage([[120, 560], [480, 560], [480, 650], [120, 650], [120, 560]], 6);
  assert.equal(await app.run((m) => `${m.app.sel?.type}:${m.app.sel?.strokes?.length}`), 'strokes:1');
  await app.key('c', ['Control']);
  await app.key('v', ['Control']);
  assert.equal((await app.strokes()).length, 2);
});

test('drawing on a bone attaches art that follows the figure', async () => {
  await app.key('Escape');
  await app.key('v');
  const j = await app.joints();
  const [hx, hy] = await app.toPage(...j.head);
  await app.page.mouse.click(hx, hy);
  await app.key('b', ['Shift']);
  await app.dragStage([[j.head[0] - 20, j.head[1] - 10], [j.head[0] + 30, j.head[1] - 40]], 10);
  await app.key('Escape');
  const art = await app.run((m) => m.app.project.layers[0].rig.nodes.find((n) => n.id === 'head').art?.strokes.length);
  assert.equal(art, 1);
  // Rotate the torso: the art's on-screen bounds should move with the head.
  const box = () => app.run((m) => {
    const p = m.app.project, l = p.layers[0];
    const w = m.rig.computeWorld(l.rig, p.frames[0].poses[l.id]).get('head');
    return m.rig.boneMatrix(w, p.frames[0].poses[l.id]).slice(4);
  });
  const b0 = await box();
  const t = (await app.joints()).torso;
  await app.dragStage([t, [t[0] + 60, t[1] + 20]]);
  const b1 = await box();
  assert.ok(Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) > 5, 'bone art moved with the bone');
});

test('straight ruler snaps strokes started near it, others stay free', async () => {
  await app.key('b');
  await app.key('q');
  const before = (await app.strokes()).length;
  await app.dragStage(Array.from({ length: 11 }, (_, i) => [350 + i * 40, 372 + (i % 2 ? 12 : -8)]), 4);
  await app.dragStage(Array.from({ length: 7 }, (_, i) => [350 + i * 40, 560 + (i % 2 ? 20 : -20)]), 4);
  const s = await app.strokes();
  const snapped = ys(s[before]), free = ys(s[before + 1]);
  assert.ok(snapped.every((y) => Math.abs(y - 360) < 0.5), 'stroke lies exactly on the ruler');
  assert.ok(Math.max(...free) - Math.min(...free) > 20, 'far stroke kept its wobble');
});

test('ruler handles move the ruler instead of drawing', async () => {
  const count = (await app.strokes()).length;
  await app.dragStage([[960, 360], [960, 200]], 6);
  assert.deepEqual(await app.run((m) => m.app.ruler.b.map(Math.round)), [960, 200]);
  assert.equal((await app.strokes()).length, count);
  await app.shot('drawing-ruler');
});

test('circle ruler keeps strokes on the circle', async () => {
  await app.run((m) => m.cmds.runCommand('ruler-circle'));
  await app.dragStage(Array.from({ length: 9 }, (_, i) => {
    const a = -Math.PI / 2 + i * 0.15, r = 190 + (i % 2) * 10;
    return [640 + Math.cos(a) * r, 360 + Math.sin(a) * r];
  }), 4);
  const last = (await app.strokes()).at(-1);
  for (let i = 0; i < last.length; i += 2) assert.ok(Math.abs(Math.hypot(last[i] - 640, last[i + 1] - 360) - 180) < 1.5);
});

test('mirror symmetry adds a reflected copy, one undo removes both', async () => {
  await app.key('m');
  const before = (await app.strokes()).length;
  await app.dragStage([[500, 600], [560, 650]], 6);
  const s = await app.strokes();
  assert.equal(s.length, before + 2);
  const [a, b] = s.slice(-2);
  assert.ok(Math.abs(a[0] + b[0] - 1280) < 1 && Math.abs(a[1] - b[1]) < 1, 'copy is reflected across x = 640');
  await app.key('z', ['Control']);
  assert.equal((await app.strokes()).length, before);
  await app.key('q');
});

test('no console errors', () => assert.deepEqual(app.errors, []));
