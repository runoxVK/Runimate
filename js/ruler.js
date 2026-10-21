// Drawing guides: a straight ruler, a circle ruler and mirror symmetry.
// Positions are in stage coordinates and kept in prefs (they're a drawing aid, not artwork).
import { app, P, changed } from './app.js';
import { chain, translate, scale, DEG } from './geom.js';

export const RULER_TYPES = [
  ['off', 'Off'],
  ['line', 'Straight'],
  ['circle', 'Circle'],
  ['mirror', 'Mirror'],
];
const RULER_TOOLS = new Set(['brush', 'eraser', 'fill', 'line', 'rect', 'ellipse']);

export function ruler() {
  const p = P();
  const W = p?.width || 1280, H = p?.height || 720;
  app.ruler ||= {};
  const r = app.ruler;
  r.type ||= 'off';
  r.last ||= 'line';
  r.a ||= [W * 0.25, H * 0.5];
  r.b ||= [W * 0.75, H * 0.5];
  r.c ||= [W / 2, H / 2];
  r.r ||= H / 4;
  r.ra ??= 0;
  r.m ||= [W / 2, H / 2];
  r.axis ||= 'v';
  r.anywhere ??= false;
  return r;
}

export function resetRuler() {
  const t = ruler().type, last = app.ruler.last, anywhere = app.ruler.anywhere;
  app.ruler = { type: t, last, anywhere };
  ruler();
  changed('pref-save', 'content', 'ruler');
}

export function setRulerType(t) {
  const r = ruler();
  r.type = t;
  if (t !== 'off') r.last = t;
  changed('pref-save', 'content', 'ruler');
}
export const toggleRuler = () => setRulerType(ruler().type === 'off' ? ruler().last : 'off');

// Guides only show (and snap) while a drawing tool is active.
export const rulerVisible = () => ruler().type !== 'off' && RULER_TOOLS.has(app.tool);

// Decides at stroke start whether the stroke follows the guide. Returns a projector or null.
export function snapper(x, y, zoom) {
  if (!rulerVisible()) return null;
  const r = ruler(), reach = 30 / zoom;
  if (r.type === 'line') {
    const [ax, ay] = r.a, dx = r.b[0] - ax, dy = r.b[1] - ay, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const off = (x - ax) * -uy + (y - ay) * ux; // signed distance from the ruler line
    if (!r.anywhere && Math.abs(off) > reach) return null;
    const k = r.anywhere ? off : 0; // "anywhere" draws parallel lines through the start point
    const ox = ax - uy * k, oy = ay + ux * k;
    return (px, py) => {
      const t = (px - ox) * ux + (py - oy) * uy;
      return [ox + ux * t, oy + uy * t];
    };
  }
  if (r.type === 'circle') {
    const [cx, cy] = r.c, d = Math.hypot(x - cx, y - cy);
    if (!r.anywhere && Math.abs(d - r.r) > reach) return null;
    const rad = r.anywhere ? d : r.r; // "anywhere" draws concentric circles
    return (px, py) => {
      const a = Math.atan2(py - cy, px - cx);
      return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
    };
  }
  return null;
}

// Stage-space reflection for mirror symmetry, or null.
export function mirrorMatrix() {
  if (!rulerVisible() || ruler().type !== 'mirror') return null;
  const [mx, my] = ruler().m;
  return ruler().axis === 'v' ? chain(translate(mx, 0), scale(-1, 1), translate(-mx, 0)) : chain(translate(0, my), scale(1, -1), translate(0, -my));
}

export function rulerHandles() {
  if (!rulerVisible()) return [];
  const r = ruler(), p = P();
  if (r.type === 'line') return [{ id: 'a', p: r.a }, { id: 'b', p: r.b }, { id: 'mid', p: [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2] }];
  if (r.type === 'circle') return [{ id: 'c', p: r.c }, { id: 'rim', p: [r.c[0] + Math.cos(r.ra) * r.r, r.c[1] + Math.sin(r.ra) * r.r] }];
  if (r.type === 'mirror') return [{ id: 'axis', p: r.axis === 'v' ? [r.m[0], p.height / 2] : [p.width / 2, r.m[1]] }];
  return [];
}

// Moves a handle; `start` holds the ruler as it was when the drag began.
export function dragRulerHandle(id, x, y, x0, y0, start, snapAngle) {
  const r = ruler();
  const dx = x - x0, dy = y - y0;
  if (id === 'a' || id === 'b') {
    const other = id === 'a' ? start.b : start.a;
    let p = [start[id][0] + dx, start[id][1] + dy];
    if (snapAngle) {
      const a = Math.round(Math.atan2(p[1] - other[1], p[0] - other[0]) / (15 * DEG)) * 15 * DEG;
      const L = Math.hypot(p[0] - other[0], p[1] - other[1]);
      p = [other[0] + Math.cos(a) * L, other[1] + Math.sin(a) * L];
    }
    r[id] = p;
  } else if (id === 'mid') {
    r.a = [start.a[0] + dx, start.a[1] + dy];
    r.b = [start.b[0] + dx, start.b[1] + dy];
  } else if (id === 'c') r.c = [start.c[0] + dx, start.c[1] + dy];
  else if (id === 'rim') {
    r.r = Math.max(4, Math.hypot(x - r.c[0], y - r.c[1]));
    r.ra = Math.atan2(y - r.c[1], x - r.c[0]);
  } else if (id === 'axis') r.m = [start.m[0] + dx, start.m[1] + dy];
}

export function lineAngle() {
  const r = ruler();
  return (Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]) * 180) / Math.PI;
}
export function setLineAngle(deg) {
  const r = ruler();
  const cx = (r.a[0] + r.b[0]) / 2, cy = (r.a[1] + r.b[1]) / 2;
  const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) / 2;
  const a = deg * DEG;
  r.a = [cx - Math.cos(a) * L, cy - Math.sin(a) * L];
  r.b = [cx + Math.cos(a) * L, cy + Math.sin(a) * L];
  changed('pref-save', 'content');
}
export function nudgeRuler(dx, dy) {
  const r = ruler();
  if (r.type === 'line') { r.a = [r.a[0] + dx, r.a[1] + dy]; r.b = [r.b[0] + dx, r.b[1] + dy]; }
  else if (r.type === 'circle') r.c = [r.c[0] + dx, r.c[1] + dy];
  else if (r.type === 'mirror') r.m = [r.m[0] + dx, r.m[1] + dy];
  changed('pref-save', 'content');
}

// ---------------------------------------------------------------- drawing (screen space)
const BLUE = 'rgba(77,163,255,';

function handle(ctx, x, y, kind = 'circle') {
  ctx.beginPath();
  if (kind === 'diamond') {
    ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath();
  } else ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BLUE + '1)';
  ctx.stroke();
}

export function drawRuler(ctx, toScreen, zoom, snapping) {
  if (!rulerVisible()) return;
  const r = ruler(), p = P();
  ctx.save();
  const guide = snapping ? BLUE + '.95)' : BLUE + '.55)';
  if (r.type === 'line') {
    const A = toScreen(...r.a), B = toScreen(...r.b);
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    // Infinite guide line.
    ctx.strokeStyle = guide;
    ctx.lineWidth = snapping ? 2 : 1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(A[0] - ux * 1e4, A[1] - uy * 1e4);
    ctx.lineTo(B[0] + ux * 1e4, B[1] + uy * 1e4);
    ctx.stroke();
    ctx.setLineDash([]);
    // Ruler body with tick marks every 10 px of canvas.
    const w = 26;
    ctx.beginPath();
    ctx.moveTo(A[0], A[1]);
    ctx.lineTo(B[0], B[1]);
    ctx.lineTo(B[0] + nx * w, B[1] + ny * w);
    ctx.lineTo(A[0] + nx * w, A[1] + ny * w);
    ctx.closePath();
    ctx.fillStyle = 'rgba(235,240,250,.22)';
    ctx.fill();
    ctx.strokeStyle = BLUE + '.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const stageLen = L / zoom;
    const step = 10 * zoom >= 5 ? 10 : 10 * zoom * 5 >= 5 ? 50 : 100;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 0; t <= stageLen; t += step) {
      const len = t % (step * 10) === 0 ? 14 : t % (step * 5) === 0 ? 10 : 6;
      const px = A[0] + ux * t * zoom, py = A[1] + uy * t * zoom;
      ctx.moveTo(px, py);
      ctx.lineTo(px + nx * len, py + ny * len);
    }
    ctx.stroke();
    handle(ctx, ...A);
    handle(ctx, ...B);
    handle(ctx, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 'diamond');
  } else if (r.type === 'circle') {
    const C = toScreen(...r.c), R = r.r * zoom;
    ctx.strokeStyle = guide;
    ctx.lineWidth = snapping ? 2 : 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(C[0], C[1], R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(C[0] - 10, C[1]); ctx.lineTo(C[0] + 10, C[1]);
    ctx.moveTo(C[0], C[1] - 10); ctx.lineTo(C[0], C[1] + 10);
    ctx.stroke();
    handle(ctx, C[0], C[1], 'diamond');
    handle(ctx, C[0] + Math.cos(r.ra) * R, C[1] + Math.sin(r.ra) * R);
  } else if (r.type === 'mirror') {
    const vertical = r.axis === 'v';
    const A = vertical ? toScreen(r.m[0], -1e5) : toScreen(-1e5, r.m[1]);
    const B = vertical ? toScreen(r.m[0], 1e5) : toScreen(1e5, r.m[1]);
    ctx.strokeStyle = 'rgba(199,125,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(...A);
    ctx.lineTo(...B);
    ctx.stroke();
    ctx.setLineDash([]);
    const H = vertical ? toScreen(r.m[0], p.height / 2) : toScreen(p.width / 2, r.m[1]);
    handle(ctx, ...H, 'diamond');
  }
  ctx.restore();
}
