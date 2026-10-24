// Bucket fill: fills enclosed areas under the lines, supports holes and gap closing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

// Line strokes straight into the drawing layer: a square from (200,200) to (400,400),
// a ring inside it, and a square with a ~6px gap in its top-left corner.
const setup = () => app.run((m) => {
  const p = m.app.project, l = p.layers.find((x) => x.kind === 'draw');
  const line = (pts, closed = true) => ({ pts: pts.flatMap(([x, y]) => [x, y, 1]), w: 4, c: '#000000', o: 1, fill: null, closed });
  const ring = [];
  for (let i = 0; i < 48; i++) ring.push([300 + Math.cos((i / 48) * Math.PI * 2) * 40, 300 + Math.sin((i / 48) * Math.PI * 2) * 40]);
  m.curFrame().draws[l.id] = [
    line([[200, 200], [400, 200], [400, 400], [200, 400]]),
    line(ring),
    line([[610, 200], [800, 200], [800, 400], [600, 400], [600, 200]], false),
  ];
  m.app.activeLayer = l.id;
  m.changed('content');
});
const fills = () => app.run((m) => {
  const l = m.app.project.layers.find((x) => x.kind === 'draw');
  return m.curFrame().draws[l.id].map((s, i) => ({ i, fill: s.fill, holes: s.holes?.length || 0, n: s.pts.length / 3, xs: s.pts.filter((_, j) => j % 3 === 0), ys: s.pts.filter((_, j) => j % 3 === 1) })).filter((s) => s.fill);
});

test('tapping inside a closed shape fills it, under the lines', async () => {
  await setup();
  await app.page.focus('#stage-canvas');
  await app.key('g');
  await app.run((m) => { m.app.bucket = { color: '#ff0000', opacity: 1, gap: 0, allLayers: false }; });
  await app.dragStage([[220, 220], [220, 220]], 1);
  const f = await fills();
  assert.equal(f.length, 1);
  assert.equal(f[0].i, 0, 'the fill sits below the line strokes');
  assert.equal(f[0].fill, '#ff0000');
  // Its outline hugs the square (lines are 4px wide, the fill tucks under them).
  assert.ok(Math.min(...f[0].xs) >= 196 && Math.min(...f[0].xs) <= 203, `left edge ${Math.min(...f[0].xs)}`);
  assert.ok(Math.max(...f[0].xs) >= 397 && Math.max(...f[0].xs) <= 404, `right edge ${Math.max(...f[0].xs)}`);
  assert.equal(f[0].holes, 1, 'the ring inside is left as a hole');
  await app.shot('bucket-fill');
});

test('the hole really is empty: tapping it fills the inside of the ring separately', async () => {
  await app.run((m) => { m.app.bucket.color = '#0000ff'; });
  await app.dragStage([[300, 300], [300, 300]], 1);
  const f = await fills();
  assert.equal(f.length, 2);
  const blue = f.find((s) => s.fill === '#0000ff');
  assert.ok(Math.max(...blue.xs) - Math.min(...blue.xs) < 90, 'blue stays inside the ring');
});

test('tapping an existing fill recolours it instead of stacking', async () => {
  await app.run((m) => { m.app.bucket.color = '#00aa00'; });
  await app.dragStage([[300, 300], [300, 300]], 1);
  const f = await fills();
  assert.equal(f.length, 2);
  assert.ok(f.some((s) => s.fill === '#00aa00'));
});

test('“Close gaps” keeps the fill inside a shape with a small gap', async () => {
  await app.run((m) => { m.app.bucket = { color: '#ff00ff', opacity: 1, gap: 0, allLayers: false }; });
  await app.dragStage([[700, 300], [700, 300]], 1);
  let f = (await fills()).filter((s) => s.fill === '#ff00ff');
  assert.ok(Math.max(...f[0].xs) - Math.min(...f[0].xs) > 1000, 'without gap closing it leaks out across the canvas');
  await app.key('z', ['Control']);
  await app.run((m) => { m.app.bucket.gap = 5; });
  await app.dragStage([[700, 300], [700, 300]], 1);
  f = (await fills()).filter((s) => s.fill === '#ff00ff');
  assert.equal(f.length, 1);
  assert.ok(Math.max(...f[0].xs) - Math.min(...f[0].xs) < 215, 'with gap closing it stays in the square');
});

test('tapping a line does nothing', async () => {
  const before = (await fills()).length;
  await app.dragStage([[200, 300], [200, 300]], 1);
  assert.equal((await fills()).length, before);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
