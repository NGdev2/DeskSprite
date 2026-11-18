// Small interactive overlay elements that follow the stickman, the apps and the file
// copies. They make those things clickable and draggable (the rest of the screen stays
// click-through) and they anchor speech bubbles.
import { clamp, rand, pick } from '../util.js';
import { appLine } from '../actors/lore.js';

export class Hitboxes {
  constructor(game) {
    this.g = game;
    this.map = new Map();   // entity -> element
    this.interactive = true;
    this.drag = null;
    this.clicks = [];
    this.layer = 'back';
  }

  // apps and file copies (and so their bubbles) follow a fight to the front layer
  setLayer(layer) {
    this.layer = layer;
    for (const [ent, el] of this.map) if (ent !== this.g.stick) el.setLayer?.(layer);
  }

  destroy() { for (const el of this.map.values()) el.remove(); this.map.clear(); }

  setInteractive(on) {
    this.interactive = on;
    for (const el of this.map.values()) el.setInteractive?.(on);
  }

  make(entity, kind) {
    const layer = kind === 'stick' ? this.g.stick.layer || 'back' : this.layer;
    const el = this.g.ctx.overlay.create({ interactive: this.interactive, className: `ds-hit ds-hit-${kind}`, layer });
    el.dataset.kind = kind;
    el.addEventListener('pointerdown', (e) => this.down(e, entity, kind, el));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    this.map.set(entity, el);
    return el;
  }

  anchorFor(entity) {
    return this.map.get(entity) || null;
  }

  place(el, x1, y1, x2, y2) {
    // snap to a coarse grid so the host's click-through region doesn't change every frame
    const q = 8;
    x1 = Math.floor(x1 / q) * q; y1 = Math.floor(y1 / q) * q;
    x2 = Math.ceil(x2 / q) * q; y2 = Math.ceil(y2 / q) * q;
    const w = Math.max(16, x2 - x1), h = Math.max(16, y2 - y1);
    const key = `${x1 | 0},${y1 | 0},${w | 0},${h | 0}`;
    if (el._k === key) return;
    el._k = key;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.transform = `translate(${x1}px, ${y1}px)`;
  }

  // lazy (calm chill): every DOM move costs a full-screen recomposite, so only things near the
  // pointer or talking (their bubble follows them) move every time; the rest about once a second.
  sync(lazy = false) {
    const g = this.g;
    const live = new Set();
    const s = g.stick;
    const now = performance.now();
    // far ones all catch up together once a second: one recomposite instead of one per hitbox
    const sweep = !lazy || now - (this.sweepT || 0) > 1000;
    if (sweep) this.sweepT = now;
    const due = (ent, el, x, y) => sweep || (ent.sayUntil || 0) > now || Math.abs(x - g.pointer.x) + Math.abs(y - g.pointer.y) < 400;
    live.add(s);
    let el = this.map.get(s) || this.make(s, 'stick');
    const b = s.bounds();
    if (b && due(s, el, s.x, s.y)) this.place(el, b.x1 - 8, b.y1 - 6, b.x2 + 8, b.y2 + 4);
    const disp = s.st.devoured > 0 ? 'none' : '';
    if (el.style.display !== disp) el.style.display = disp;   // unchanged writes still cost a recomposite
    for (const a of g.apps) {
      live.add(a);
      el = this.map.get(a) || this.make(a, 'app');
      const c = a.center;
      if (due(a, el, c.x, c.y)) this.place(el, c.x - 28, c.y - 28, c.x + 28, c.y + 36);
    }
    for (const o of g.objects) {
      if (o.kind !== 'file' || o.broken) continue;
      live.add(o);
      el = this.map.get(o) || this.make(o, 'file');
      this.place(el, o.body.x - 28, o.body.y - 30, o.body.x + 28, o.body.y + 44);
    }
    for (const [ent, e] of this.map) {
      if (!live.has(ent)) { e.remove(); this.map.delete(ent); }
    }
    if (this.drag) this.dragTick();
  }

  // ---------------------------------------------------------------- input (chill mode)
  down(e, entity, kind, el) {
    this.g.wake();
    if (this.g.mode !== 'chill' || e.button !== 0) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.drag = { entity, kind, el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), started: false, hist: [] };
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    this.g.pointer = { x: d.x, y: d.y };
    if (!d.started && Math.hypot(d.x - d.x0, d.y - d.y0) > 6) {
      d.started = true;
      const ent = d.entity;
      if (d.kind === 'stick') { this.g.brain.act = null; ent.grab(d.x0, d.y0); }
      else if (d.kind === 'app') ent.grab(d.x0, d.y0);
      else if (d.kind === 'file') { ent.knock(0, 0); ent.body.held = { x: d.x0, y: d.y0, ox: d.x0 - ent.body.x, oy: d.y0 - ent.body.y }; }
    }
  }

  dragTick() {
    const d = this.drag;
    if (!d.started) return;
    const now = performance.now();
    d.hist.push({ x: d.x, y: d.y, t: now });
    while (d.hist.length > 2 && now - d.hist[0].t > 90) d.hist.shift();
    const ent = d.entity;
    if (d.kind === 'file') { if (ent.body.held) { ent.body.held.x = d.x; ent.body.held.y = d.y; } }
    else ent.dragTo(d.x, d.y);
  }

  velocity(d) {
    const h = d.hist;
    if (h.length < 2) return [0, 0];
    const a = h[0], b = h[h.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    return [(b.x - a.x) / dt, (b.y - a.y) / dt];
  }

  up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const g = this.g;
    if (!d.started) return this.click(d.entity, d.kind);
    const [vx, vy] = this.velocity(d);
    const sp = Math.hypot(vx, vy);
    if (d.kind === 'stick') { d.entity.release(vx, vy); g.brain.onThrown(sp); }
    else if (d.kind === 'app') d.entity.release(vx, vy);
    else if (d.kind === 'file') {
      const b = d.entity.body;
      b.held = null; b.vx = clamp(vx, -2400, 2400); b.vy = clamp(vy, -2400, 2400); b.w = rand(-8, 8);
    }
  }

  click(entity, kind) {
    const g = this.g;
    if (kind === 'stick') {
      if (g.challenge) { g.startFight(); return; }
      const now = performance.now();
      this.clicks = this.clicks.filter((t) => now - t < 1400);
      this.clicks.push(now);
      if (this.clicks.length >= 3) { g.brain.onPoke(); this.clicks = []; }
      else if (entity.action?.name === 'sleep') { entity.cancelAction(); g.brain.act = null; g.say(entity, pick(['Huh?! I\'m up, I\'m up!', '*yawn* What?'])); }
      else g.brain.onPet();
    } else if (kind === 'app') {
      entity.say(appLine(entity.kind, 'idle'));
      if (entity.mode === 'ground') { entity.vy = -380; entity.mode = 'air'; }
    } else if (kind === 'file') {
      entity.knock(rand(-60, 60), -260);
      g.fx.popText(entity.body.x, entity.body.y - 40, 'just a copy — your file is safe', '#cfe8ff', 11);
    }
  }
}
