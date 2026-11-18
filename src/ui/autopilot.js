// Autopilot: plays your side of a fight so you can just watch (and QA can test fights without a
// human). It steers a virtual cursor and uses the same Arena methods a real player triggers:
// it draws sketch weapons when it has the ink, drops bombs, calls lightning, erases, throws
// him around, clicks away fake errors, repairs and summons allies. It plays like a decent
// human: a short reaction time, some aiming error, and it keeps its cursor moving.
import { polyLength, clamp, rand, pick, chance, dist, weighted } from '../util.js';
import { tierOf } from '../actors/lore.js';

const SPEED = 1500;        // cursor px/s
const INK_PER_PX = 0.09;   // same rate as the pencil

// ------------------------------------------------------------------ strokes it can draw
function densify(P, step = 6, jit = 1.2) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n + rand(-jit, jit), y: a.y + ((b.y - a.y) * k) / n + rand(-jit, jit) });
  }
  out.push({ ...P[P.length - 1] });
  return out;
}
const poly = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const ring = (x, y, n, r) => poly(n, (t) => ({ x: x + Math.cos(-Math.PI / 2 + t * Math.PI * 2) * r(Math.round(t * n)), y: y + Math.sin(-Math.PI / 2 + t * Math.PI * 2) * r(Math.round(t * n)) }));

// Each one is drawn roughly enough that the sketch recognizer still knows it (see sketch.js).
export const STROKES = {
  spear: (x, y) => { const a = rand(-0.5, 0.5), L = rand(250, 290); return densify([{ x: x - (Math.cos(a) * L) / 2, y: y - (Math.sin(a) * L) / 2 }, { x: x + (Math.cos(a) * L) / 2, y: y + (Math.sin(a) * L) / 2 }]); },
  boomerang: (x, y) => { const s = rand(40, 52); return densify([{ x: x - s, y: y - s }, { x, y: y + s * 0.8 }, { x: x + s, y: y - s }]); },
  lightning: (x, y) => { const w = rand(26, 32), h = rand(40, 52); return densify([0, 1, 2, 3, 4, 5].map((i) => ({ x: x - 2.5 * w + i * w, y: y + (i % 2 ? h / 2 : -h / 2) }))); },
  tornado: (x, y) => densify(poly(60, (t) => { const a = t * Math.PI * 4.8, r = 8 + t * 40; return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }; }), 6, 0.8),
  bow: (x, y, d = 1) => { const r = rand(55, 66); return densify(poly(14, (t) => { const a = -1.5 + 3 * t; return { x: x - d * Math.cos(a) * r, y: y + Math.sin(a) * r }; }), 6, 0.8); },
  wave: (x, y) => { const L = rand(230, 270); return densify(poly(40, (t) => ({ x: x - L / 2 + t * L, y: y + Math.sin(t * Math.PI * 5) * 20 })), 6, 0.6); },
  shield: (x, y) => { const r = rand(38, 48); return densify(ring(x, y, 20, () => r), 6, 0.8); },
  rocket: (x, y) => { const r = rand(42, 52); return densify(ring(x, y, 3, () => r)); },
  shuriken: (x, y) => { const R = rand(44, 52); return densify(ring(x, y, 10, (i) => (i % 2 ? R * 0.42 : R))); },
  box: (x, y, w = 90, h = 90) => densify([{ x: x - w / 2, y: y - h / 2 }, { x: x + w / 2, y: y - h / 2 }, { x: x + w / 2, y: y + h / 2 }, { x: x - w / 2, y: y + h / 2 }, { x: x - w / 2, y: y - h / 2 }]),
};
const cost = (pts) => polyLength(pts) * INK_PER_PX;

export class Autopilot {
  constructor(arena) {
    this.a = arena;
    this.g = arena.g;
    const g = this.g;
    this.cur = { x: g.w * 0.7, y: g.h * 0.4 };
    this.goal = { ...this.cur };
    this.home = null;          // where the cursor idles
    this.homeT = 0;
    this.task = null;
    this.think = 1.2;
    this.dodgeT = 0;
    this.last = null;
    this.seen = new WeakSet();
    this.eraseCd = 0;
    this.handCd = 0;
    this.summonAt = 0;         // fight time of the next "extra" summon
    this.t = 0;
    g.pointer = this.cur;
  }

  // Abort cleanly: drop a half-drawn stroke (no object), let go of anything held, eraser off.
  stop() {
    this.task = null;
    this.a.cancelInput();
  }

  update(dt) {
    const g = this.g, a = this.a;
    if (g.mode !== 'fight') { if (this.task || a.drag || a.stroke || a.eraserOn) this.stop(); return; }
    this.dt = dt;
    this.t += dt;
    this.eraseCd -= dt; this.handCd -= dt; this.homeT -= dt;
    if (!a.stroke && !a.drag && !a.eraserOn) this.evade(dt);
    if (this.task) {
      let r;
      try { r = this.task.next(); } catch (e) { r = { done: true }; g.ctx.log?.('autopilot task failed', String(e?.stack || e)); }
      if (r.done) this.task = null;
    } else {
      if (this.homeT <= 0 || !this.home || dist(this.home.x, this.home.y, g.stick.center.x, g.stick.center.y) < 220) this.pickHome();
      this.goal = this.home;
      this.think -= dt;
      if (this.think <= 0) {
        this.think = rand(2.4, 3.8);   // humans take a moment to decide
        this.choose();
      }
    }
    this.steer(dt);
  }

  // ------------------------------------------------------------------ cursor
  steer(dt) {
    const c = this.cur, p = this.goal;
    if (!p) return;
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    const step = Math.min(d, Math.max(SPEED * dt, d * Math.min(1, dt * 12)) * (this.dodgeT > 0 ? 1.4 : 1), SPEED * 1.4 * dt);
    c.x += (dx / d) * step; c.y += (dy / d) * step;
    this.g.pointer = c;
  }

  place(p) { this.cur.x = p.x; this.cur.y = p.y; this.goal = { x: p.x, y: p.y }; this.g.pointer = this.cur; }

  bounds(p) {
    const g = this.g;
    return { x: clamp(p.x, 90, g.w - 30), y: clamp(p.y, 170, g.h - 30) };
  }

  // Idle spot: a few hundred px from him, away from the HUD.
  pickHome() {
    const g = this.g, c = g.stick.center;
    this.homeT = rand(2, 4.5);
    for (let i = 0; i < 12; i++) {
      const a = rand(-Math.PI, 0) + rand(-0.4, 0.4), r = rand(300, 480);
      const p = this.bounds({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      if (dist(p.x, p.y, c.x, c.y) > 240) { this.home = p; return; }
    }
    this.home = this.bounds({ x: c.x < g.w / 2 ? g.w - 200 : 200, y: g.h * 0.35 });
  }

  // Dodge his shots and keep away from his fists (with a human reaction delay).
  evade(dt) {
    const g = this.g, c = this.cur, s = g.stick;
    this.dodgeT -= dt;
    for (const p of g.projectiles) {
      if (p.owner !== 'stick' || p.dead || this.seen.has(p)) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d > 320 || (c.x - p.x) * p.vx + (c.y - p.y) * p.vy <= 0) continue;
      this.seen.add(p);
      if (!chance(0.7)) continue;   // sometimes it just doesn't notice
      const v = Math.hypot(p.vx, p.vy) || 1;
      const side = chance(0.5) ? 1 : -1;
      const to = this.bounds({ x: c.x - (p.vy / v) * 150 * side, y: c.y + (p.vx / v) * 150 * side });
      g.after(rand(160, 320), () => { if (!this.a.stroke) { this.goal = to; this.home = to; this.homeT = 1.2; this.dodgeT = 0.5; } });
    }
    // his final beam: get out from under it, sideways
    const bm = g.brain.beam;
    if (bm && bm.x1 !== undefined && this.dodgeT <= 0) {
      const side = (c.x - bm.x1) * Math.sin(bm.a) - (c.y - bm.y1) * Math.cos(bm.a) > 0 ? -1 : 1;
      const to = this.bounds({ x: c.x - Math.sin(bm.a) * 260 * side, y: c.y + Math.cos(bm.a) * 260 * side });
      this.dodgeT = 0.45;
      g.after(rand(200, 380), () => { if (this.a.auto !== this) return; this.stop(); this.goal = to; this.home = to; this.homeT = 1.5; });
    }
    const sc = s.center;
    if (!this.task && dist(sc.x, sc.y, c.x, c.y) < 160 && this.dodgeT <= 0) {
      this.dodgeT = 0.6;
      this.pickHome();
    }
  }

  // ------------------------------------------------------------------ decisions
  choose() {
    const g = this.g, a = this.a, s = g.stick;
    const c = s.center;
    const ink = g.ink;
    const stuck = s.st.caged > 0.6 || s.st.frozen > 0.6 || s.st.stun > 0.5 || s.st.dizzy > 0.5 || (s.mode === 'ragdoll' && s.rag?.rest > 0.1) || s.action?.name === 'charge';
    const allies = g.apps.filter((x) => x.alive && x.possessed <= 0).length;
    const possessed = g.apps.find((x) => x.possessed > 1 && x.alive);
    const popups = g.objects.filter((o) => o.kind === 'popup' && !o.dead);
    const shots = g.projectiles.filter((p) => p.owner === 'stick').length;
    const shielded = g.objects.some((o) => o.item === 'shield' && !o.dead && o.owner === 'user');
    const ground = s.onGround;
    const O = [];
    const add = (n, w, f) => { if (w > 0) O.push({ n, w: n === this.last ? w * 0.35 : w, f }); };
    add('popups', popups.length ? 40 + popups.length * 15 : 0, () => this.closePopups(popups));
    add('free', possessed && a.cd.zap <= 0 ? 45 : 0, () => this.zapAt(() => possessed.center, 20));
    add('disarm', s.weapon ? 22 : 0, () => (a.cd.zap <= 0 && chance(0.5) ? this.zapAt(() => s.center, 30) : this.eraseHim(0.5)));
    add('repair', a.cd.restore <= 0 && (g.deskHp < 55 || g.fx.cracks.length > 14) ? 30 : 0, () => this.press('[data-act="restore"]', () => a.restore()));
    add('summon', a.cd.summon <= 0 && (allies < 2 || (allies < 4 && g.fightT > this.summonAt)) ? (allies < 2 ? 30 : 10) : 0, () => this.summon());
    add('shield', !shielded && (shots >= 2 || possessed) && ink > 32 ? 16 : 0, () => this.draw('shield', this.cur.x, this.cur.y, 'ink'));
    add('spear', ink > 34 ? 16 : 0, () => this.drawNear('spear', pick(['ink', 'ink', 'fire'])));
    add('rocket', ink > 30 ? 11 : 0, () => this.drawNear('rocket', 'ink'));
    add('shuriken', ink > 36 ? 6 : 0, () => this.drawNear('shuriken', pick(['ink', 'fire'])));
    add('lightning', ink > 30 ? 9 : 0, () => this.drawNear('lightning', 'ink'));
    add('bow', ink > 24 ? 5 : 0, () => this.drawNear('bow', 'ink'));
    add('boomerang', ink > 24 ? 5 : 0, () => this.drawNear('boomerang', pick(['ink', 'bouncy'])));
    add('wave', ink > 40 && ground ? 4 : 0, () => this.drawWave());
    add('tornado', ink > 48 && ground ? 3 : 0, () => this.draw('tornado', clamp(c.x + rand(-140, 140), 120, g.w - 60), c.y - 20, 'ink'));
    add('cage', ink > 56 && (stuck || (ground && !s.goal)) ? (stuck ? 12 : 3) : 0, () => this.cage());
    add('crate', ink > 36 && stuck && ground ? 9 : 0, () => this.draw('box', c.x, Math.max(180, c.y - rand(170, 230)), pick(['ice', 'ink'])));
    add('bomb', a.cd.bomb <= 0 ? (stuck ? 16 : 7) : 0, () => this.bomb());
    add('zap', a.cd.zap <= 0 ? (stuck ? 16 : 8) : 0, () => this.zapAt(() => this.lead(s), 24));
    add('eraser', this.eraseCd <= 0 && stuck ? 9 : 0, () => this.eraseHim(rand(0.5, 0.9)));
    add('throw', this.handCd <= 0 && !s.ragdolled && ground ? 4 : 0, () => this.throwHim());
    add('reposition', 10, () => { this.pickHome(); });
    const o = weighted(O);
    if (!o) return;
    this.last = o.n;
    const r = o.f();
    if (r && typeof r.next === 'function') this.task = r;
  }

  // where he'll be in a moment
  lead(s, k = 0.25) {
    const c = s.center;
    const vx = s.mode === 'air' ? s.vx : s.goal ? Math.sign(s.goal.x - s.x) * 150 : 0;
    return { x: c.x + vx * k + rand(-22, 22), y: c.y + rand(-18, 18) };
  }

  // ------------------------------------------------------------------ tasks (generators)
  *wait(t) { while ((t -= this.dt) > 0) yield; }

  *moveTo(target, tol = 10, maxT = 1.2) {
    for (let t = 0; t < maxT; t += this.dt) {
      const p = typeof target === 'function' ? target() : target;
      this.goal = p;
      if (dist(this.cur.x, this.cur.y, p.x, p.y) < tol) return true;
      yield;
    }
    return false;
  }

  drawNear(kind, material) {
    const g = this.g, c = g.stick.center, p = this.cur;
    // draw beside the cursor, on the far side from him
    const away = Math.sign(p.x - c.x) || 1;
    const at = this.bounds({ x: p.x + away * rand(20, 70), y: p.y + rand(-50, 50) });
    return this.draw(kind, at.x, at.y, material);
  }

  drawWave() {
    const g = this.g, c = g.stick.center;
    const side = c.x < g.w / 2 ? 1 : -1;
    return this.draw('wave', clamp(c.x + side * rand(260, 380), 230, g.w - 160), c.y, chance(0.3) ? 'ice' : 'ink');
  }

  cage() {
    const b = this.g.stick.bounds();
    if (!b) return null;
    return this.draw('box', (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, b.x2 - b.x1 + 80, b.y2 - b.y1 + 70, pick(['ink', 'ice']));
  }

  draw(kind, x, y, ...rest) {
    const material = rest.pop();
    const pts = STROKES[kind](x, y, ...rest);
    if (cost(pts) + 4 > this.g.ink) return null;
    return this.stroke(pts, material);
  }

  *stroke(pts, material) {
    const a = this.a;
    // now and then a hurried, sloppy stroke that the sketchbook doesn't recognize
    if (chance(0.12)) pts = pts.slice(0, Math.max(4, Math.floor(pts.length * rand(0.4, 0.7))));
    if (!(yield* this.moveTo(pts[0], 12, 1.2))) return;
    a.material = material;
    a.setTool('pencil');
    this.place(pts[0]);
    a.down(pts[0].x, pts[0].y);
    if (!a.stroke) return;
    const v = rand(550, 800);
    let i = 1;
    const c = this.cur;
    while (i < pts.length && a.stroke) {
      let budget = v * this.dt;
      while (budget > 0 && i < pts.length) {
        const q = pts[i], d = dist(c.x, c.y, q.x, q.y);
        if (d <= budget) { c.x = q.x; c.y = q.y; budget -= d; i++; } else { c.x += ((q.x - c.x) * budget) / d; c.y += ((q.y - c.y) * budget) / d; budget = 0; }
        a.move(c.x, c.y);
      }
      this.goal = { x: c.x, y: c.y };
      yield;
    }
    a.up(c.x, c.y);
  }

  *zapAt(target, tol) {
    const a = this.a;
    a.setTool('zap');
    if (!(yield* this.moveTo(target, tol, 0.9))) return;
    if (a.cd.zap > 0) return;
    a.down(this.cur.x, this.cur.y);
    a.up(this.cur.x, this.cur.y);
  }

  *bomb() {
    const a = this.a, s = this.g.stick;
    a.setTool('bomb');
    const at = () => { const p = this.lead(s, 0.6); return { x: p.x, y: Math.max(180, s.y - rand(60, 110)) }; };
    if (!(yield* this.moveTo(at, 26, 0.9))) return;
    if (a.cd.bomb > 0) return;
    a.down(this.cur.x, this.cur.y);
    a.up(this.cur.x, this.cur.y);
  }

  *eraseHim(dur) {
    const a = this.a, s = this.g.stick;
    this.eraseCd = rand(7, 11);
    a.setTool('eraser');
    if (!(yield* this.moveTo(() => s.center, 14, 0.9))) return;
    a.down(this.cur.x, this.cur.y);
    for (let t = 0; t < dur; t += this.dt) {
      const c = s.center;
      this.goal = { x: c.x + rand(-6, 6), y: c.y + rand(-6, 6) };
      yield;
    }
    a.up(this.cur.x, this.cur.y);
  }

  *throwHim() {
    const a = this.a, s = this.g.stick;
    this.handCd = rand(9, 14);
    a.setTool('hand');
    if (!(yield* this.moveTo(() => s.center, 10, 0.9))) return;
    const c = s.center;
    this.place(c);
    a.down(c.x, c.y);
    if (a.drag?.kind !== 'stick') { if (a.drag) a.up(c.x, c.y, { vx: 0, vy: 0 }); return; }
    const lift = this.bounds({ x: c.x + rand(-80, 80), y: c.y - rand(170, 260) });
    yield* this.moveTo(lift, 12, 0.45);
    yield* this.wait(0.1);
    a.up(this.cur.x, this.cur.y, { vx: rand(-900, 900), vy: rand(1700, 2400) });   // slam him down
  }

  *closePopups(list) {
    const a = this.a;
    yield* this.wait(rand(0.3, 0.7));   // read it, sigh
    for (const p of list) {
      if (p.dead) continue;
      const r = p.okRect();
      const ok = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      if (Math.abs(p.body.a) < 0.3) {
        if (!(yield* this.moveTo(ok, 6, 1))) continue;
        a.down(this.cur.x, this.cur.y);
        a.up(this.cur.x, this.cur.y);
      } else {
        a.setTool('eraser');
        if (!(yield* this.moveTo({ x: p.body.x, y: p.body.y }, 10, 1))) continue;
        a.down(this.cur.x, this.cur.y);
        a.up(this.cur.x, this.cur.y);
      }
      yield* this.wait(rand(0.1, 0.25));
    }
  }

  // move to the real HUD button, then press it
  *press(sel, fn) {
    const el = this.a.el.querySelector(sel);
    const r = el?.getBoundingClientRect();
    if (r && r.width) yield* this.moveTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, 8, 0.8);
    fn();
  }

  summon() {
    const g = this.g;
    const lvl = g.level;
    let kind;
    if ((g.deskHp < 60 || g.ink < 30) && !g.apps.some((x) => x.kind === 'paint' && x.alive)) kind = 'paint';
    else {
      const present = new Set(g.apps.filter((x) => !x.dead).map((x) => x.kind));
      const pool = this.a.allies.filter((k) => !present.has(k));
      const w = { boss: 1, strong: 2, normal: 3, weak: 2 };
      kind = weighted(pool.map((k) => ({ k, w: w[tierOf(k, lvl)] })))?.k || pick(this.a.allies);
    }
    this.summonAt = g.fightT + rand(25, 40);
    return this.press(`[data-ally="${kind}"]`, () => this.a.summon(kind));
  }

  // the virtual cursor, so spectators can see where "you" are
  draw2d(gx) {
    const p = this.cur;
    gx.save();
    gx.translate(p.x, p.y);
    gx.fillStyle = '#fff'; gx.strokeStyle = '#111'; gx.lineWidth = 1.5; gx.lineJoin = 'round';
    gx.beginPath(); gx.moveTo(0, 0); gx.lineTo(0, 17); gx.lineTo(4.5, 13); gx.lineTo(8, 20); gx.lineTo(10.5, 19); gx.lineTo(7, 12); gx.lineTo(12.5, 12); gx.closePath();
    gx.fill(); gx.stroke();
    gx.font = '11px system-ui, sans-serif';
    gx.fillText('🤖', 12, 30);
    gx.restore();
  }
}
