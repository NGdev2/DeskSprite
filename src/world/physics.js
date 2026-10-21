// Tiny physics: one-way platforms (floor, widget tops, resting objects), a verlet ragdoll
// for the stickman, and impulse-based rigid bodies for drawn objects, files, balls and debris.
import { clamp } from '../util.js';

export const GRAVITY = 1500;

// Platforms are one-way: things land on their top edge when coming from above.
// p = {x1, x2, y, kind, ref}
export function landing(platforms, x, prevY, y, skip) {
  let best = null;
  for (const p of platforms) {
    if (p === skip || x < p.x1 || x > p.x2) continue;
    if (prevY <= p.y + 0.5 && y >= p.y && (!best || p.y < best.y)) best = p;
  }
  return best;
}

// The highest platform at or below y (within `slack` above) under x.
export function platformUnder(platforms, x, y, slack = 2) {
  let best = null;
  for (const p of platforms) {
    if (x < p.x1 || x > p.x2 || p.y < y - slack) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

// ------------------------------------------------------------------ ragdoll
const LINKS = [
  ['hip', 'neck'], ['neck', 'head'], ['hip', 'sh'], ['sh', 'neck'],
  ['sh', 'e1'], ['e1', 'h1'], ['sh', 'e2'], ['e2', 'h2'],
  ['hip', 'k1'], ['k1', 'f1'], ['hip', 'k2'], ['k2', 'f2'],
  ['hip', 'head', 0.4], ['k1', 'k2', 0.05], ['neck', 'k1', 0.05], ['neck', 'k2', 0.05],
];
export const JOINTS = ['hip', 'neck', 'head', 'sh', 'e1', 'h1', 'e2', 'h2', 'k1', 'f1', 'k2', 'f2'];

export class Ragdoll {
  constructor(J, vx = 0, vy = 0, dt = 1 / 60) {
    this.p = {};
    for (const k of JOINTS) {
      const [x, y] = J[k];
      this.p[k] = { x, y, px: x - vx * dt, py: y - vy * dt };
    }
    this.links = LINKS.map(([a, b, stiff = 1]) => ({
      a, b, stiff, len: Math.hypot(J[a][0] - J[b][0], J[a][1] - J[b][1]),
    }));
    this.pin = null;   // {k, x, y}
    this.rest = 0;     // seconds spent nearly still on the ground
    this.grounded = false;
  }

  kick(vx, vy, only) {
    for (const k of only || JOINTS) {
      const q = this.p[k];
      q.px -= vx / 60; q.py -= vy / 60;
    }
  }

  velocity() {
    const q = this.p.hip;
    return [(q.x - q.px) * 60, (q.y - q.py) * 60];
  }

  step(dt, world) {
    const h = Math.min(dt, 1 / 30);
    const { platforms, w } = world;
    for (const k of JOINTS) {
      const q = this.p[k];
      const vx = (q.x - q.px) * 0.995, vy = (q.y - q.py) * 0.995;
      q.px = q.x; q.py = q.y;
      q.x += vx; q.y += vy + GRAVITY * h * h;
    }
    if (this.pin) {
      const q = this.p[this.pin.k];
      q.x = this.pin.x; q.y = this.pin.y;
    }
    let ground = 0;
    for (let it = 0; it < 6; it++) {
      for (const L of this.links) {
        const A = this.p[L.a], B = this.p[L.b];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = ((d - L.len) / d) * 0.5 * L.stiff;
        const pinA = this.pin && this.pin.k === L.a, pinB = this.pin && this.pin.k === L.b;
        const fa = pinA ? 0 : pinB ? 2 : 1, fb = pinB ? 0 : pinA ? 2 : 1;
        A.x += dx * diff * fa; A.y += dy * diff * fa;
        B.x -= dx * diff * fb; B.y -= dy * diff * fb;
      }
      ground = 0;
      for (const k of JOINTS) {
        const q = this.p[k];
        const r = k === 'head' ? 8 : 2;
        const pl = landing(platforms, q.x, q.py + r, q.y + r);
        if (pl) {
          q.y = pl.y - r;
          q.px = q.x - (q.x - q.px) * 0.6; // ground friction
          ground++;
        }
        if (q.x < r) { q.x = r; q.px = q.x + (q.x - q.px) * 0.5; }
        if (q.x > w - r) { q.x = w - r; q.px = q.x + (q.x - q.px) * 0.5; }
      }
    }
    this.grounded = ground >= 2;
    const [vx, vy] = this.velocity();
    if (this.grounded && Math.hypot(vx, vy) < 40 && !this.pin) this.rest += dt;
    else this.rest = 0;
  }

  joints() {
    const J = {};
    for (const k of JOINTS) J[k] = [this.p[k].x, this.p[k].y];
    return J;
  }

  nearest(x, y) {
    let best = null, bd = Infinity;
    for (const k of JOINTS) {
      const d = Math.hypot(this.p[k].x - x, this.p[k].y - y);
      if (d < bd) { bd = d; best = k; }
    }
    return { k: best, d: bd };
  }
}

// --------------------------------------------------------------- rigid body
// shape: {type:'poly', pts:[{x,y}] (local, centered), closed} | {type:'circle', r}
export class Body {
  constructor(shape, x, y, opts = {}) {
    this.shape = shape;
    this.x = x; this.y = y;
    this.a = opts.angle || 0;
    this.vx = opts.vx || 0; this.vy = opts.vy || 0; this.w = opts.w || 0;
    this.e = opts.restitution ?? 0.25;
    this.mu = opts.friction ?? 0.5;
    this.density = opts.density ?? 1;
    this.static = !!opts.static;
    this.sleep = 0;
    this.held = null;
    this.ground = null;
    this.computeMass();
  }

  computeMass() {
    const s = this.shape;
    if (s.type === 'circle') {
      this.m = Math.PI * s.r * s.r * 0.01 * this.density;
      this.I = 0.5 * this.m * s.r * s.r;
      this.radius = s.r;
    } else {
      let m = 0, I = 0, R = 0;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        const q = s.pts[(i + 1) % s.pts.length];
        const L = i < s.pts.length - 1 || s.closed ? Math.hypot(q.x - p.x, q.y - p.y) : 0;
        const dm = Math.max(1, L) * 0.06 * this.density;
        m += dm;
        I += dm * (p.x * p.x + p.y * p.y);
        R = Math.max(R, Math.hypot(p.x, p.y));
      }
      if (s.area) { m += s.area * 0.004 * this.density; I += s.area * 0.004 * this.density * R * R * 0.4; }
      this.m = Math.max(0.5, m);
      this.I = Math.max(10, I);
      this.radius = R;
    }
  }

  worldPts() {
    const s = this.shape;
    if (s.type === 'circle') return [{ x: this.x, y: this.y }];
    const c = Math.cos(this.a), n = Math.sin(this.a);
    return s.pts.map((p) => ({ x: this.x + p.x * c - p.y * n, y: this.y + p.x * n + p.y * c }));
  }

  aabb() {
    if (this.shape.type === 'circle') {
      const r = this.shape.r;
      return { x1: this.x - r, y1: this.y - r, x2: this.x + r, y2: this.y + r };
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of this.worldPts()) {
      x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x);
      y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y);
    }
    return { x1, y1, x2, y2 };
  }

  speed() { return Math.hypot(this.vx, this.vy); }

  push(jx, jy, px, py) {
    this.vx += jx / this.m; this.vy += jy / this.m;
    if (px !== undefined) this.w += ((px - this.x) * jy - (py - this.y) * jx) / this.I;
    this.sleep = 0;
  }

  impulseAt(px, py, nx, ny, prevPy) {
    const rx = px - this.x, ry = py - this.y;
    const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return 0;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + this.e) * vn) / (1 / this.m + (rn * rn) / this.I);
    this.vx += (j * nx) / this.m; this.vy += (j * ny) / this.m;
    this.w += (rn * j) / this.I;
    const tx = -ny, ty = nx;
    const vt = (this.vx - this.w * ry) * tx + (this.vy + this.w * rx) * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 / this.m + (rt * rt) / this.I);
    jt = clamp(jt, -this.mu * j, this.mu * j);
    this.vx += (jt * tx) / this.m; this.vy += (jt * ty) / this.m;
    this.w += (rt * jt) / this.I;
    return j;
  }

  step(dt, world) {
    if (this.static) return 0;
    if (this.held) {
      const nx = this.held.x - this.held.ox, ny = this.held.y - this.held.oy;
      this.vx = (nx - this.x) / Math.max(dt, 1e-3); this.vy = (ny - this.y) / Math.max(dt, 1e-3);
      this.x = nx; this.y = ny; this.w *= 0.9;
      this.sleep = 0;
      return 0;
    }
    if (this.sleep > 0.6) return 0;
    const { platforms, w } = world;
    const prev = this.worldPts();
    const prevY = this.y;
    this.vy += GRAVITY * dt * (this.gravityScale ?? 1);
    this.vx *= 0.999;
    this.x += this.vx * dt; this.y += this.vy * dt; this.a += this.w * dt;
    this.w *= 0.995;
    let hit = 0;
    this.ground = null;
    if (this.shape.type === 'circle') {
      const r = this.shape.r;
      const pl = landing(platforms, this.x, prevY + r, this.y + r, this.ignore);
      if (pl) {
        this.y = pl.y - r;
        if (this.vy > 0) { hit = this.vy; this.vy = -this.vy * this.e; if (Math.abs(this.vy) < 40) this.vy = 0; }
        this.vx *= 1 - 0.6 * dt;
        this.w = this.vx / r;
        this.ground = pl;
      }
      if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx) * this.e; }
      if (this.x > w - r) { this.x = w - r; this.vx = -Math.abs(this.vx) * this.e; }
    } else {
      const pts = this.worldPts();
      let deepest = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const pl = landing(platforms, p.x, prev[i].y - 1, p.y, this.ignore);
        if (pl && (!deepest || p.y - pl.y > deepest.pen)) deepest = { p, pl, pen: p.y - pl.y };
        if (p.x < 0) { this.x -= p.x; hit = Math.max(hit, this.impulseAt(p.x, p.y, 1, 0)); }
        if (p.x > w) { this.x -= p.x - w; hit = Math.max(hit, this.impulseAt(p.x, p.y, -1, 0)); }
      }
      if (deepest) {
        this.y -= deepest.pen;
        hit = Math.max(hit, this.impulseAt(deepest.p.x, deepest.p.y - deepest.pen, 0, -1) / this.m);
        this.ground = deepest.pl;
      }
    }
    if (this.ground && this.speed() < 25 && Math.abs(this.w) < 0.4) this.sleep += dt;
    else this.sleep = 0;
    if (this.sleep > 0.6) { this.vx = this.vy = this.w = 0; }
    return hit;
  }

  // Distance from a point to the shape outline.
  distTo(px, py) {
    if (this.shape.type === 'circle') return Math.hypot(px - this.x, py - this.y) - this.shape.r;
    const pts = this.worldPts();
    let best = Infinity;
    const n = this.shape.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-9;
      const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1);
      best = Math.min(best, Math.hypot(px - a.x - dx * t, py - a.y - dy * t));
    }
    if (this.shape.closed && pointInPoly(px, py, pts)) return -1;
    return best;
  }

  velAt(px, py) {
    return [this.vx - this.w * (py - this.y), this.vy + this.w * (px - this.x)];
  }
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polyArea(pts) {
  let A = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(A / 2);
}

export function rectShape(w, h) {
  return { type: 'poly', closed: true, area: w * h, pts: [
    { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 },
  ] };
}
