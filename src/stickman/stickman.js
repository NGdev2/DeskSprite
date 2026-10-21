// The stickman's body: locomotion over platforms, jumps, ragdoll physics, getting up,
// timed actions (punch, slash, draw, sleep…), statuses and the weapon he holds.
// Decisions live in brain.js. This file only does what it's told, physically.
import { POSES, pose, blendPose, fk, lowestOffset, dims, draw as drawRig } from './rig.js';
import { Ragdoll, GRAVITY, landing, platformUnder, JOINTS } from '../world/physics.js';
import { clamp, damp, lerp, rand, sign, segDist, TAU } from '../util.js';

const EASE = (t) => t * t * (3 - 2 * t);

export class Stickman {
  constructor(game, x, y) {
    this.g = game;
    this.x = x; this.y = y;        // feet point
    this.vx = 0; this.vy = 0;
    this.dir = 1;
    this.mode = 'air';             // ground | air | ragdoll | getup
    this.plat = null;
    this.platKey = null;
    this.platDX = 0;
    this.cur = POSES.stand(0);
    this.t = 0;
    this.phase = 0;
    this.goal = null;              // {x, key, run}
    this.action = null;            // {name, t, dur, k, lock, onUpdate, onDone, hold}
    this.rag = null;
    this.getup = null;
    this.airPose = 'fall';
    this.flip = 0;                 // remaining flip rotation (rad)
    this.J = null;
    this.weapon = null;
    this.hp = 100;
    this.maxHp = 100;
    this.st = { stun: 0, frozen: 0, burn: 0, caged: 0, devoured: 0, dizzy: 0, invuln: 0, slow: 0, armor: 0 };
    this.face = 'normal';
    this.lookAt = null;
    this.glitch = 0;
    this.aura = null;
    this.dropThrough = 0;
    this.hover = 0;        // levitation height (meditating)
    this.alpha = 1;        // fades out when stepping through portals
    this.speedMul = 1;     // skateboarding
    this.moonwalk = false;
    this.setScale(game.settings.scale || 1);
  }

  setScale(s) {
    this.scale = s;
    this.d = dims(s);
    this.legLen = this.d.thigh + this.d.shin;
  }

  get onGround() { return this.mode === 'ground'; }
  get ragdolled() { return this.mode === 'ragdoll' || this.mode === 'getup'; }
  get busy() { return !!(this.action && this.action.lock); }
  get disabled() { return this.ragdolled || this.st.stun > 0 || this.st.frozen > 0 || this.st.caged > 0 || this.st.devoured > 0; }
  get center() {
    if (this.J) return { x: (this.J.hip[0] + this.J.neck[0]) / 2, y: (this.J.hip[1] + this.J.neck[1]) / 2 };
    return { x: this.x, y: this.y - this.legLen - this.d.torso / 2 };
  }
  get head() { return this.J ? { x: this.J.head[0], y: this.J.head[1] } : { x: this.x, y: this.y - 70 }; }

  // ------------------------------------------------------------ commands
  walkTo(x, plat = null, run = false) {
    this.goal = { x: clamp(x, 10, this.g.w - 10), key: plat ? plat.key : null, run };
  }
  stop() { this.goal = null; }
  faceTo(x) { if (Math.abs(x - this.x) > 3) this.dir = sign(x - this.x); }

  play(name, dur, opts = {}) {
    this.action = { name, t: 0, dur, k: 0, lock: opts.lock ?? true, onUpdate: opts.onUpdate, onDone: opts.onDone, hold: opts.hold, fired: {} };
    return this.action;
  }
  cancelAction() { this.action = null; }

  // Jump in an arc that lands at (tx, ty).
  jumpTo(tx, ty, flip = false) {
    if (!this.onGround) return false;
    const rise = Math.max(40 * this.scale, this.y - ty + 50 * this.scale);
    const vy0 = -Math.sqrt(2 * GRAVITY * rise);
    const disc = vy0 * vy0 - 2 * GRAVITY * (this.y - ty);
    const t = (-vy0 + Math.sqrt(Math.max(0, disc))) / GRAVITY;
    this.vx = clamp((tx - this.x) / Math.max(0.2, t), -700, 700);
    this.vy = vy0;
    this.dir = sign(this.vx || this.dir);
    this.mode = 'air';
    this.plat = null;
    this.airPose = 'jump';
    this.flip = flip || rise > 220 ? -TAU * this.dir : 0;
    this.g.sfx('jump');
    this.g.fx.dust(this.x, this.y, 5);
    return true;
  }

  hop(vx, vy) {
    this.mode = 'air'; this.plat = null;
    this.vx = vx; this.vy = vy;
    this.airPose = 'jump';
  }

  // Become a ragdoll with the given velocity.
  knock(vx, vy, opts = {}) {
    if (this.st.devoured > 0) return;
    const J = this.J || this.computePoseJoints();
    if (this.mode !== 'ragdoll') {
      this.rag = new Ragdoll(J, this.vx, this.vy);
    }
    this.rag.kick(vx, vy, opts.only);
    if (opts.spin) this.rag.kick(-vx * 0.3, -vy * 0.3, ['f1', 'f2', 'k1', 'k2']);
    this.mode = 'ragdoll';
    this.plat = null;
    this.action = null;
    this.goal = null;
    this.dropWeapon(vx * 0.5, vy * 0.5);
  }

  grab(x, y) {
    if (this.st.devoured > 0) return null;
    if (this.mode !== 'ragdoll') this.knock(0, 0);
    const n = this.rag.nearest(x, y);
    this.rag.pin = { k: n.k, x, y };
    return n.k;
  }
  dragTo(x, y) { if (this.rag && this.rag.pin) { this.rag.pin.x = x; this.rag.pin.y = y; } }
  release(vx, vy) {
    if (!this.rag || !this.rag.pin) return;
    const q = this.rag.p[this.rag.pin.k];
    this.rag.pin = null;
    // carry the throw velocity through the whole body
    const cx = clamp(vx, -2600, 2600), cy = clamp(vy, -2600, 2600);
    for (const k of JOINTS) { const p = this.rag.p[k]; p.px = p.x - cx / 60; p.py = p.y - cy / 60; }
    void q;
  }

  hurt(dmg, vx = 0, vy = 0, src = {}) {
    if (this.st.invuln > 0 && !src.force) return false;
    // your apps hit softer than you do. It's your fight, they just help
    if (src.app || src.obj?.owner === 'ally') dmg *= 0.6;
    this.hp = Math.max(0, this.hp - dmg);
    this.st.invuln = src.invuln ?? 0.25;
    const c = this.center;
    this.g.fx.popText(c.x, c.y - 40, `-${Math.round(dmg)}`, '#ffd166', 16);
    this.g.fx.sparks(c.x, c.y, '#fff', 8);
    this.g.sfx('hit');
    const heavy = Math.hypot(vx, vy) > 700 || dmg >= 14 || src.force;
    if (this.ragdolled) this.rag?.kick(vx * 0.5, vy * 0.5);
    else if (heavy && this.st.armor <= 0) this.knock(vx, vy);
    else { this.play('hurt', 0.25); this.vx += vx * 0.1; }
    this.glitch = Math.min(1, this.glitch + dmg / 40);
    this.g.onStickHurt?.(dmg, src);
    return true;
  }

  // ------------------------------------------------------------ weapon
  takeWeapon(obj) {
    if (this.weapon) this.dropWeapon(0, 0);
    this.weapon = obj;
    obj.heldBy = this;
    obj.owner = 'stick';
    const h = this.J ? this.J.h2 : [this.x, this.y - 40];
    obj.gripInfo = obj.gripLocal(h[0], h[1]);
  }
  dropWeapon(vx = 0, vy = 0) {
    const w = this.weapon;
    if (!w) return;
    this.weapon = null;
    w.heldBy = null;
    w.body.vx = vx + rand(-80, 80); w.body.vy = vy - 200; w.body.w = rand(-8, 8);
    w.body.sleep = 0;
  }
  weaponPts() { return this.weapon ? this.weapon.body.worldPts() : null; }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.g;
    this.t += dt;
    for (const k in this.st) this.st[k] = Math.max(0, this.st[k] - dt);
    this.glitch = Math.max(0, this.glitch - dt * 0.6);
    this.dropThrough = Math.max(0, this.dropThrough - dt);
    if (this.st.devoured > 0) { this.J = null; return; }

    const frozen = this.st.frozen > 0 || this.st.caged > 0;
    if (this.st.burn > 0 && Math.random() < 0.5 && this.J) g.fx.embers(this.J.neck[0], this.J.neck[1], 1);

    if (this.mode === 'ragdoll') {
      const [vx0, vy0] = this.rag.velocity();
      this.rag.step(dt, g.world);
      const [vx1, vy1] = this.rag.velocity();
      const dv = Math.hypot(vx1 - vx0, vy1 - vy0);
      if (dv > 900 && !this.rag.pin) g.onRagImpact?.(dv);
      const hip = this.rag.p.hip;
      this.x = hip.x; this.y = hip.y + this.legLen;
      this.J = this.rag.joints();
      if (this.rag.rest > 0.45 && !this.rag.pin && this.st.stun <= 0) this.startGetup();
      if (hip.y > g.h + 300) this.respawn();
      this.updateWeapon();
      return;
    }

    if (this.mode === 'getup') {
      this.getup.t += dt / this.getup.dur;
      const target = this.computePoseJoints(POSES.crouch(this.t));
      const k = EASE(clamp(this.getup.t, 0, 1));
      const J = {};
      for (const j of JOINTS) {
        J[j] = [lerp(this.getup.from[j][0], target[j][0], k), lerp(this.getup.from[j][1], target[j][1], k)];
      }
      this.J = J;
      if (this.getup.t >= 1) {
        this.mode = 'ground';
        this.cur = POSES.crouch(0);
        this.st.armor = 1.3;
        this.g.onGetUp?.();
      }
      this.updateWeapon();
      return;
    }

    // action timing
    let targetPose = null;
    const A = this.action;
    if (A) {
      A.t += dt;
      A.k = A.dur ? clamp(A.t / A.dur, 0, 1) : 0;
      A.onUpdate?.(A, dt);
      const fn = POSES[A.name];
      if (fn) targetPose = fn(this.t, A.k);
      if (A.dur && A.t >= A.dur && !A.hold) {
        this.action = null;
        A.onDone?.(A);
      }
    }

    if (this.mode === 'ground') this.updateGround(dt, frozen, targetPose);
    else this.updateAir(dt, targetPose);

    this.J = this.computePoseJoints();
    this.updateWeapon();
  }

  updateGround(dt, frozen, actionPose) {
    const g = this.g;
    // follow the platform we're standing on (widgets can move)
    let pl = this.platKey ? g.platformByKey(this.platKey) : null;
    if (pl) {
      if (pl.x1 !== undefined && this.platX1 !== undefined) this.x += pl.x1 - this.platX1;
      if (this.x < pl.x1 - 4 || this.x > pl.x2 + 4) pl = null;
      else if (Math.abs(pl.y - this.y) > 30) pl = null;
      else this.y = pl.y;
    }
    if (!pl) {
      pl = platformUnder(g.platforms, this.x, this.y, 3);
      if (!pl || pl.y - this.y > 3) { this.mode = 'air'; this.airPose = 'fall'; this.vy = 0; this.plat = null; this.platKey = null; return; }
      this.y = pl.y;
    }
    this.plat = pl;
    this.platKey = pl.key;
    this.platX1 = pl.x1;

    let speed = 0;
    if (this.goal && !this.busy && !frozen && !this.disabled) {
      const goalPl = this.goal.key ? g.platformByKey(this.goal.key) : null;
      const samePl = !this.goal.key || this.goal.key === pl.key || !goalPl;
      if (!samePl) {
        // walk toward the nearest point under the target platform, then jump
        const tx = clamp(this.goal.x, goalPl.x1 + 8, goalPl.x2 - 8);
        const dx = tx - this.x;
        const reach = goalPl.y < this.y ? 160 : 240;
        if (Math.abs(dx) < reach || (goalPl.y > this.y && (this.x <= pl.x1 + 10 || this.x >= pl.x2 - 10))) {
          this.jumpTo(tx, goalPl.y);
          return;
        }
        speed = (this.goal.run ? 230 : 80) * this.scale * (this.st.slow > 0 ? 0.4 : 1) * this.speedMul;
        this.dir = sign(dx);
        const nx = this.x + this.dir * speed * dt;
        // jump off our platform toward the target if we'd walk off the edge
        if (nx < pl.x1 + 4 || nx > pl.x2 - 4) { this.jumpTo(tx, goalPl.y); return; }
        this.x = nx;
      } else {
        const tx = clamp(this.goal.x, pl.x1 + 4, pl.x2 - 4);
        const dx = tx - this.x;
        if (Math.abs(dx) > 3) {
          speed = (this.goal.run ? 230 : 80) * this.scale * (this.st.slow > 0 ? 0.4 : 1) * this.speedMul * (this.moonwalk ? 0.6 : 1);
          this.dir = sign(dx);
          this.x += this.dir * Math.min(Math.abs(dx), speed * dt);
          if (this.moonwalk) this.dir = -this.dir; // face away from where he's gliding
        } else {
          this.goal = null;
        }
      }
    }
    if (this.st.slow > 0) speed *= 1;
    const stride = (this.goal?.run ? 70 : 42) * this.scale;
    this.phase = (this.phase + (speed * dt) / stride) % 1;
    let target = actionPose;
    if (!target) {
      if (frozen) target = this.cur;
      else if (this.st.dizzy > 0) target = POSES.dizzy(this.t);
      else if (speed > 0) target = (this.goal?.run ? POSES.run : POSES.walk)(this.t, this.moonwalk ? 1 - this.phase : this.phase);
      else if (this.stance === 'guard') target = POSES.guard(this.t);
      else target = POSES.stand(this.t);
    }
    if (!frozen) blendPose(this.cur, target, damp(this.action ? 22 : 14, dt));
  }

  updateAir(dt, actionPose) {
    const g = this.g;
    const prevY = this.y;
    this.vy += GRAVITY * dt * (this.st.slow > 0 ? 0.35 : 1) * (this.airPose === 'slam' && this.vy > -300 ? 2.6 : 1);
    this.x += this.vx * dt * (this.st.slow > 0 ? 0.4 : 1);
    this.y += this.vy * dt * (this.st.slow > 0 ? 0.4 : 1);
    if (this.x < 8) { this.x = 8; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > g.w - 8) { this.x = g.w - 8; this.vx = -Math.abs(this.vx) * 0.3; }
    let rot = 0;
    if (this.flip) {
      const step = sign(this.flip) * Math.min(Math.abs(this.flip), 11 * dt);
      this.flip -= step;
      if (Math.abs(this.flip) < 0.01) this.flip = 0;
      rot = this.flip;
    }
    const vyNow = this.vy;
    if (this.vy > 0) {
      const pl = this.dropThrough > 0 ? null : landing(g.platforms, this.x, prevY, this.y);
      if (pl) {
        this.y = pl.y;
        this.mode = 'ground';
        this.plat = pl; this.platKey = pl.key; this.platX1 = pl.x1;
        this.vx = 0; this.vy = 0; this.flip = 0;
        if (vyNow > 1100) { g.fx.dust(this.x, this.y, 10); g.fx.shake(3); this.play('land', 0.28); }
        else if (vyNow > 500) { g.fx.dust(this.x, this.y, 5); this.play('land', 0.14); }
        g.onLand?.(vyNow);
        return;
      }
    }
    if (this.y > g.h + 300) { this.respawn(); return; }
    let target = actionPose;
    if (!target) {
      if (this.flip) target = POSES.tuck(this.t);
      else if (this.airPose === 'flyingKick') target = POSES.flyingKick(this.t);
      else if (this.airPose === 'slam') target = this.vy < 0 ? POSES.tuck(this.t) : POSES.slam(this.t);
      else target = this.vy < 0 ? POSES.jump(this.t) : POSES.fall(this.t);
    }
    blendPose(this.cur, target, damp(16, dt));
    this.cur.rot = rot;
  }

  startGetup() {
    const from = this.rag.joints();
    const hipX = this.rag.p.hip.x;
    // find what's under the body
    let low = -Infinity;
    for (const k of JOINTS) low = Math.max(low, this.rag.p[k].y);
    const pl = platformUnder(this.g.platforms, hipX, low - 20, 30) || this.g.floor;
    this.x = clamp(hipX, pl.x1 + 2, pl.x2 - 2);
    this.y = pl.y;
    this.plat = pl; this.platKey = pl.key; this.platX1 = pl.x1;
    this.dir = from.head[0] < from.f1[0] ? -1 : 1;
    this.mode = 'getup';
    this.getup = { from, t: 0, dur: 0.45 };
    this.rag = null;
    this.vx = this.vy = 0;
  }

  respawn() {
    this.mode = 'air';
    this.rag = null;
    this.x = this.g.w * rand(0.3, 0.7);
    this.y = -60;
    this.vx = 0; this.vy = 0;
    this.airPose = 'fall';
    this.g.say(this, 'I\'m back!');
  }

  computePoseJoints(p = this.cur) {
    const J0 = fk(p, this.x, 0, this.dir, this.d);
    if (this.mode === 'ground' && this.sitting && (this.action?.name === 'sit' || this.action?.name === 'fish')) {
      const dy = this.y - 3;
      for (const k in J0) J0[k][1] += dy;
    } else if (this.mode === 'ground' || this.mode === 'getup') {
      const off = lowestOffset(J0, this.d);
      const dy = this.y - off - (this.mode === 'ground' ? this.hover : 0);
      for (const k in J0) J0[k][1] += dy;
    } else {
      const dy = this.y - this.legLen * 0.95;
      for (const k in J0) J0[k][1] += dy;
    }
    return J0;
  }

  updateWeapon() {
    const w = this.weapon;
    if (!w || !this.J) return;
    if (w.dead) { this.weapon = null; return; }
    const h = this.J.h2, e = this.J.e2;
    const theta = Math.atan2(h[1] - e[1], h[0] - e[0]);
    const { grip, tip } = w.gripInfo;
    const phi = Math.atan2(tip.y - grip.y, tip.x - grip.x);
    const a = theta - phi;
    const c = Math.cos(a), s = Math.sin(a);
    const b = w.body;
    const nx = h[0] - (grip.x * c - grip.y * s), ny = h[1] - (grip.x * s + grip.y * c);
    const dt = 1 / 60;
    b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt;
    b.w = (a - b.a) / dt;
    b.x = nx; b.y = ny; b.a = a;
  }

  // ------------------------------------------------------------ queries
  distTo(x, y) {
    const J = this.J;
    if (!J) return Infinity;
    let d = Math.hypot(J.head[0] - x, J.head[1] - y) - this.d.head;
    for (const [a, b] of [['hip', 'neck'], ['sh', 'e1'], ['e1', 'h1'], ['sh', 'e2'], ['e2', 'h2'], ['hip', 'k1'], ['k1', 'f1'], ['hip', 'k2'], ['k2', 'f2']]) {
      d = Math.min(d, segDist(x, y, J[a][0], J[a][1], J[b][0], J[b][1]).d - this.d.width / 2);
    }
    return d;
  }

  bounds() {
    const J = this.J;
    if (!J) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const k in J) {
      x1 = Math.min(x1, J[k][0]); x2 = Math.max(x2, J[k][0]);
      y1 = Math.min(y1, J[k][1]); y2 = Math.max(y2, J[k][1]);
    }
    y1 -= this.d.head;
    return { x1, y1, x2, y2 };
  }

  limb(name) { return this.J ? { x: this.J[name][0], y: this.J[name][1] } : this.center; }

  draw(gx) {
    if (!this.J || this.st.devoured > 0) return;
    const g = this.g;
    let face = this.face;
    if (this.st.dizzy > 0 || (this.mode === 'ragdoll' && this.hp <= 0)) face = 'dizzy';
    else if (this.action?.name === 'sleep') face = 'sleep';
    else if (this.action?.name === 'hurt' || this.mode === 'ragdoll') face = 'hurt';
    const flicker = this.st.invuln > 0 && Math.floor(this.t * 30) % 2;
    drawRig(gx, this.J, this.d, this.dir, {
      color: this.st.frozen > 0 ? '#9fd3ff' : g.settings.color,
      face, lookAt: this.lookAt,
      alpha: (flicker ? 0.55 : 1) * this.alpha,
      glitch: this.glitch,
      aura: this.aura || (this.st.burn > 0 ? '#ff5a1f' : null),
    });
    if (this.st.frozen > 0) {
      const b = this.bounds();
      gx.save();
      gx.fillStyle = 'rgba(180,225,255,0.35)'; gx.strokeStyle = 'rgba(230,248,255,0.9)'; gx.lineWidth = 2;
      gx.beginPath(); gx.roundRect(b.x1 - 10, b.y1 - 8, b.x2 - b.x1 + 20, b.y2 - b.y1 + 14, 6); gx.fill(); gx.stroke();
      gx.restore();
    }
    if (this.st.caged > 0) {
      const b = this.bounds();
      gx.save();
      gx.strokeStyle = '#2ee87a'; gx.lineWidth = 3; gx.shadowColor = '#2ee87a'; gx.shadowBlur = 10;
      const x1 = b.x1 - 14, x2 = b.x2 + 14, y1 = b.y1 - 14, y2 = b.y2 + 4;
      gx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      for (let x = x1 + 10; x < x2; x += 10) { gx.beginPath(); gx.moveTo(x, y1); gx.lineTo(x, y2); gx.stroke(); }
      gx.font = '700 10px system-ui'; gx.fillStyle = '#2ee87a'; gx.textAlign = 'center';
      gx.fillText('QUARANTINED', (x1 + x2) / 2, y1 - 6);
      gx.restore();
    }
    if (this.st.dizzy > 0 && this.J) {
      const [hx, hy] = this.J.head;
      gx.save(); gx.fillStyle = '#ffe066'; gx.font = '12px system-ui';
      for (let i = 0; i < 3; i++) {
        const a = this.t * 5 + (i * TAU) / 3;
        gx.fillText('★', hx + Math.cos(a) * 14 - 5, hy - 14 + Math.sin(a) * 4);
      }
      gx.restore();
    }
  }
}
