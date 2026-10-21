// Scene rendering shared by the stage, thumbnails and exporters.
// All functions draw in stage coordinates on a context that already has the view transform.
import { TAU, xfMatrix, IDENT_XF } from './geom.js';
import { computeWorld, boneMatrix } from './rig.js';
import { drawStrokes } from './brush.js';
import { getStrokes } from './model.js';

const images = new Map();
export let onImageLoad = () => {};
export const setImageLoadHandler = (fn) => (onImageLoad = fn);

export function getImage(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const scratch = new Map();
export function scratchCanvas(key, w, h) {
  let c = scratch.get(key);
  if (!c) scratch.set(key, (c = document.createElement('canvas')));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

const tf = (ctx, m) => ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);

export function drawFigure(ctx, layer, pose) {
  const rig = layer.rig;
  const world = computeWorld(rig, pose);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const n of rig.nodes) {
    const w = world.get(n.id);
    if (!w.root) drawSegment(ctx, n, w, pose.s);
    if (n.art && n.art.strokes.length) {
      ctx.save();
      tf(ctx, boneMatrix(w, pose));
      drawStrokes(ctx, n.art.strokes);
      ctx.restore();
    }
  }
  return world;
}

function drawSegment(ctx, n, w, s) {
  const th = Math.max(0.5, n.thick * s);
  ctx.strokeStyle = ctx.fillStyle = n.color;
  ctx.lineWidth = th;
  switch (n.shape) {
    case 'line':
    case 'box':
      ctx.lineCap = n.shape === 'box' ? 'butt' : 'round';
      ctx.beginPath();
      ctx.moveTo(w.px, w.py);
      ctx.lineTo(w.x, w.y);
      ctx.stroke();
      ctx.lineCap = 'round';
      break;
    case 'circle':
    case 'filled': {
      const cx = (w.px + w.x) / 2, cy = (w.py + w.y) / 2;
      ctx.beginPath();
      if (n.shape === 'circle') {
        ctx.arc(cx, cy, Math.max(0.1, w.len / 2), 0, TAU);
        ctx.stroke();
      } else {
        ctx.arc(cx, cy, w.len / 2 + th / 2, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'taper': {
      const dx = w.x - w.px, dy = w.y - w.py, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, r0 = th / 2, r1 = th * 0.08;
      ctx.beginPath();
      ctx.moveTo(w.px + nx * r0, w.py + ny * r0);
      ctx.lineTo(w.x + nx * r1, w.y + ny * r1);
      ctx.lineTo(w.x - nx * r1, w.y - ny * r1);
      ctx.lineTo(w.px - nx * r0, w.py - ny * r0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w.px, w.py, r0, 0, TAU);
      ctx.fill();
      break;
    }
  }
}

export function layerMatrix(layer, xf) {
  return xfMatrix(xf || IDENT_XF, layer.pv);
}

export function drawLayer(ctx, layer, st) {
  if (layer.kind === 'figure') {
    const pose = st.poses[layer.id];
    if (pose) drawFigure(ctx, layer, pose);
  } else if (layer.kind === 'draw') {
    const strokes = getStrokes(layer, st.frame);
    if (!strokes.length) return;
    ctx.save();
    tf(ctx, layerMatrix(layer, st.xf[layer.id]));
    drawStrokes(ctx, strokes);
    ctx.restore();
  } else if (layer.kind === 'image') {
    const img = getImage(layer.src);
    if (!img) return;
    ctx.save();
    tf(ctx, layerMatrix(layer, st.xf[layer.id]));
    ctx.drawImage(img, 0, 0, layer.w, layer.h);
    ctx.restore();
  }
}

// opts: { bg: false | color, filter(layer) }
export function renderScene(ctx, p, st, opts = {}) {
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, p.width, p.height);
  }
  for (const layer of p.layers) {
    if (!layer.visible) continue;
    if (opts.filter && !opts.filter(layer)) continue;
    const op = layer.opacity ?? 1;
    if (op <= 0) continue;
    if (op >= 1 || layer.kind === 'image') {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * op;
      drawLayer(ctx, layer, st);
      ctx.globalAlpha = a;
      continue;
    }
    // Translucent layer: draw it opaque into a scratch canvas, then composite once.
    const c = scratchCanvas('group', ctx.canvas.width, ctx.canvas.height);
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(ctx.getTransform());
    drawLayer(g, layer, st);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= op;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
}

// Renders a frame into a fresh canvas (thumbnails, export, assets).
export function renderToCanvas(p, st, w, h, { bg = p.bg, canvas } = {}) {
  const c = canvas || document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.setTransform(w / p.width, 0, 0, h / p.height, 0, 0);
  if (!bg) ctx.clearRect(0, 0, p.width, p.height);
  renderScene(ctx, p, st, { bg });
  return c;
}
