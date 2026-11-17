// Stick-figure skeleton: pose angles -> joint positions (forward kinematics), drawing,
// and the library of hand-tuned poses that the animator blends between.
//
// Angle convention: a limb angle `a` points along (sin a * dir, cos a), so 0 is straight
// down and positive swings toward the facing direction. `lean` tilts the torso forward.
// `rot` spins the whole body around the hip (flips, lying down).
import { angLerp, lerp, TAU } from '../util.js';

export const BASE = { thigh: 17, shin: 17, torso: 24, neck: 3, head: 8.5, upper: 13, fore: 13, width: 4.6 };

export function dims(scale) {
  const d = {};
  for (const k in BASE) d[k] = BASE[k] * scale;
  return d;
}

const KEYS = ['lean', 'head', 'ua1', 'la1', 'ua2', 'la2', 'th1', 'sh1', 'th2', 'sh2', 'rot'];
export const ANGLE_KEYS = KEYS;

export function pose(p = {}) {
  const o = {};
  for (const k of KEYS) o[k] = p[k] ?? 0;
  return o;
}

export function blendPose(out, target, t) {
  for (const k of KEYS) out[k] = angLerp(out[k], target[k], t);
  return out;
}

export function mixPose(a, b, t) {
  const o = {};
  for (const k of KEYS) o[k] = lerp(a[k], b[k], t);
  return o;
}

const v = (a, len, dir) => [Math.sin(a) * len * dir, Math.cos(a) * len];

// Joint positions for pose p with the hip at (hx, hy).
export function fk(p, hx, hy, dir, d) {
  const r = p.rot;
  const J = { hip: [hx, hy] };
  const add = (from, a, len) => {
    const [dx, dy] = v(a + r, len, dir);
    return [from[0] + dx, from[1] + dy];
  };
  const tA = Math.PI - p.lean;
  J.neck = add(J.hip, tA, d.torso);
  J.head = add(J.neck, tA - p.head, d.neck + d.head);
  J.sh = add(J.hip, tA, d.torso * 0.92);
  J.e1 = add(J.sh, p.ua1, d.upper);
  J.h1 = add(J.e1, p.la1, d.fore);
  J.e2 = add(J.sh, p.ua2, d.upper);
  J.h2 = add(J.e2, p.la2, d.fore);
  J.k1 = add(J.hip, p.th1, d.thigh);
  J.f1 = add(J.k1, p.sh1, d.shin);
  J.k2 = add(J.hip, p.th2, d.thigh);
  J.f2 = add(J.k2, p.sh2, d.shin);
  return J;
}

// How far below the hip the lowest point of the figure is (so it can stand on a surface).
export function lowestOffset(J, d) {
  const hy = J.hip[1];
  let m = J.head[1] + d.head - hy;
  for (const k of ['f1', 'f2', 'k1', 'k2', 'h1', 'h2', 'e1', 'e2', 'neck']) m = Math.max(m, J[k][1] - hy + d.width * 0.5);
  return m;
}

export const BONES = [
  ['hip', 'neck'],
  ['sh', 'e1'], ['e1', 'h1'], ['sh', 'e2'], ['e2', 'h2'],
  ['hip', 'k1'], ['k1', 'f1'], ['hip', 'k2'], ['k2', 'f2'],
];

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Draw the figure. opts: color, face ('normal'|'angry'|'sleep'|'happy'|'hurt'|'dizzy'|null),
// alpha, glitch (0..1 erased look), aura (glow color), lookAt [x, y].
export function draw(g, J, d, dir, opts = {}) {
  const color = opts.color || '#ff8a1f';
  const back = shade(color, 0.72);
  g.save();
  g.globalAlpha = opts.alpha ?? 1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (opts.aura) {
    g.shadowColor = opts.aura;
    g.shadowBlur = 18;
  }
  const seg = (a, b, c, w) => {
    if (opts.glitch && Math.random() < opts.glitch * 0.5) return;
    let [ax, ay] = J[a], [bx, by] = J[b];
    if (opts.glitch) {
      const j = opts.glitch * 4;
      ax += (Math.random() - 0.5) * j; bx += (Math.random() - 0.5) * j;
    }
    // neon: a tube of three strokes (halo, glow, hot core) instead of a blur filter
    const passes = opts.neon ? [[w + 7, c, 0.18], [w + 3, c, 0.45], [w * 0.6, '#ffe2c4', 1]] : [[w, c, 1]];
    const alpha = g.globalAlpha;
    for (const [pw, pc, pa] of passes) {
      g.globalAlpha = alpha * pa;
      g.strokeStyle = pc;
      g.lineWidth = pw;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }
    g.globalAlpha = alpha;
  };
  // back limbs first, darker, for depth
  seg('sh', 'e1', back, d.width); seg('e1', 'h1', back, d.width);
  seg('hip', 'k1', back, d.width); seg('k1', 'f1', back, d.width);
  seg('hip', 'neck', color, d.width * 1.1);
  seg('hip', 'k2', color, d.width); seg('k2', 'f2', color, d.width);
  seg('sh', 'e2', color, d.width); seg('e2', 'h2', color, d.width);
  // head
  const [hx, hy] = J.head;
  if (!(opts.glitch && Math.random() < opts.glitch * 0.4)) {
    g.beginPath();
    g.arc(hx, hy, d.head, 0, TAU);
    if (opts.neon) {   // the head becomes a glowing ring around a dark glass face
      const alpha = g.globalAlpha;
      g.fillStyle = 'rgba(20,8,4,0.75)';
      g.fill();
      for (const [pw, pc, pa] of [[d.width + 6, color, 0.2], [d.width + 2, color, 0.5], [d.width * 0.6, '#ffe2c4', 1]]) {
        g.globalAlpha = alpha * pa; g.strokeStyle = pc; g.lineWidth = pw; g.stroke();
      }
      g.globalAlpha = alpha;
    } else {
      g.fillStyle = color;
      g.fill();
    }
  }
  g.shadowBlur = 0;
  if (opts.face) drawFace(g, J, d, dir, opts.face, opts.lookAt, opts.neon ? '#ffe2c4' : null);
  g.restore();
}

function drawFace(g, J, d, dir, face, lookAt, ink = null) {
  const [hx, hy] = J.head;
  const s = d.head / 8.5;
  let lx = dir * 2.2 * s, ly = -0.5 * s;
  if (lookAt) {
    const a = Math.atan2(lookAt[1] - hy, lookAt[0] - hx);
    lx = Math.cos(a) * 2.6 * s;
    ly = Math.sin(a) * 2 * s;
  }
  g.fillStyle = ink || 'rgba(20,10,0,0.85)';
  g.strokeStyle = ink || 'rgba(20,10,0,0.85)';
  g.lineWidth = 1.4 * s;
  const ex1 = hx + lx - 2.6 * s, ex2 = hx + lx + 2.6 * s, ey = hy + ly;
  if (face === 'sleep') {
    g.beginPath();
    g.moveTo(ex1 - 1.5 * s, ey); g.lineTo(ex1 + 1.5 * s, ey);
    g.moveTo(ex2 - 1.5 * s, ey); g.lineTo(ex2 + 1.5 * s, ey);
    g.stroke();
    return;
  }
  if (face === 'dizzy') {
    for (const ex of [ex1, ex2]) {
      g.beginPath();
      g.moveTo(ex - 1.4 * s, ey - 1.4 * s); g.lineTo(ex + 1.4 * s, ey + 1.4 * s);
      g.moveTo(ex + 1.4 * s, ey - 1.4 * s); g.lineTo(ex - 1.4 * s, ey + 1.4 * s);
      g.stroke();
    }
    return;
  }
  if (face === 'happy') {
    for (const ex of [ex1, ex2]) {
      g.beginPath();
      g.arc(ex, ey + 0.8 * s, 1.5 * s, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    return;
  }
  for (const ex of [ex1, ex2]) {
    g.beginPath();
    g.arc(ex, ey, (face === 'hurt' ? 0.9 : 1.25) * s, 0, TAU);
    g.fill();
  }
  if (face === 'angry') {
    g.beginPath();
    g.moveTo(ex1 - 1.8 * s, ey - 2.8 * s); g.lineTo(ex1 + 1.4 * s, ey - 1.6 * s);
    g.moveTo(ex2 + 1.8 * s, ey - 2.8 * s); g.lineTo(ex2 - 1.4 * s, ey - 1.6 * s);
    g.stroke();
  }
}

// ---------------------------------------------------------------- pose library
const S = Math.sin, C = Math.cos;

export const POSES = {
  stand: (t) => pose({
    lean: 0.04 + 0.02 * S(t * 2), head: 0.02 * S(t * 1.3),
    ua1: -0.16, la1: -0.06, ua2: 0.14 + 0.03 * S(t * 2), la2: 0.24,
    th1: -0.1, sh1: -0.1, th2: 0.1, sh2: 0.1,
  }),
  walk: (t, p) => {
    const s = S(p * TAU), c = C(p * TAU);
    return pose({
      lean: 0.1, head: -0.05,
      th2: 0.5 * s, sh2: 0.5 * s - 0.7 * Math.max(0, c),
      th1: -0.5 * s, sh1: -0.5 * s - 0.7 * Math.max(0, -c),
      ua2: -0.45 * s, la2: -0.45 * s + 0.35, ua1: 0.45 * s, la1: 0.45 * s + 0.35,
    });
  },
  run: (t, p) => {
    const s = S(p * TAU), c = C(p * TAU);
    return pose({
      lean: 0.35, head: -0.25,
      th2: 0.85 * s + 0.2, sh2: 0.85 * s - 1.2 * Math.max(0, c) - 0.2,
      th1: -0.85 * s + 0.2, sh1: -0.85 * s - 1.2 * Math.max(0, -c) - 0.2,
      ua2: -0.9 * s, la2: -0.9 * s + 1.5, ua1: 0.9 * s, la1: 0.9 * s + 1.5,
    });
  },
  jump: (t) => pose({
    lean: 0.1, ua1: 2.4, la1: 2.6, ua2: 2.7, la2: 2.9,
    th1: 0.4, sh1: -0.4, th2: 1.1, sh2: 0.1,
  }),
  tuck: () => pose({
    lean: 0.5, head: 0.3, ua1: 1.2, la1: 2.4, ua2: 1.3, la2: 2.5,
    th1: 2.0, sh1: 0.1, th2: 2.2, sh2: 0.2,
  }),
  fall: (t) => pose({
    lean: -0.1, head: -0.2,
    ua1: 2.2 + 0.5 * S(t * 18), la1: 2.6 + 0.6 * S(t * 18 + 1), ua2: 2.4 + 0.5 * S(t * 18 + 2), la2: 2.8,
    th1: -0.4, sh1: -0.7, th2: 0.6, sh2: 0.2 + 0.4 * S(t * 15),
  }),
  land: () => pose({
    lean: 0.45, head: -0.3, ua1: 0.7, la1: 0.9, ua2: 0.9, la2: 1.1,
    th1: 1.0, sh1: -0.7, th2: 1.3, sh2: -0.4,
  }),
  sit: (t) => pose({
    lean: -0.08 + 0.03 * S(t), head: 0.1 * S(t * 0.7),
    ua1: -0.5, la1: -0.3, ua2: 0.4, la2: 1.1,
    th1: 1.45, sh1: 0.15 + 0.35 * S(t * 2.2), th2: 1.55, sh2: 0.1 + 0.35 * S(t * 2.2 + 1.7),
  }),
  sleep: (t) => pose({
    rot: -1.5, lean: 0, head: 0.15 + 0.04 * S(t * 1.6),
    ua1: 0.2, la1: 0.6, ua2: 2.9, la2: 2.6,
    th1: 0.15, sh1: 0.0, th2: 0.55, sh2: -0.15,
  }),
  guard: (t) => pose({
    lean: 0.18 + 0.03 * S(t * 7), head: -0.1,
    ua1: 0.5, la1: 2.5, ua2: 0.9, la2: 2.7,
    th1: -0.55, sh1: -0.75, th2: 0.55, sh2: 0.15,
  }),
  punch: (t, k) => {
    const e = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
    return pose({
      lean: 0.15 + 0.25 * e, head: -0.15,
      ua1: 0.5, la1: 2.5, ua2: lerp(0.9, 1.6, e), la2: lerp(2.7, 1.6, e),
      th1: -0.6, sh1: -0.8, th2: 0.6, sh2: 0.2,
    });
  },
  uppercut: (t, k) => {
    const e = Math.min(1, k / 0.45);
    return pose({
      lean: lerp(0.4, -0.15, e), head: -0.2,
      ua1: 0.5, la1: 2.5, ua2: lerp(0.2, 2.7, e), la2: lerp(1.8, 2.9, e),
      th1: -0.5, sh1: -0.9, th2: lerp(0.9, 0.3, e), sh2: lerp(-0.2, 0.1, e),
    });
  },
  kick: (t, k) => {
    const e = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
    return pose({
      lean: lerp(0.1, -0.45, e), head: 0.2,
      ua1: -0.9, la1: -0.5, ua2: 0.9, la2: 1.9,
      th1: -0.15, sh1: -0.15, th2: lerp(0.6, 1.7, e), sh2: lerp(-0.4, 1.7, e),
    });
  },
  flyingKick: () => pose({
    lean: -0.5, head: 0.3, ua1: -1.6, la1: -1.2, ua2: 1.6, la2: 2.2,
    th1: 1.2, sh1: -0.6, th2: 1.65, sh2: 1.65,
  }),
  slash: (t, k) => {
    const e = Math.min(1, k / 0.35);
    return pose({
      lean: lerp(-0.1, 0.35, e), head: -0.1,
      ua1: 0.4, la1: 1.6, ua2: lerp(2.9, 0.6, e), la2: lerp(2.9, 0.9, e),
      th1: -0.6, sh1: -0.8, th2: 0.6, sh2: 0.2,
    });
  },
  throwWind: () => pose({
    lean: -0.2, ua1: 1.0, la1: 1.4, ua2: -2.0, la2: -2.6,
    th1: -0.5, sh1: -0.6, th2: 0.5, sh2: 0.3,
  }),
  throwRelease: () => pose({
    lean: 0.4, ua1: -0.6, la1: -0.3, ua2: 1.9, la2: 1.7,
    th1: -0.6, sh1: -0.8, th2: 0.6, sh2: 0.3,
  }),
  cast: (t) => pose({
    lean: 0.2, head: -0.1,
    ua1: 1.5 + 0.05 * S(t * 30), la1: 1.6, ua2: 1.6 + 0.05 * S(t * 30 + 1), la2: 1.6,
    th1: -0.6, sh1: -0.8, th2: 0.6, sh2: 0.2,
  }),
  charge: (t) => pose({
    lean: -0.05, head: 0.15,
    ua1: 0.9, la1: 2.0, ua2: 0.9, la2: 2.0,
    th1: -0.55, sh1: -0.9, th2: 0.55, sh2: 0.2,
  }),
  hurt: (t) => pose({
    lean: -0.5, head: 0.5, ua1: 1.9, la1: 2.4, ua2: 1.2, la2: 2.0,
    th1: -0.3, sh1: -0.2, th2: 0.4, sh2: 0.6,
  }),
  wave: (t) => pose({
    lean: 0.0, head: 0.1,
    ua1: -0.2, la1: -0.1, ua2: 2.6, la2: 2.9 + 0.45 * S(t * 11),
    th1: -0.1, sh1: -0.1, th2: 0.1, sh2: 0.1,
  }),
  cheer: (t) => pose({
    lean: -0.05, head: 0.3,
    ua1: 2.6 + 0.2 * S(t * 12), la1: 2.9, ua2: 2.7 + 0.2 * S(t * 12 + 1), la2: 3.0,
    th1: -0.2, sh1: -0.2, th2: 0.2, sh2: 0.2,
  }),
  laugh: (t) => pose({
    lean: -0.25 + 0.12 * S(t * 16), head: 0.5,
    ua1: 0.7, la1: 1.9, ua2: 0.7, la2: 1.9,
    th1: -0.15, sh1: -0.15, th2: 0.15, sh2: 0.15,
  }),
  taunt: (t) => pose({
    lean: 0.05, head: 0.2,
    ua1: -0.2, la1: -0.1, ua2: 1.55, la2: 2.6 + 0.4 * S(t * 14),
    th1: -0.3, sh1: -0.3, th2: 0.3, sh2: 0.3,
  }),
  dance: (t) => {
    const s = S(t * 7), c = C(t * 7);
    return pose({
      lean: 0.15 * s, head: 0.25 * c,
      ua1: 2.2 * Math.max(0, s) + 0.3, la1: 2.6 * Math.max(0, s) + 0.6,
      ua2: 2.2 * Math.max(0, -s) + 0.3, la2: 2.6 * Math.max(0, -s) + 0.6,
      th1: -0.3 + 0.3 * c, sh1: -0.3 - 0.4 * Math.max(0, c), th2: 0.3 + 0.3 * c, sh2: 0.3 - 0.4 * Math.max(0, -c),
    });
  },
  think: (t) => pose({
    lean: 0.0, head: 0.25 + 0.05 * S(t),
    ua1: 0.4, la1: 1.6, ua2: 0.6, la2: 2.9,
    th1: -0.1, sh1: -0.1, th2: 0.1, sh2: 0.1,
  }),
  draw: (t) => pose({
    lean: 0.1, head: -0.1,
    ua1: -0.3, la1: 0.1, ua2: 1.3 + 0.35 * S(t * 9), la2: 1.6 + 0.4 * S(t * 9 + 1.2),
    th1: -0.25, sh1: -0.3, th2: 0.25, sh2: 0.2,
  }),
  eat: (t) => pose({
    lean: 0.05, head: -0.05,
    ua1: -0.15, la1: -0.05, ua2: 0.5, la2: 2.7 + 0.25 * S(t * 14),
    th1: -0.1, sh1: -0.1, th2: 0.1, sh2: 0.1,
  }),
  dizzy: (t) => pose({
    lean: 0.25 * S(t * 3), head: 0.4 * S(t * 3 + 1),
    ua1: -0.6 + 0.3 * S(t * 3), la1: -0.4, ua2: 0.6 + 0.3 * S(t * 3), la2: 0.4,
    th1: -0.2, sh1: -0.2, th2: 0.2, sh2: 0.2,
  }),
  defeated: () => pose({
    rot: -1.55, lean: 0, head: 0.3,
    ua1: 2.2, la1: 2.4, ua2: 0.9, la2: 1.0,
    th1: 0.3, sh1: 0.1, th2: 0.9, sh2: 0.1,
  }),
  pushup: (t) => {
    const e = 0.5 + 0.5 * S(t * 4);
    return pose({
      rot: 1.35, lean: 0, head: -0.5,
      ua1: lerp(-0.9, -1.4, e), la1: lerp(-2.3, -1.4, e), ua2: lerp(-0.9, -1.4, e), la2: lerp(-2.3, -1.4, e),
      th1: 0, sh1: 0, th2: 0.05, sh2: 0.05,
    });
  },
  crouch: () => pose({
    lean: 0.5, head: -0.4, ua1: 1.2, la1: 1.0, ua2: 1.4, la2: 1.2,
    th1: 1.3, sh1: -0.9, th2: 1.6, sh2: -0.5,
  }),
  carry: (t, p) => {
    const s = S(p * TAU), c = C(p * TAU);
    return pose({
      lean: 0.05,
      th2: 0.4 * s, sh2: 0.4 * s - 0.6 * Math.max(0, c),
      th1: -0.4 * s, sh1: -0.4 * s - 0.6 * Math.max(0, -c),
      ua1: 2.7, la1: 3.0, ua2: 2.8, la2: 3.1,
    });
  },
  meditate: (t) => pose({
    lean: 0, head: -0.05 + 0.05 * S(t * 0.8),
    ua1: 0.35, la1: 1.75, ua2: 0.45, la2: 1.85,
    th1: 1.15, sh1: -2.05, th2: 1.3, sh2: -1.85,
  }),
  handstand: (t, p = 0) => pose({
    rot: Math.PI, lean: 0, head: 0.2,
    ua1: -0.15 + 0.15 * S(t * 6), la1: -0.15 + 0.15 * S(t * 6), ua2: 0.15 - 0.15 * S(t * 6), la2: 0.15 - 0.15 * S(t * 6),
    th1: -0.25 + 0.1 * S(t * 3), sh1: -0.6, th2: 0.25 + 0.1 * S(t * 3), sh2: 0.5,
  }),
  stretch: (t, k = 0) => {
    const e = Math.sin(Math.min(1, k) * Math.PI);
    return pose({
      lean: -0.35 * e, head: 0.4 * e,
      ua1: lerp(-0.2, 2.6, e), la1: lerp(-0.1, 2.9, e), ua2: lerp(0.2, 2.7, e), la2: lerp(0.2, 3.0, e),
      th1: -0.12, sh1: -0.12, th2: 0.12, sh2: 0.12,
    });
  },
  sneeze: (t, k = 0) => {
    const back = k < 0.6 ? k / 0.6 : 0, snap = k >= 0.6 ? 1 - (k - 0.6) / 0.4 : 0;
    return pose({
      lean: -0.45 * back + 0.7 * snap, head: 0.5 * back - 0.4 * snap,
      ua1: 0.3, la1: 2.4 * back + 0.6, ua2: 0.4, la2: 2.5 * back + 0.7,
      th1: -0.2, sh1: -0.2, th2: 0.2, sh2: 0.2 - 0.3 * snap,
    });
  },
  skate: (t) => pose({
    lean: 0.15 + 0.05 * S(t * 2), head: -0.1,
    ua1: -1.2 + 0.15 * S(t * 3), la1: -0.9, ua2: 1.1 + 0.15 * S(t * 3 + 1), la2: 1.3,
    th1: -0.55, sh1: -0.1, th2: 0.75, sh2: -0.15,
  }),
  juggle: (t) => pose({
    lean: 0.02, head: -0.35,
    ua1: 0.9 + 0.35 * S(t * 9), la1: 2.0 + 0.4 * S(t * 9), ua2: 0.9 + 0.35 * S(t * 9 + Math.PI), la2: 2.0 + 0.4 * S(t * 9 + Math.PI),
    th1: -0.15, sh1: -0.15, th2: 0.15, sh2: 0.15,
  }),
  fish: (t) => pose({
    lean: 0.05, head: 0.05 * S(t),
    ua1: 1.0, la1: 1.5, ua2: 1.15, la2: 1.65 + 0.04 * S(t * 3),
    th1: 1.45, sh1: 0.15 + 0.3 * S(t * 2), th2: 1.55, sh2: 0.1 + 0.3 * S(t * 2 + 1.7),
  }),
  slam: () => pose({
    lean: 0.6, head: -0.3, ua1: 2.9, la1: 2.9, ua2: 2.8, la2: 2.8,
    th1: 1.6, sh1: -0.5, th2: 1.8, sh2: -0.3,
  }),
  ride: (t) => pose({
    lean: 0.1 + 0.04 * S(t * 6), head: 0.1,
    ua1: 2.2, la1: 2.6, ua2: 0.9 + 0.2 * S(t * 4), la2: 2.4,
    th1: -0.55, sh1: -0.2, th2: 0.55, sh2: 0.2,
  }),
};
