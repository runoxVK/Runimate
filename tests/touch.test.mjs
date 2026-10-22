// iPad-style input: Apple Pencil pressure, finger panning, pinch zoom, two-finger tap undo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, sleep } from './helpers.mjs';

let app, cdp;
before(async () => {
  app = await openApp({ width: 820, height: 1180, touch: true });
  cdp = await app.page.createCDPSession();
});
after(() => app?.close());

const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
const view = () => app.run((m) => ({ ...m.stage.view }));
const strokeCount = () => app.strokes().then((s) => s.length);

test('portrait layout tucks the side panel away', async () => {
  assert.equal(await app.page.evaluate(() => document.body.classList.contains('panel-closed')), true);
  await app.shot('touch-portrait');
});

test('pen strokes record pressure', async () => {
  await app.key('b');
  const pen = (type, [x, y], force) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force });
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push(await app.toPage(300 + i * 20, 300 + Math.sin(i / 3) * 60));
  await pen('mousePressed', pts[0], 0.2);
  for (let i = 1; i < pts.length; i++) await pen('mouseMoved', pts[i], 0.2 + 0.8 * (i / pts.length));
  await pen('mouseReleased', pts.at(-1), 0);
  await sleep(100);
  const p = await app.run((m) => { const l = m.app.project.layers.find((x) => x.kind === 'draw'); const s = m.curFrame().draws[l.id][0]; return [s.pts[2], s.pts[Math.floor(s.pts.length / 6) * 3 + 2]]; });
  assert.ok(p[1] > p[0] * 2, 'width follows pen pressure');
  assert.equal(await app.run((m) => m.app.fingerDraws), false, 'fingers stop drawing once a pen is used');
});

test('one finger pans instead of drawing after a pen was used', async () => {
  const v0 = await view(), n0 = await strokeCount();
  await touch('touchStart', [{ x: 400, y: 600, id: 1 }]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: 400 + i * 20, y: 600, id: 1 }]);
  await touch('touchEnd', []);
  const v1 = await view();
  assert.ok(Math.abs(v1.x - v0.x - 100) < 2, 'view panned with the finger');
  assert.equal(await strokeCount(), n0, 'no stroke drawn');
});

test('pinch zooms', async () => {
  const v0 = await view();
  await touch('touchStart', [{ x: 350, y: 600, id: 1 }, { x: 450, y: 600, id: 2 }]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: 350 - i * 20, y: 600, id: 1 }, { x: 450 + i * 20, y: 600, id: 2 }]);
  await touch('touchEnd', []);
  const v1 = await view();
  assert.ok(Math.abs(v1.z / v0.z - 3) < 0.05, 'spreading fingers 3x zooms 3x');
});

test('two-finger tap undoes', async () => {
  const n0 = await strokeCount();
  await touch('touchStart', [{ x: 350, y: 600, id: 1 }, { x: 450, y: 600, id: 2 }]);
  await sleep(80);
  await touch('touchEnd', []);
  await sleep(100);
  assert.equal(await strokeCount(), n0 - 1);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
