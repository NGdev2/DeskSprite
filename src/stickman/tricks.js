// Extra personality: the little things he does when nobody's fighting him, and a few
// special fight moves. Installed onto Brain.prototype so they read like brain methods.
import { Drawn, Ball } from '../world/objects.js';
import { clamp, rand, pick, chance, sign, lerp, dist, TAU } from '../util.js';

// Draw a prop in the air with the drawing animation, without making a physics object.
function sketchProp(brain, pts, dur, material, then) {
  const s = brain.s, g = brain.g;
  const sk = { pts, k: 0, material };
  g.sketches.push(sk);
  sk.action = s.play('draw', dur, {
    onUpdate: (A) => { sk.k = A.k; if (chance(0.3)) g.sfx('draw'); },
    onDone: () => { sk.done = true; then?.(); },
  });
}

const tricks = {
  // ------------------------------------------------------------------ chill
  actMeditate() {
    const s = this.s, g = this.g;
    const dur = rand(9, 16);
    s.stop();
    s.play('meditate', dur, { hold: true });
    this.say(pick(['Ommmm…', 'Finding my inner pixel.', 'Shh. Meditating.', 'One with the desktop…']));
    this.start('meditate', (dt, a) => {
      s.hover = lerp(s.hover, 26 * s.scale, Math.min(1, dt * 1.5));
      if (a.t > 2) s.aura = 'rgba(140, 200, 255, 0.9)';
      if (chance(dt * 2)) g.fx.burst(s.center.x + rand(-30, 30), s.y - rand(0, 40), { count: 1, color: '#bde0fe', type: 'spark', speed: 20, life: 1.2, size: 2.5, gravity: -40 });
      return a.t > dur || s.action?.name !== 'meditate';
    }, { max: 20, end: () => { s.aura = null; if (s.action?.name === 'meditate') s.cancelAction(); g.stats.fun = clamp(g.stats.fun + 6, 0, 100); } });
  },

  actHandstand() {
    const s = this.s;
    const dur = rand(4, 7);
    const pl = s.plat;
    s.play('handstand', dur, { lock: false, hold: true });
    if (pl) s.walkTo(clamp(s.x + s.dir * rand(60, 140), pl.x1 + 10, pl.x2 - 10));
    if (chance(0.5)) this.say(pick(['Look, no feet!', 'The world looks better upside down.', 'Blood… rushing… to head…']));
    this.start('handstand', (dt, a) => a.t > dur, { max: 9, end: () => { s.stop(); s.cancelAction(); } });
  },

  actSneeze() {
    const s = this.s, g = this.g;
    s.stop();
    this.say('Ah… ah…', true);
    s.play('sneeze', 1.1, {
      onUpdate: (A) => {
        if (A.k > 0.6 && !A.fired.s) {
          A.fired.s = true;
          const h = s.head;
          g.say(s, pick(['ACHOO!', 'AH-CHOO!', '*sneeze*']), { force: true });
          g.fx.burst(h.x + s.dir * 8, h.y, { count: 10, color: '#cfe8ff', type: 'spark', speed: 260, life: 0.4, size: 2, gravity: 300, angle: s.dir > 0 ? 0 : Math.PI, spread: 0.5 });
          s.x -= s.dir * 10;
          for (const o of g.objects) {
            if (o.body && !o.body.static && dist(o.body.x, o.body.y, h.x, h.y) < 120) o.body.push(s.dir * 250 * o.body.m, -100 * o.body.m);
          }
        }
      },
    });
    this.start('sneeze', () => !s.busy, { max: 3, end: () => { if (chance(0.5)) this.say(pick(['Excuse me.', 'Dusty in here.', 'Someone clean this screen!'])); } });
  },

  actSkate() {
    const s = this.s, g = this.g;
    const pl = s.plat;
    if (!pl || pl.x2 - pl.x1 < 300) return this.actWander();
    const st = { phase: 'draw', rot: 0, spin: 0 };
    const w = 26 * s.scale;
    const bx = s.x + s.dir * 30, by = s.y - 40;
    const pts = [{ x: bx - w, y: by - 4 }, { x: bx - w + 4, y: by }, { x: bx + w - 4, y: by }, { x: bx + w, y: by - 4 }];
    s.stop();
    this.say(pick(['Time to shred!', 'Skate break!', 'Cowabunga!']));
    sketchProp(this, pts, 0.8, 'ink', () => {
      st.phase = 'ride';
      s.play('skate', 99, { lock: false, hold: true });
      s.speedMul = 3.2;
      s.hover = 9 * s.scale;
      const far = s.x - pl.x1 > pl.x2 - s.x ? pl.x1 + 20 : pl.x2 - 20;
      s.walkTo(far, pl);
    });
    this.start('skate', (dt, a) => {
      if (st.phase === 'ride') {
        if (chance(dt * 6)) g.fx.dust(s.x - s.dir * 20, s.y, 1);
        if (!s.goal && s.onGround) {
          st.phase = 'flip';
          s.speedMul = 1;
          s.cancelAction();
          s.jumpTo(s.x - s.dir * 30, s.y);
          s.flip = 0;
          st.spin = TAU * 2;
          this.say(pick(['Kickflip!', 'Tre flip!', 'Radical!']));
        }
      } else if (st.phase === 'flip') {
        st.rot += dt * 18;
        if (s.onGround && a.t > 0.3) {
          st.phase = 'done';
          // the board falls off and becomes a real (fake) object
          const p = pts.map((q) => ({ x: q.x - bx + s.x, y: q.y - by + s.y - 12 }));
          const o = new Drawn(p, 'ink', 'stick');
          o.life = 6;
          g.addObject(o);
          return true;
        }
      }
      return false;
    }, {
      max: 25,
      end: () => { s.speedMul = 1; s.hover = 0; if (s.action?.name === 'skate') s.cancelAction(); g.stats.fun = clamp(g.stats.fun + 12, 0, 100); },
      draw: (gx) => {
        if (st.phase !== 'ride' && st.phase !== 'flip') return;
        const J = s.J; if (!J) return;
        const cx = (J.f1[0] + J.f2[0]) / 2, cy = Math.max(J.f1[1], J.f2[1]) + 3;
        gx.save();
        gx.translate(cx, cy);
        gx.rotate(st.phase === 'flip' ? st.rot : 0);
        gx.strokeStyle = '#1b1b1f'; gx.lineWidth = 4; gx.lineCap = 'round';
        gx.beginPath(); gx.moveTo(-w, -3); gx.lineTo(-w + 5, 0); gx.lineTo(w - 5, 0); gx.lineTo(w, -3); gx.stroke();
        gx.fillStyle = '#e63946';
        for (const x of [-w + 8, w - 8]) { gx.beginPath(); gx.arc(x, 5, 3.5, 0, TAU); gx.fill(); }
        gx.restore();
      },
    });
  },

  actJuggle() {
    const s = this.s, g = this.g;
    const dur = rand(5, 9);
    s.stop();
    s.play('juggle', dur, { hold: true });
    if (chance(0.6)) this.say(pick(['Watch this!', 'Three balls, no problem.', 'I\'ve been practicing!']));
    const colors = ['#ff4d6d', '#ffd166', '#4cc9f0'];
    const fail = chance(0.35);
    const ballPos = (i, t) => {
      // a cascade: each ball goes up from one hand and comes down in the other
      const J = s.J;
      const ph = (t * 1.3 + i / 3) % 1;
      const cx = (J.h1[0] + J.h2[0]) / 2, cy = Math.min(J.h1[1], J.h2[1]);
      const spread = 22 * s.scale;
      const from = ph < 0.5 ? -spread : spread, to = -from;
      const k = (ph % 0.5) * 2;
      return { x: cx + lerp(from, to, k), y: cy - Math.sin(k * Math.PI) * 75 * s.scale };
    };
    this.start('juggle', (dt, a) => {
      if (fail && a.t > dur * 0.7 && !a.dropped && s.J) {
        a.dropped = true;
        s.cancelAction();
        for (let i = 0; i < 3; i++) {
          const p = ballPos(i, a.t);
          g.addObject(new Ball(p.x, p.y, { r: 6, color: colors[i], vx: rand(-200, 200), life: 10 }));
        }
        this.say(pick(['Oops!', 'Butterfingers!', 'That was on purpose.']), true);
        return true;
      }
      return a.t > dur;
    }, {
      max: 12,
      end: () => { if (s.action?.name === 'juggle') s.cancelAction(); g.stats.fun = clamp(g.stats.fun + 8, 0, 100); },
      draw: (gx) => {
        if (!s.J || s.action?.name !== 'juggle') return;
        for (let i = 0; i < 3; i++) {
          const p = ballPos(i, this.act?.t || 0);
          gx.fillStyle = colors[i];
          gx.beginPath(); gx.arc(p.x, p.y, 6, 0, TAU); gx.fill();
        }
      },
    });
  },

  actFish() {
    const s = this.s, g = this.g;
    const pls = g.widgetPlatforms().filter((p) => p.y < g.h - 200);
    if (!pls.length) return this.actWander();
    const pl = pick(pls);
    const right = pl.x2 < g.w - 80 && (pl.x1 < 80 || chance(0.5));
    const x = right ? pl.x2 - 6 : pl.x1 + 6;
    s.walkTo(x, pl);
    const st = { phase: 'go', bite: rand(6, 14), dip: 0 };
    this.start('fish', (dt, a) => {
      if (st.phase === 'go') {
        if (!s.goal && s.onGround && s.platKey === pl.key) {
          st.phase = 'cast'; a.t = 0;
          s.dir = right ? 1 : -1;
          s.sitting = true;
          s.play('fish', 99, { hold: true });
          this.say(pick(['Gone fishing.', 'Let\'s see what lives under this widget.', 'Here fishy fishy…']));
        }
        return a.t > 14;
      }
      if (s.platKey !== pl.key || !s.onGround || s.action?.name !== 'fish') return true;
      if (st.phase === 'cast' && a.t > st.bite) { st.phase = 'bite'; st.dip = 0; this.say('!!!', true); }
      if (st.phase === 'bite') {
        st.dip += dt;
        if (st.dip > 0.9) {
          st.phase = 'caught';
          const tip = st.tip || s.head;
          const catchable = chance(0.25) && g.settings.files ? 'file' : pick(['🐟', '🐠', '🐡', '👢', '🦀', '💾']);
          if (catchable === 'file') {
            const f = g.spawnFileCopy(tip.x, g.platformUnderPoint(tip.x, tip.y + 160));
            if (f) { f.knock(-s.dir * 200, -700); this.say('I caught… a copy of your file?!', true); }
          } else {
            g.fx.burst(tip.x, st.bobY || tip.y + 120, { count: 1, type: 'text', text: catchable, color: '#fff', speed: 420, life: 1.6, size: 26, gravity: 700, angle: -Math.PI / 2 - s.dir * 0.4, spread: 0.1 });
            this.say(catchable === '👢' ? 'An old boot. Classic.' : catchable === '💾' ? 'A floppy disk! Vintage!' : pick(['Caught one!', 'Dinner!', 'Look how big it is!']), true);
          }
          g.stats.fun = clamp(g.stats.fun + 15, 0, 100);
          g.addXp(2);
          a.t = 0;
        }
      }
      return st.phase === 'caught' && a.t > 1.5;
    }, {
      max: 40,
      end: () => { s.sitting = false; if (s.action?.name === 'fish') s.cancelAction(); },
      draw: (gx) => {
        if (st.phase === 'go' || !s.J || s.action?.name !== 'fish') return;
        const [hx, hy] = s.J.h2;
        const tx = hx + s.dir * 50 * s.scale, ty = hy - 34 * s.scale;
        st.tip = { x: tx, y: ty };
        const floor = g.platformUnderPoint(tx, ty + 5).y;
        const bob = st.phase === 'bite' ? Math.sin(st.dip * 30) * 6 + 8 : Math.sin(g.t * 2) * 2;
        const by = Math.min(floor - 6, ty + 150) + bob;
        st.bobY = by;
        gx.save();
        gx.lineCap = 'round';
        gx.strokeStyle = '#7a4a1f'; gx.lineWidth = 3;
        gx.beginPath(); gx.moveTo(hx, hy); gx.lineTo(tx, ty); gx.stroke();
        gx.strokeStyle = 'rgba(255,255,255,0.8)'; gx.lineWidth = 1;
        gx.beginPath(); gx.moveTo(tx, ty); gx.lineTo(tx, by); gx.stroke();
        gx.fillStyle = '#e63946'; gx.beginPath(); gx.arc(tx, by, 4, 0, Math.PI); gx.fill();
        gx.fillStyle = '#fff'; gx.beginPath(); gx.arc(tx, by, 4, Math.PI, TAU); gx.fill();
        gx.restore();
      },
    });
  },

  actPortal() {
    const s = this.s, g = this.g;
    const dests = g.platforms.filter((p) => p.kind === 'widget' || p.kind === 'floor').filter((p) => p.key !== s.platKey && p.x2 - p.x1 > 60);
    if (!dests.length) return this.actWander();
    const B = pick(dests);
    const bx = rand(B.x1 + 25, B.x2 - 25);
    const A = { x: s.x + s.dir * 30, y: s.y };
    const st = { phase: 'open', a: 0, b: 0 };
    s.stop();
    s.faceTo(A.x);
    if (chance(0.6)) this.say(pick(['Shortcut!', 'Now you see me…', 'Portal time!']));
    s.play('cast', 0.8);
    this.start('portal', (dt, a) => {
      if (st.phase === 'open') {
        st.a = Math.min(1, st.a + dt * 2);
        if (a.t > 0.8) { st.phase = 'enter'; s.walkTo(A.x); }
      } else if (st.phase === 'enter') {
        if (!s.goal) {
          s.alpha = Math.max(0, s.alpha - dt * 4);
          if (s.alpha <= 0) {
            st.phase = 'exit';
            s.x = bx; s.y = B.y; s.platKey = B.key; s.plat = B; s.platX1 = B.x1; s.mode = 'ground';
            g.sfx('whoosh');
          }
        }
      } else if (st.phase === 'exit') {
        st.b = Math.min(1, st.b + dt * 3);
        if (st.b > 0.6) s.alpha = Math.min(1, s.alpha + dt * 4);
        if (s.alpha >= 1) { st.phase = 'close'; this.say(pick(['…now you don\'t!', 'Ta-da!', 'Faster than walking.'])); }
      } else {
        st.a -= dt * 2; st.b -= dt * 2;
        if (st.a <= 0 && st.b <= 0) return true;
      }
      return false;
    }, {
      max: 8,
      end: () => { s.alpha = 1; },
      draw: (gx) => {
        const ring = (x, y, k, color) => {
          if (k <= 0) return;
          gx.save();
          gx.shadowColor = color; gx.shadowBlur = 18;
          gx.strokeStyle = color; gx.lineWidth = 5;
          gx.beginPath(); gx.ellipse(x, y - 40 * s.scale, 16 * k, 42 * k * s.scale, 0, 0, TAU); gx.stroke();
          gx.fillStyle = color.replace('1)', '0.18)'); gx.fill();
          gx.restore();
        };
        ring(A.x, A.y, st.a, 'rgba(255,140,30,1)');
        ring(bx, B.y, st.b, 'rgba(60,160,255,1)');
      },
    });
  },

  actMoonwalk() {
    const s = this.s, g = this.g;
    const pl = s.plat;
    if (!pl) return this.actIdle();
    s.moonwalk = true;
    s.walkTo(clamp(s.x + s.dir * rand(140, 260), pl.x1 + 10, pl.x2 - 10));
    this.say(pick(['Hee-hee!', 'Smooth criminal.', '♪ Annie, are you okay? ♪']));
    this.start('moonwalk', (dt, a) => {
      if (chance(dt * 2)) g.fx.notes(s.head.x, s.head.y - 10);
      return (!s.goal && a.t > 0.5) || a.t > 9;
    }, { max: 10, end: () => { s.moonwalk = false; s.stop(); if (chance(0.5)) s.play('cheer', 0.8); } });
  },

  actPlane() {
    const s = this.s, g = this.g;
    const h = s.limb('h2');
    const x = h.x + s.dir * 20, y = h.y - 20;
    const d = s.dir;
    const pts = [{ x: x - d * 20, y: y - 8 }, { x: x + d * 22, y }, { x: x - d * 20, y: y + 8 }, { x: x - d * 10, y }, { x: x - d * 20, y: y - 8 }];
    s.stop();
    sketchProp(this, pts, 0.8, 'ink', () => {
      s.play('throwRelease', 0.3);
      const o = new Drawn(pts, 'ink', 'stick');
      o.life = 12;
      o.body.gravityScale = 0.08;
      o.body.vx = d * 300; o.body.vy = -60;
      let T = 0;
      o.ai = (dt) => {
        T += dt;
        if (o.body.ground) { o.body.gravityScale = 1; return; }
        o.body.vy += Math.sin(T * 3) * 60 * dt;
        o.body.a = Math.atan2(o.body.vy, o.body.vx) - (d < 0 ? Math.PI : 0); o.body.w = 0;
        if (T > 4) o.body.gravityScale = 0.4;
      };
      g.addObject(o);
      this.plane = o;
      this.say(pick(['Fly, little plane!', 'Air mail!', 'Whoosh!']));
    });
    this.start('plane', (dt, a) => {
      const o = this.plane;
      if (a.t < 1.2 || !o) return false;
      if (o.dead) return true;
      if (Math.abs(o.body.x - s.x) > 40) { if (!s.goal || chance(dt * 2)) s.walkTo(o.body.x, g.platformUnderPoint(o.body.x, o.body.y + 10), true); }
      else if (o.body.ground) { o.dead = true; this.say(pick(['Got it!', 'Perfect landing.', 'Again!'])); g.stats.fun = clamp(g.stats.fun + 8, 0, 100); return true; }
      return a.t > 14;
    }, { max: 15, end: () => { this.plane = null; s.stop(); } });
  },

  actRide() {
    const s = this.s, g = this.g;
    const app = pick(g.apps.filter((a) => a.alive && a.mode === 'ground'));
    if (!app) return this.actIdle();
    const st = { phase: 'go' };
    this.start('ride', (dt, a) => {
      const key = 'a:' + app.id;
      const top = g.platformByKey(key);
      if (!app.alive || !top) return true;
      if (st.phase === 'go') {
        if (Math.abs(app.x - s.x) > 120 || Math.abs(app.y - s.y) > 10) {
          if (!s.goal || chance(dt)) s.walkTo(app.x - sign(app.x - s.x) * 60, g.platformByKey(app.platKey));
          return a.t > 12;
        }
        s.stop();
        s.jumpTo(app.x, top.y);
        st.phase = 'jump';
        return false;
      }
      if (st.phase === 'jump') {
        if (s.onGround && s.platKey === key) {
          st.phase = 'ride'; a.t = 0;
          s.play('ride', 99, { lock: false, hold: true });
          app.say(pick(['Hey! I\'m not a horse!', 'Get off me!', 'Fine, ONE lap.', 'Giddy-up, I guess…']));
          const pl = g.platformByKey(app.platKey);
          if (pl) app.walkTo(app.x < (pl.x1 + pl.x2) / 2 ? pl.x2 - 20 : pl.x1 + 20);
          this.say(pick(['Yee-haw!', 'Onward, noble steed!', 'Giddy-up!']));
        } else if (s.onGround) return true;
        return false;
      }
      s.faceTo(s.x + app.dir * 10);
      if (!app.goal && a.t > 1) {
        s.cancelAction();
        s.jumpTo(app.x - app.dir * 80, app.y, true);
        g.bond(app.kind, 1);
        return true;
      }
      return a.t > 12 || s.platKey !== key;
    }, { max: 30, end: () => { if (s.action?.name === 'ride') s.cancelAction(); } });
  },

  onUserReturn() {
    const s = this.s, g = this.g;
    if (g.mode !== 'chill' || s.disabled || s.action?.name === 'sleep' || s.busy) return;
    s.play('wave', 1.6);
    this.say(pick(['Welcome back!', 'There you are!', 'Hey! I missed you.', 'Oh hi! I was totally not up to anything.']), true);
  },

  // ------------------------------------------------------------------ fight
  groundPound() {
    const s = this.s, g = this.g;
    this.poundCd = g.t + rand(9, 14);
    const p = g.pointer;
    s.stop();
    if (chance(0.5)) this.say(pick(['GROUND POUND!', 'Earthquake!', 'Incoming!']), true);
    s.hop(clamp((p.x - s.x) * 1.2, -500, 500), -1150);
    s.airPose = 'slam';
    s.slamming = true;
  },

  onSlamLand() {
    const s = this.s, g = this.g;
    s.slamming = false;
    const x = s.x, y = s.y;
    g.fx.ring(x, y, 230, 'rgba(255,200,120,0.95)', 0.5);
    g.fx.dust(x - 30, y, 10); g.fx.dust(x + 30, y, 10);
    g.fx.shake(14);
    g.sfx('boom');
    g.fx.burst(x, y, { count: 16, color: ['#8d6e63', '#a1887f'], type: 'debris', speed: 420, life: 1.2, size: 5, gravity: 1300, spread: 1.2 });
    if (g.mode !== 'fight') return;
    const R = 230 + (g.level - 1) * 20;   // the shockwave grows with his level
    for (const a of g.apps) {
      const c = a.center;
      const d = dist(c.x, c.y, x, y);
      if (d < R && a.possessed <= 0) a.hurt(this.dmg(10 * (1 - d / R) + 3), sign(c.x - x) * 500, -600);
    }
    for (const o of g.objects) {
      if (o.kind === 'file' && !o.broken && dist(o.body.x, o.body.y, x, y) < R) { o.knock(sign(o.body.x - x) * 300, -650); o.kickedAt = g.t; o.damage(g, 1); }
    }
    if (dist(g.pointer.x, g.pointer.y, x, y) < R - 10) g.hitDesk(this.dmg(10), x, y - 10, false, 'groundPound');
    else g.fx.crack(x, y - 6, 0.7);
  },

  teleportStrike() {
    const s = this.s, g = this.g;
    this.teleCd = g.t + rand(10, 15);
    const c = s.center;
    g.fx.burst(c.x, c.y, { count: 18, color: 'rgba(60,60,70,0.7)', type: 'dust', speed: 160, life: 0.6, size: 10, gravity: -40 });
    g.sfx('whoosh');
    s.alpha = 0;
    s.stop();
    s.st.stun = 0.4;
    this.say(pick(['Behind you!', 'Nothing personal.', 'Blink!']), true);
    g.after(Math.max(200, 380 - (g.level - 3) * 60), () => {
      if (g.mode !== 'fight') { s.alpha = 1; return; }
      const p = g.pointer;
      const pl = g.platformUnderPoint(p.x, p.y);
      s.rag = null; s.mode = 'ground';
      s.dir = Math.random() < 0.5 ? 1 : -1;
      s.x = clamp(p.x - s.dir * 34, pl.x1 + 8, pl.x2 - 8); s.y = pl.y; s.plat = pl; s.platKey = pl.key; s.platX1 = pl.x1;
      s.alpha = 1;
      g.fx.burst(s.x, s.y - 40, { count: 18, color: 'rgba(60,60,70,0.7)', type: 'dust', speed: 160, life: 0.6, size: 10, gravity: -40 });
      s.st.stun = 0;
      this.melee(this.cursorTgt(), 'uppercut');
    });
  },
};

export function installTricks(Brain) {
  Object.assign(Brain.prototype, tricks);
}

