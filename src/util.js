// Small math and randomness helpers shared by every module.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const sign = (v) => (v < 0 ? -1 : 1);
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const angLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};

// Distance from point P to segment AB, plus the closest point.
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  const cx = ax + dx * t, cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), x: cx, y: cy, t };
}

// Weighted random choice: items [{w, ...}] -> item
export function weighted(items) {
  let total = 0;
  for (const it of items) total += Math.max(0, it.w);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, it.w);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// Ramer–Douglas–Peucker polyline simplification.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i].x, pts[i].y, a.x, a.y, b.x, b.y).d;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const l = simplify(pts.slice(0, idx + 1), eps);
  const r = simplify(pts.slice(idx), eps);
  return l.slice(0, -1).concat(r);
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

let uid = 0;
export const nextId = (p = 'e') => `${p}${++uid}`;
