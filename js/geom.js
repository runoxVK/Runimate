// Small 2D math helpers. Affine matrices are [a, b, c, d, e, f]:
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function normAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const lerpAngle = (a, b, t) => a + normAngle(b - a) * t;

export const EASES = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

export const ident = () => [1, 0, 0, 1, 0, 0];
export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translate = (x, y) => [1, 0, 0, 1, x, y];
export function rotate(r) {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export const chain = (...ms) => ms.reduce((acc, m) => mul(acc, m));

// Layer transform: translate(x,y) then rotate/scale about the layer pivot.
export const IDENT_XF = Object.freeze({ x: 0, y: 0, r: 0, s: 1 });
export function xfMatrix(xf, pv) {
  const px = pv ? pv[0] : 0, py = pv ? pv[1] : 0;
  return chain(translate(xf.x + px, xf.y + py), rotate(xf.r), scale(xf.s), translate(-px, -py));
}

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Point-in-polygon on a flat array with the given stride (x, y first).
export function pointInPoly(x, y, pts, stride = 2) {
  let inside = false;
  const n = pts.length / stride;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * stride], yi = pts[i * stride + 1];
    const xj = pts[j * stride], yj = pts[j * stride + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export const emptyBox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export function boxAdd(b, x, y, pad = 0) {
  if (x - pad < b.x0) b.x0 = x - pad;
  if (y - pad < b.y0) b.y0 = y - pad;
  if (x + pad > b.x1) b.x1 = x + pad;
  if (y + pad > b.y1) b.y1 = y + pad;
  return b;
}
export const boxValid = (b) => b.x1 >= b.x0 && b.y1 >= b.y0;
export function boxTransform(b, m) {
  const out = emptyBox();
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
    const p = apply(m, x, y);
    boxAdd(out, p[0], p[1]);
  }
  return out;
}

export const round2 = (v) => Math.round(v * 100) / 100;

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + (Date.now() % 1e6).toString(36);
}
