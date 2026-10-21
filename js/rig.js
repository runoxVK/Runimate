// Stick figure math: forward kinematics, posing (rotate / stretch / IK), rig editing.
import { clamp, normAngle, DEG, chain, translate, rotate, scale, emptyBox, boxAdd, lerp, lerpAngle, uid } from './geom.js';

export const SHAPES = [
  { id: 'line', label: 'Line' },
  { id: 'circle', label: 'Ring' },
  { id: 'filled', label: 'Ball' },
  { id: 'box', label: 'Box' },
  { id: 'taper', label: 'Taper' },
  { id: 'none', label: 'Hidden' },
];

export const rootNode = (rig) => rig.nodes.find((n) => !n.parent) || rig.nodes[0];
export const nodeById = (rig, id) => rig.nodes.find((n) => n.id === id) || null;
export const childrenOf = (rig, id) => rig.nodes.filter((n) => n.parent === id);

export function defaultPose(rig, x, y, rootAngle = -Math.PI / 2) {
  return { x, y, r: rootAngle, s: 1, flip: false, a: {}, l: {} };
}

// world: Map(nodeId -> { x, y, ang, len, px, py, node, root })
export function computeWorld(rig, pose) {
  const byId = new Map(rig.nodes.map((n) => [n.id, n]));
  const out = new Map();
  const visit = (n, depth = 0) => {
    let w = out.get(n.id);
    if (w) return w;
    const parent = n.parent && byId.get(n.parent);
    if (!parent || depth > 200) {
      w = { x: pose.x, y: pose.y, ang: pose.r, len: 0, px: pose.x, py: pose.y, node: n, root: true };
    } else {
      const pw = visit(parent, depth + 1);
      const ang = pw.ang + (pose.a[n.id] ?? n.ang);
      const len = (pose.l[n.id] ?? n.len) * pose.s;
      w = { x: pw.x + Math.cos(ang) * len, y: pw.y + Math.sin(ang) * len, ang, len, px: pw.x, py: pw.y, node: n, root: false };
    }
    out.set(n.id, w);
    return w;
  };
  for (const n of rig.nodes) visit(n);
  return out;
}

// Matrix mapping bone-local art coordinates to stage coordinates.
export function boneMatrix(w, pose) {
  const art = w.node.art;
  const s = pose.s || 1;
  const raw = w.len / s;
  const k = !w.root && art && art.stretch !== false && art.base > 0 ? raw / art.base : 1;
  return chain(translate(w.px, w.py), rotate(w.ang), scale(s * k, s * (pose.flip ? -1 : 1)));
}

export function figureBounds(rig, world) {
  const b = emptyBox();
  for (const n of rig.nodes) {
    const w = world.get(n.id);
    const t = (n.thick || 0) / 2;
    boxAdd(b, w.x, w.y, t + 2);
    if (w.root) continue;
    boxAdd(b, w.px, w.py, t + 2);
    if (n.shape === 'circle' || n.shape === 'filled') {
      const cx = (w.x + w.px) / 2, cy = (w.y + w.py) / 2;
      boxAdd(b, cx, cy, w.len / 2 + t);
    }
  }
  return b;
}

export function poseRotate(pose, world, id, tx, ty, { stretch = false, snap = false } = {}) {
  const w = world.get(id);
  if (!w || w.root) return;
  const parentAng = world.get(w.node.parent).ang;
  let abs = Math.atan2(ty - w.py, tx - w.px);
  if (snap) abs = Math.round(abs / (15 * DEG)) * 15 * DEG;
  pose.a[id] = normAngle(abs - parentAng);
  if (stretch) pose.l[id] = Math.max(1, Math.hypot(tx - w.px, ty - w.py) / (pose.s || 1));
}

// Two-bone IK: moves the node toward the target by bending its parent joint.
export function poseIK(pose, world, id, tx, ty) {
  const c = world.get(id);
  if (!c || c.root) return;
  const b = world.get(c.node.parent);
  if (!b || b.root) return poseRotate(pose, world, id, tx, ty);
  const parentAng = world.get(b.node.parent).ang;
  const ax = b.px, ay = b.py, L1 = b.len, L2 = c.len;
  if (L1 < 1e-3 || L2 < 1e-3) return poseRotate(pose, world, id, tx, ty);
  const dx = tx - ax, dy = ty - ay;
  const d = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const base = Math.atan2(dy, dx);
  const alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const cross = (c.x - ax) * (b.y - ay) - (c.y - ay) * (b.x - ax);
  const t1 = base + (cross >= 0 ? 1 : -1) * alpha;
  const bx = ax + Math.cos(t1) * L1, by = ay + Math.sin(t1) * L1;
  const t2 = Math.atan2(ty - by, tx - bx);
  pose.a[b.node.id] = normAngle(t1 - parentAng);
  pose.a[c.node.id] = normAngle(t2 - t1);
}

export function flipPose(rig, pose) {
  pose.r = Math.PI - pose.r;
  for (const n of rig.nodes) if (n.parent) pose.a[n.id] = -(pose.a[n.id] ?? n.ang);
  pose.flip = !pose.flip;
}

export function lerpPose(rig, A, B, t) {
  const out = { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), r: lerp(A.r, B.r, t), s: lerp(A.s, B.s, t), flip: t < 0.5 ? A.flip : B.flip, a: {}, l: {} };
  for (const n of rig.nodes) {
    if (!n.parent) continue;
    out.a[n.id] = lerpAngle(A.a[n.id] ?? n.ang, B.a[n.id] ?? n.ang, t);
    out.l[n.id] = lerp(A.l[n.id] ?? n.len, B.l[n.id] ?? n.len, t);
  }
  return out;
}

export function addChildNode(rig, parentId) {
  const parent = nodeById(rig, parentId);
  const node = {
    id: uid('n'), parent: parentId, shape: 'line',
    thick: parent && parent.parent ? parent.thick : 10,
    color: parent && parent.parent ? parent.color : '#1b1b1f',
    len: 40, ang: 35 * DEG, art: null,
  };
  rig.nodes.push(node);
  return node;
}

export function descendants(rig, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of rig.nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}

export function deleteNode(rig, id) {
  const n = nodeById(rig, id);
  if (!n || !n.parent) return false;
  const gone = descendants(rig, id);
  rig.nodes = rig.nodes.filter((x) => !gone.has(x.id));
  return true;
}

// Draw order: later nodes paint on top.
export function moveNodeOrder(rig, id, dir) {
  const i = rig.nodes.findIndex((n) => n.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rig.nodes.length) return;
  [rig.nodes[i], rig.nodes[j]] = [rig.nodes[j], rig.nodes[i]];
}

// Bake a frame's pose into the rig defaults (used by "Set as default pose").
export function bakeDefaults(rig, pose) {
  for (const n of rig.nodes) {
    if (!n.parent) continue;
    n.ang = pose.a[n.id] ?? n.ang;
    n.len = pose.l[n.id] ?? n.len;
  }
}
