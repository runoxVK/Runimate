// Figure joining: a figure layer can be attached to a joint of another figure
// (layer.join = { parent: layerId, node: nodeId, scale: bool }). Its pose's x / y / r / s
// are then stored in that joint's local space, so it follows the joint on every frame.
import { computeWorld } from './rig.js';

export function jointToWorld(local, w, k) {
  const c = Math.cos(w.ang), s = Math.sin(w.ang);
  return { ...local, x: w.x + (c * local.x - s * local.y) * k, y: w.y + (s * local.x + c * local.y) * k, r: local.r + w.ang, s: local.s * k };
}
export function worldToJoint(world, w, k) {
  const dx = (world.x - w.x) / k, dy = (world.y - w.y) / k;
  const c = Math.cos(w.ang), s = Math.sin(w.ang);
  return { ...world, x: c * dx + s * dy, y: -s * dx + c * dy, r: world.r - w.ang, s: world.s / k };
}

// World-space poses for every figure in a frame state ({ poses }). Joined figures whose
// parent isn't in the frame resolve to null (they're hidden on that frame).
export function resolvePoses(p, st) {
  const out = {};
  const busy = new Set();
  const byId = new Map(p.layers.map((l) => [l.id, l]));
  const get = (id) => {
    if (id in out) return out[id];
    const layer = byId.get(id), local = st.poses[id];
    if (!layer || layer.kind !== 'figure' || !local) return (out[id] = null);
    const j = layer.join;
    if (!j || busy.has(id)) return (out[id] = local);
    busy.add(id);
    const parent = byId.get(j.parent);
    const pp = parent ? get(j.parent) : null;
    busy.delete(id);
    if (!pp) return (out[id] = null);
    const w = computeWorld(parent.rig, pp).get(j.node);
    return (out[id] = w ? jointToWorld(local, w, j.scale !== false ? pp.s : 1) : local);
  };
  for (const l of p.layers) if (l.kind === 'figure') get(l.id);
  return out;
}

// The joint a joined layer follows on a frame, or null.
export function jointFrame(p, frame, layer) {
  const j = layer.join;
  if (!j) return null;
  const parent = p.layers.find((l) => l.id === j.parent);
  const pp = parent && resolvePoses(p, { poses: frame.poses })[j.parent];
  if (!pp) return null;
  const w = computeWorld(parent.rig, pp).get(j.node);
  return w ? { w, k: j.scale !== false ? pp.s : 1 } : null;
}

// Converts a world-space delta into the joined figure's local space.
export function localDelta(p, frame, layer, dx, dy) {
  const jf = jointFrame(p, frame, layer);
  if (!jf) return [dx, dy];
  const c = Math.cos(jf.w.ang), s = Math.sin(jf.w.ang);
  return [(c * dx + s * dy) / jf.k, (-s * dx + c * dy) / jf.k];
}

// True if making `parentId` the parent of `childId` would create a loop.
export function wouldCycle(p, childId, parentId) {
  let id = parentId;
  for (let i = 0; id && i < 100; i++) {
    if (id === childId) return true;
    id = p.layers.find((l) => l.id === id)?.join?.parent;
  }
  return false;
}

export function joinLayer(p, child, parent, nodeId, fallbackFrame) {
  const fb = { poses: fallbackFrame.poses };
  for (const f of p.frames) {
    const world = resolvePoses(p, f)[child.id];
    if (!world) continue;
    let pp = resolvePoses(p, f)[parent.id];
    if (!pp) pp = resolvePoses(p, fb)[parent.id];
    if (!pp) continue;
    const w = computeWorld(parent.rig, pp).get(nodeId);
    const local = worldToJoint(world, w, pp.s);
    f.poses[child.id] = { ...f.poses[child.id], x: local.x, y: local.y, r: local.r, s: local.s };
  }
  child.join = { parent: parent.id, node: nodeId, scale: true };
}

export function detachLayer(p, layer) {
  if (!layer.join) return;
  for (const f of p.frames) {
    const world = resolvePoses(p, f)[layer.id];
    if (world) f.poses[layer.id] = { ...f.poses[layer.id], x: world.x, y: world.y, r: world.r, s: world.s };
  }
  delete layer.join;
}

// Detach everything that hangs off a layer (or one of its joints) before it goes away.
export function detachChildren(p, parentId, nodeIds = null) {
  for (const l of p.layers) {
    if (l.join?.parent === parentId && (!nodeIds || nodeIds.has(l.join.node))) detachLayer(p, l);
  }
}

// Keeps world placement while toggling "scale with parent".
export function setJoinScale(p, layer, on) {
  if (!layer.join || (layer.join.scale !== false) === on) return;
  const worlds = p.frames.map((f) => resolvePoses(p, f)[layer.id]);
  layer.join.scale = on;
  p.frames.forEach((f, i) => {
    const jf = jointFrame(p, f, layer);
    if (!worlds[i] || !jf) return;
    const local = worldToJoint(worlds[i], jf.w, jf.k);
    f.poses[layer.id] = { ...f.poses[layer.id], x: local.x, y: local.y, r: local.r, s: local.s };
  });
}
