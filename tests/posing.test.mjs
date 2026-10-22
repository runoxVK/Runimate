// Posing figures, frames, in-betweens and playback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, dist, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

test('starts with the default stickman and a drawing layer', async () => {
  const info = await app.run((m) => ({ layers: m.app.project.layers.map((l) => l.kind), nodes: m.app.project.layers[0].rig.nodes.length }));
  assert.deepEqual(info.layers, ['figure', 'draw']);
  assert.equal(info.nodes, 16);
  await app.shot('posing-start');
});

test('dragging a hand node rotates the forearm only', async () => {
  const before = await app.joints();
  const [hx, hy] = await app.toPage(...before.armR2);
  await app.drag([[hx, hy], [hx - 60, hy - 120]]);
  const after = await app.joints();
  assert.ok(dist(before.armR2, after.armR2) > 40, 'hand moved');
  assert.ok(dist(before.armR1, after.armR1) < 0.01, 'elbow stayed put');
  assert.ok(dist(before.torso, after.torso) < 0.01, 'body stayed put');
});

test('IK mode bends the elbow to reach toward the pointer', async () => {
  await app.key('3');
  const before = await app.joints();
  const target = [before.armL2[0] + 25, before.armL2[1] + 25];
  await app.dragStage([before.armL2, target]);
  const after = await app.joints();
  assert.ok(dist(before.armL1, after.armL1) > 1, 'elbow moved');
  assert.ok(dist(after.armL2, target) < dist(before.armL2, target), 'hand got closer to the target');
  assert.ok(dist(before.torso, after.torso) < 0.01, 'shoulder stayed put');
  await app.key('1');
});

test('dragging the square main node moves the whole figure', async () => {
  const before = await app.joints();
  await app.dragStage([before.root, [before.root[0] + 50, before.root[1]]]);
  const after = await app.joints();
  for (const k of ['root', 'head', 'armL2', 'legR2']) assert.ok(Math.abs(after[k][0] - before[k][0] - 50) < 1, `${k} shifted`);
});

test('keyboard posing: Tab picks joints, arrows rotate and stretch', async () => {
  await app.page.focus('#stage-canvas');
  await app.run((m) => { const l = m.app.project.layers[0]; m.select({ type: 'figure', id: l.id, node: null }); });
  await app.key('Tab');
  await app.key('Tab');
  const node = await app.run((m) => m.app.sel.node);
  const read = () => app.run((m) => { const s = m.app.sel, p = m.curFrame().poses[s.id], n = m.rig.nodeById(m.app.project.layers[0].rig, s.node); return [p.a[s.node] ?? n.ang, p.l[s.node] ?? n.len]; });
  const [a0, l0] = await read();
  await app.key('ArrowRight');
  await app.key('ArrowUp');
  const [a1, l1] = await read();
  assert.ok(node, 'a joint is selected');
  assert.ok(Math.abs(a1 - a0 - (5 * Math.PI) / 180) < 1e-6, 'rotated 5 degrees');
  assert.equal(l1, l0 + 5, 'stretched 5px');
  await app.key('Escape');
});

test('new frames copy poses, in-betweens tween, holds hold', async () => {
  await app.key('n');
  const pose2 = await app.joints();
  await app.dragStage([pose2.legL2, [pose2.legL2[0] + 60, pose2.legL2[1] - 40]]);
  await app.run((m) => { m.goto(0); m.A.nudgeInbetweens(3); });
  const r = await app.run((m) => {
    const p = m.app.project, l = p.layers[0];
    const foot = (e) => { const st = m.T.evalEntry(p, e); return m.rig.computeWorld(l.rig, st.poses[l.id]).get('legL2').x; };
    const e = m.T.expand(p);
    const tweened = e.slice(0, 5).map(foot);
    p.frames[0].tween = false;
    const held = m.T.expand(p).slice(0, 4).map(foot);
    p.frames[0].tween = true;
    return { frames: p.frames.length, total: e.length, tweened, held };
  });
  assert.equal(r.frames, 2);
  assert.equal(r.total, 2 + 3);
  for (let i = 1; i < 5; i++) assert.ok(r.tweened[i] > r.tweened[i - 1], 'foot moves steadily through the in-betweens');
  assert.ok(r.held.every((x) => Math.abs(x - r.held[0]) < 1e-9), 'hold keeps the pose');
});

test('frames can be reordered by dragging thumbnails', async () => {
  await app.key('n');
  const ids = () => app.run((m) => m.app.project.frames.map((f) => f.id));
  const before = await ids();
  const thumbs = await app.page.$$('.frame-thumb');
  const b3 = await thumbs[2].boundingBox(), b1 = await thumbs[0].boundingBox();
  await app.drag([[b3.x + b3.width / 2, b3.y + 20], [b1.x + 5, b1.y + 20]], 12);
  const after = await ids();
  assert.deepEqual(after, [before[2], before[0], before[1]]);
});

test('playback advances frames and stops on Space', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('Space');
  await sleep(600);
  const playing = await app.run((m) => [m.app.playing, m.app.playEntry]);
  await app.key('Space');
  const stopped = await app.run((m) => m.app.playing);
  assert.equal(playing[0], true);
  assert.ok(playing[1] > 0, 'playhead moved');
  assert.equal(stopped, false);
});

test('undo and redo walk the whole history', async () => {
  const r = await app.run((m) => {
    const before = JSON.stringify(m.app.project.frames.map((f) => f.poses));
    let n = 0;
    while (m.undo()) n++;
    const start = m.app.project.frames.length;
    while (m.redo());
    return { n, start, same: JSON.stringify(m.app.project.frames.map((f) => f.poses)) === before };
  });
  assert.ok(r.n > 5);
  assert.equal(r.start, 1, 'undo all the way returns to a single frame');
  assert.ok(r.same, 'redo restores everything');
});

test('no console errors', () => assert.deepEqual(app.errors, []));
