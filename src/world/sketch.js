// Sketch recognition: what you draw in a fight turns into a weapon if it's *roughly*
// the right shape. Features (straightness, corners, turning, roundness) are matched
// loosely on purpose. A wobbly star still throws a shuriken.
import { simplify, polyLength, clamp, rand, TAU, dist, sign, pick } from '../util.js';
import { Projectile } from './objects.js';

export const ITEMS = {
  sword:     { emoji: '🗡️', name: 'Sword',     how: 'short straight line', tip: 'Grab it with ✋ and swing. He can steal it!', path: 'M10 34 L38 6' },
  spear:     { emoji: '🔱', name: 'Spear',     how: 'long straight line',  tip: 'Flies straight at him', path: 'M4 38 L60 6' },
  boomerang: { emoji: '🪃', name: 'Boomerang', how: 'a V or <',            tip: 'Hits him and comes back', path: 'M8 8 L30 38 L52 8' },
  lightning: { emoji: '⚡', name: 'Lightning', how: 'a zigzag',            tip: 'Instant strike from the sky', path: 'M6 8 L22 34 L34 10 L48 36 L58 12' },
  tornado:   { emoji: '🌪️', name: 'Tornado',   how: 'a spiral',            tip: 'Sucks him in and spins him', path: 'M32 22 a3 3 0 1 1 3 4 a8 8 0 1 1 -9 -10 a14 14 0 1 1 17 15' },
  bow:       { emoji: '🏹', name: 'Bow',       how: 'an arc, like (',      tip: 'Floats and shoots arrows', path: 'M40 4 Q8 22 40 40' },
  wave:      { emoji: '🌊', name: 'Wave',      how: 'a wavy line ~~~',     tip: 'Rolls along and sweeps him away', path: 'M4 24 Q12 8 20 24 T36 24 T52 24 T62 20' },
  shield:    { emoji: '🛡️', name: 'Shield',    how: 'a circle',            tip: 'Follows your cursor and blocks his shots', path: 'M32 4 a18 18 0 1 0 0.1 0' },
  rocket:    { emoji: '🚀', name: 'Rocket',    how: 'a triangle',          tip: 'Homes in on him and explodes', path: 'M32 4 L58 40 L6 40 Z' },
  shuriken:  { emoji: '✴️', name: 'Shuriken',  how: 'a star',              tip: 'Spinning throwing star', path: 'M32 2 L39 17 L56 18 L43 29 L48 44 L32 35 L16 44 L21 29 L8 18 L25 17 Z' },
  cage:      { emoji: '⛓️', name: 'Cage',      how: 'a box around him',    tip: 'Traps him for a few seconds', path: 'M8 6 H56 V40 H8 Z M24 26 a4 4 0 1 1 0.1 0' },
  crate:     { emoji: '📦', name: 'Crate',     how: 'a box anywhere else', tip: 'Heavy block. Drop it on him', path: 'M14 8 H50 V40 H14 Z' },
};

// n points evenly spaced along the stroke
function resample(pts, n) {
  const L = polyLength(pts);
  const step = L / (n - 1) || 1;
  const out = [{ ...pts[0] }];
  let acc = 0, prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q;
      d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Drop vertices where the path barely turns, so a corner count reflects real corners.
function corners(verts, closed, minTurn = 0.55) {
  let v = verts.slice();
  if (closed && v.length > 2 && dist(v[0].x, v[0].y, v[v.length - 1].x, v[v.length - 1].y) < 1) v.pop();
  let changed = true;
  while (changed && v.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < (closed ? v.length : v.length - 1); i++) {
      const p = v[(i - 1 + v.length) % v.length], c = v[i], n = v[(i + 1) % v.length];
      const turn = Math.abs(wrap(ang(c, n) - ang(p, c)));
      if (turn < minTurn) { v.splice(i, 1); changed = true; break; }
    }
  }
  return v;
}

export function classify(raw, stick) {
  if (raw.length < 4) return null;
  const L = polyLength(raw);
  if (L < 30) return null;
  const P = resample(raw, 48);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of P) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
  const w = x2 - x1, h = y2 - y1, diag = Math.hypot(w, h) || 1;
  const a = P[0], b = P[P.length - 1];
  const E = dist(a.x, a.y, b.x, b.y);
  const closed = L > 80 && E < Math.max(22, L * 0.17) && E < diag * 0.3;
  // turning, measured on a smoothed copy so hand jitter doesn't count as curling
  const S = P.map((p, i) => {
    let x = 0, y = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(P.length - 1, i + 2); k++) { x += P[k].x; y += P[k].y; n++; }
    return { x: x / n, y: y / n };
  });
  let total = 0, absT = 0, flips = 0, lastSign = 0;
  const turns = [];
  for (let i = 2; i < S.length; i++) {
    const t = wrap(ang(S[i - 1], S[i]) - ang(S[i - 2], S[i - 1]));
    turns.push(t);
    total += t; absT += Math.abs(t);
  }
  for (const t of turns) {
    if (Math.abs(t) < 0.05) continue;
    const sg = Math.sign(t);
    if (lastSign && sg !== lastSign) flips++;
    lastSign = sg;
  }
  // corner sharpness on the raw path: a zigzag has real corners, a wave doesn't
  let sharp3 = 0;
  for (let i = 2; i < P.length - 1; i++) {
    const t = Math.abs(wrap(ang(P[i], P[i + 1]) - ang(P[i - 2], P[i - 1])));
    sharp3 = Math.max(sharp3, t);
  }
  const verts = simplify(closed ? P.concat([P[0]]) : P, Math.max(5, diag * 0.07));
  const C = corners(verts, closed);
  const cx = P.reduce((s, p) => s + p.x, 0) / P.length, cy = P.reduce((s, p) => s + p.y, 0) / P.length;
  const info = { L, w, h, x1, y1, x2, y2, cx, cy, closed, corners: C.length, total, absT, flips, sharp3, straight: E / L };

  if (closed) {
    const rs = P.map((p) => dist(p.x, p.y, cx, cy));
    const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
    const cv = Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / rs.length) / (mean || 1);
    info.radius = mean;
    if (C.length >= 7 && cv > 0.18) return { kind: 'shuriken', info };
    if (cv < 0.17 && C.length !== 3 && C.length !== 4) return { kind: 'shield', info };
    if (C.length === 3) return { kind: 'rocket', info };
    if (C.length === 4 || (C.length === 5 && cv < 0.3)) {
      const c = stick?.center;
      const inside = c && c.x > x1 && c.x < x2 && c.y > y1 && c.y < y2;
      return { kind: inside ? 'cage' : 'crate', info };
    }
    if (cv < 0.22) return { kind: 'shield', info };
    return null;
  }
  if (Math.abs(total) > 1.9 * Math.PI && absT < Math.abs(total) * 1.6) return { kind: 'tornado', info };
  if (info.straight > 0.9) return { kind: L > 230 ? 'spear' : 'sword', info };
  if (C.length === 3) {
    const t = Math.abs(wrap(ang(C[1], C[2]) - ang(C[0], C[1])));
    if (t > 1.1) return { kind: 'boomerang', info };
  }
  if (C.length >= 4 && info.straight > 0.3 && sharp3 > 1.7) return { kind: 'lightning', info };
  if (Math.abs(total) > 0.55 * Math.PI && Math.abs(total) < 1.8 * Math.PI && absT < Math.abs(total) * 1.6 && info.straight < 0.92) return { kind: 'bow', info };
  if (flips >= 2 && info.straight > 0.5) return { kind: 'wave', info };
  return null;
}

// ------------------------------------------------------------------ behaviours
// Attach a behaviour to a freshly drawn object. `owner` is 'user' or 'stick'.
// For the stickman's copies, the target is your cursor instead of him.
export function makeItem(game, obj, kind, info, owner = 'user') {
  const g = game;
  const b = obj.body;
  obj.item = kind;
  const enemy = owner === 'user'
    ? () => (g.stick.st.devoured > 0 ? null : g.stick.center)
    : () => ({ x: g.pointer.x, y: g.pointer.y });
  const aimVel = (speed) => {
    const t = enemy() || { x: b.x + 100, y: b.y };
    const a = Math.atan2(t.y - b.y, t.x - b.x);
    return [Math.cos(a) * speed, Math.sin(a) * speed, a];
  };
  const alignTo = (a) => {
    const s = b.shape.pts;
    const axis = Math.atan2(s[s.length - 1].y - s[0].y, s[s.length - 1].x - s[0].x);
    b.a = a - axis; b.w = 0;
  };
  const markThrown = (t) => { if (owner === 'stick') obj.thrownAt = { by: 'stick', t }; };
  let T = 0;

  switch (kind) {
    case 'spear': {
      const [vx, vy, a] = aimVel(1150);
      b.vx = vx; b.vy = vy; alignTo(a);
      b.gravityScale = 0.1;
      obj.dmgMul = 1.35;
      markThrown(2);
      obj.ai = (dt) => { T += dt; if (T > 1.1) b.gravityScale = 1; };
      break;
    }
    case 'shuriken': {
      const [vx, vy] = aimVel(900);
      b.vx = vx; b.vy = vy; b.w = 30; b.e = 0.8;
      b.gravityScale = 0.25;
      obj.dmgMul = 1.2;
      obj.life = 6;
      markThrown(2.5);
      break;
    }
    case 'boomerang': {
      const home = { x: b.x, y: b.y };
      let back = false;
      b.gravityScale = 0; b.w = 24;
      const [vx, vy] = aimVel(820);
      b.vx = vx; b.vy = vy;
      obj.life = 4;
      markThrown(4);
      obj.ai = (dt) => {
        T += dt;
        b.w = 24;
        if (!back && (T > 0.75 || obj.hitCd > 0)) { back = true; obj.hitCd = 0; }
        if (back) {
          const a = Math.atan2(home.y - b.y, home.x - b.x);
          b.vx += Math.cos(a) * 3200 * dt; b.vy += Math.sin(a) * 3200 * dt;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 900) { b.vx *= 900 / sp; b.vy *= 900 / sp; }
          if (dist(b.x, b.y, home.x, home.y) < 40 && T > 1) { obj.life = Math.min(obj.life, 0.3); }
        }
      };
      break;
    }
    case 'rocket': {
      b.gravityScale = 0;
      obj.noContact = true;   // it explodes instead
      obj.life = 3.2;
      obj.ai = (dt) => {
        T += dt;
        const t = enemy();
        if (t) {
          const a = Math.atan2(t.y - b.y, t.x - b.x);
          b.vx += Math.cos(a) * 1900 * dt; b.vy += Math.sin(a) * 1900 * dt;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 880) { b.vx *= 880 / sp; b.vy *= 880 / sp; }
          b.a = Math.atan2(b.vy, b.vx) + Math.PI / 2; b.w = 0;
          g.fx.burst(b.x - b.vx * 0.03, b.y - b.vy * 0.03, { count: 1, color: 'rgba(200,200,200,0.7)', type: 'dust', speed: 30, life: 0.5, size: 5, gravity: -30 });
          if (Math.random() < 0.6) g.fx.embers(b.x - b.vx * 0.03, b.y - b.vy * 0.03, 1);
          const hit = owner === 'user' ? g.stick.distTo(b.x, b.y) < 22 : dist(b.x, b.y, t.x, t.y) < 28;
          if (hit) { obj.dead = true; g.explode(b.x, b.y, 0.8, owner); }
        }
        if (obj.life < 0.05 && !obj.dead) { obj.dead = true; g.explode(b.x, b.y, 0.6, owner); }
      };
      break;
    }
    case 'lightning': {
      b.static = true;
      obj.life = 0.6;
      const t = enemy();
      const end = obj.body.worldPts().pop();
      if (t) {
        g.fx.bolt(end.x, end.y, t.x, t.y);
        g.fx.bolt(t.x + rand(-40, 40), 0, t.x, t.y);
        g.sfx('zap');
        if (owner === 'user') { g.stick.hurt(14, rand(-300, 300), -450, { force: true, by: 'lightning' }); g.stick.st.stun = 0.6; g.stick.glitch = 1; }
        else g.hitCursor(10, t.x, t.y, true, 'copycat');
      }
      break;
    }
    case 'tornado': {
      b.static = true;
      obj.life = 5;
      obj.ai = (dt) => {
        T += dt;
        b.a += dt * 9;
        if (Math.random() < 0.5) g.fx.dust(b.x + rand(-30, 30), b.y + rand(-30, 30), 1);
        const s = g.stick;
        if (owner !== 'user' || s.st.devoured > 0) return;
        const c = s.center;
        const d = dist(c.x, c.y, b.x, b.y);
        if (d < 300 && !s.ragdolled && s.onGround) s.x += sign(b.x - s.x) * 90 * dt;
        if (d < 90 && (obj.spinCd = (obj.spinCd || 0) - dt) <= 0) {
          obj.spinCd = 0.8;
          s.hurt(5, sign(c.x - b.x) * -400, -800, { force: true, by: 'tornado' });
          s.rag?.kick(0, 0);
          if (Math.random() < 0.4) g.brain.say(pick(['WHOAAA!', 'I\'m getting dizzy!', 'Put me dooown!']), true);
        }
        for (const o of g.objects) {
          if (o === obj || !o.body || o.body.static || o.heldBy) continue;
          const od = dist(o.body.x, o.body.y, b.x, b.y);
          if (od < 220) { o.body.vx += (b.x - o.body.x) * 3 * dt; o.body.vy += (b.y - o.body.y) * 3 * dt - 600 * dt; o.body.w += 3 * dt; o.body.sleep = 0; }
        }
      };
      break;
    }
    case 'wave': {
      b.gravityScale = 0;
      obj.noContact = true;   // it has its own sweep hit
      const t = enemy();
      const dir = t ? sign(t.x - b.x) : 1;
      b.vx = dir * 540; b.vy = 0;
      obj.life = 3.5;
      let hitOnce = false;
      obj.ai = (dt) => {
        b.vy = 0; b.vx = dir * 540; b.w = 0;
        if (Math.random() < 0.6) g.fx.burst(b.x, b.y, { count: 1, color: ['#8ecae6', '#219ebc', '#e0fbfc'], type: 'drop', speed: 120, life: 0.6, size: 3, gravity: 700, angle: -Math.PI / 2, spread: 0.8 });
        if (owner !== 'user' || hitOnce) return;
        let near = Infinity;
        for (const p of b.worldPts()) near = Math.min(near, g.stick.distTo(p.x, p.y));
        if (near < 22) { hitOnce = true; g.stick.hurt(10, dir * 950, -550, { force: true, by: 'wave' }); }
      };
      break;
    }
    case 'bow': {
      b.static = true;
      obj.life = 3.4;
      obj.ai = (dt) => {
        T += dt;
        const t = enemy();
        if (!t) return;
        if ((obj.shot = (obj.shot ?? 0.3) - dt) <= 0) {
          obj.shot = 0.5;
          const a = Math.atan2(t.y - b.y, t.x - b.x);
          g.projectiles.push(new Projectile(b.x, b.y, Math.cos(a) * 950, Math.sin(a) * 950 - 80, {
            owner: owner === 'user' ? 'ally' : 'stick', type: 'arrow', dmg: 4, r: 8, gravity: 160, color: '#5a3b1c',
            aim: owner === 'user' ? null : { x: t.x, y: t.y },
          }));
          g.sfx('whoosh');
        }
      };
      break;
    }
    case 'shield': {
      b.gravityScale = 0;
      obj.life = 8;
      obj.radius = clamp(info.radius || 40, 28, 90);
      obj.ai = (dt) => {
        const p = owner === 'user' ? g.pointer : g.stick.center;
        b.vx = (p.x - b.x) * 10; b.vy = (p.y - b.y) * 10; b.w = 0.6;
        const R = obj.radius + 8;
        for (const pr of g.projectiles) {
          if (pr.dead || pr.owner === (owner === 'user' ? 'ally' : 'stick')) continue;
          if (dist(pr.x, pr.y, b.x, b.y) < R) { pr.dead = true; g.fx.sparks(pr.x, pr.y, '#bde0fe', 8); g.fx.ring(b.x, b.y, R, 'rgba(180,220,255,0.8)', 0.25); }
        }
        if (owner === 'user') {
          for (const o of g.objects) {
            if (o.thrownAt?.by === 'stick' && o.body && dist(o.body.x, o.body.y, b.x, b.y) < R + 10) {
              o.thrownAt = null; o.owner = 'user'; o.body.vx *= -0.6; o.body.vy = -300;
              g.fx.ring(b.x, b.y, R, 'rgba(180,220,255,0.8)', 0.25);
            }
          }
        }
      };
      obj.extraDraw = (gx) => {
        gx.save();
        gx.globalAlpha = Math.min(1, obj.life) * 0.35;
        gx.fillStyle = '#bde0fe';
        gx.beginPath(); gx.arc(b.x, b.y, obj.radius, 0, TAU); gx.fill();
        gx.restore();
      };
      break;
    }
    case 'cage': {
      b.static = true;
      obj.life = 3.4;
      g.stick.st.caged = 3.2;
      g.stick.stop();
      g.brain.say(pick(['Hey! Let me out!', 'A cage? Seriously?', 'Not fair!']), true);
      break;
    }
    case 'crate': {
      b.density = 3; b.computeMass();
      break;
    }
    default: break;
  }
  return obj;
}
