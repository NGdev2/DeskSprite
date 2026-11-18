// The stickman's mind. In "chill" mode he has needs (energy, fun, food) and picks
// activities by utility: wander, sit on widgets, sleep, doodle, chat with your apps, play
// with copies of your files, summon new app friends, and sometimes challenge you.
// In "fight" mode he hunts your cursor, steals your drawn weapons, draws his own,
// throws things, fires energy blasts, possesses apps and pelts you with fake errors.
import { line } from '../actors/lore.js';
import { Drawn, shapePoints, Projectile, Popup, Ball } from '../world/objects.js';
import { makeItem } from '../world/sketch.js';
import { installTricks } from './tricks.js';
import { installLayers } from './layers.js';
import { GRAVITY } from '../world/physics.js';
import { clamp, rand, pick, chance, weighted, sign, dist, lerp, segDist } from '../util.js';
import { APPS } from '../actors/lore.js';

const POPUPS = [
  ['Stickman.exe', 'Your desktop has been claimed by Stickman. Click OK to accept.'],
  ['Fatal Exception', 'The cursor has performed an illegal operation: being too slow.'],
  ['System Warning', 'Too much awesome detected near the taskbar.'],
  ['Error 0xSTICK', 'Cannot defeat stickman. Please try again never.'],
  ['Update Required', 'Installing Stickman Pro 2.0… 3% complete.'],
  ['Low Disk Space', 'Not enough room for your ego. (This is fake.)'],
];

// How strong he is in a fight at each level. Every level adds hp, armor, damage, decision speed,
// dodging and reach; level 2+ charges an ultimate that gets bigger at 3 and 5.
// Levels past 5 keep the level-5 numbers (plus a little hp). Level 1 hits a bit harder per move
// because it has far fewer moves (no drawn weapons, possession, kicks, ground pound or ultimate):
// tuned with game.bench() so win rates rise smoothly with level (DS-9).
const HP = [430, 300, 300, 300, 310], ARMOR = [0.12, 0.12, 0.15, 0.17, 0.19], DMG = [1.7, 1.77, 1.82, 1.56, 1.72], ULT = [0, 1.2, 1.4, 1.4, 1.4];
const DODGE = [0.6, 0.6, 0.62, 0.65, 0.72], CANCEL = [0, 0, 0, 0.15, 0.4];
const HOMING = [1.0, 1.3, 1.6, 1.8, 2.0], DOUBLE = [0.3, 0.45, 0.6, 0.75, 0.9];
export function power(lvl) {
  const k = Math.max(0, lvl - 1), i = Math.min(4, k);
  return {
    hp: HP[i] + Math.max(0, k - 4) * 15,
    armor: ARMOR[i],                        // share of incoming damage he shrugs off
    dmg: DMG[i],
    speed: 1 + k * 0.16,                    // decisions per second
    dodge: DODGE[i],                        // chance to dodge a threat he sees
    react: Math.max(0.08, 0.26 - k * 0.04), // seconds before he reacts
    dodgeCd: Math.max(0.5, 1.3 - k * 0.15),
    cancel: CANCEL[i],                      // chance to abort an attack to dodge (level 4+)
    homing: HOMING[i],                      // how hard his blasts curve after your cursor (rad/s)
    double: DOUBLE[i],                      // chance a blast volley has a second shot
    reach: k * 5,                           // extra px on punches, slashes and flying kicks
    getup: Math.max(0.2, 0.45 - k * 0.06),  // seconds lying still before getting up
    ult: ULT[i],                            // ultimate charge per second
  };
}

export class Brain {
  constructor(game, stick) {
    this.g = game;
    this.s = stick;
    this.act = null;
    this.think = 1;
    this.talkCd = 6;
    this.blastCd = 3;
    this.possessCd = 12;
    this.popupCd = 8;
    this.drawCd = 4;
    this.dodgeCd = 0;
    this.statsCd = 5;
    this.challengeT = 0;
    this.lastHurt = 0;
    this.ult = 0;
    this.seen = new WeakSet();   // threats he already decided about
  }

  dmg(n) { return n * (this.g.power?.dmg || 1); }

  get needs() { return this.g.stats; }

  say(text, force) {
    if (!this.g.settings.talk && !force) return;
    if (this.talkCd > 0 && !force) return;
    this.talkCd = rand(3, 6);
    this.g.say(this.s, text);
  }

  update(dt) {
    const s = this.s;
    this.talkCd -= dt;
    this.blastCd -= dt; this.possessCd -= dt; this.popupCd -= dt; this.drawCd -= dt; this.dodgeCd -= dt;
    if (this.g.mode === 'fight') this.fight(dt);
    else this.chill(dt);
    const floating = this.act?.name === 'meditate' || this.act?.name === 'skate';
    if (!floating && s.hover) s.hover = s.hover < 0.5 ? 0 : s.hover * Math.exp(-dt * 6);
    // where to look
    const p = this.g.pointer;
    if (this.g.mode === 'fight') s.lookAt = [p.x, p.y];
    else if (p.x >= 0 && dist(p.x, p.y, s.center.x, s.center.y) < 380) s.lookAt = [p.x, p.y];
    else s.lookAt = null;
  }

  // ================================================================ chill
  chill(dt) {
    const s = this.s, g = this.g, N = this.needs;
    // needs drift (per minute)
    const sleeping = this.act?.name === 'sleep';
    N.energy = clamp(N.energy + (sleeping ? 6 : -0.9) * dt / 60, 0, 100);
    N.fun = clamp(N.fun - 1.1 * dt / 60, 0, 100);
    N.food = clamp(N.food - 0.8 * dt / 60, 0, 100);
    N.anger = clamp(N.anger - 3 * dt / 60, 0, 100);

    this.statsCd -= dt;
    if (this.statsCd <= 0) { this.statsCd = 25; this.checkSystem(); }

    if (this.challengeT > 0) {
      this.challengeT -= dt;
      s.stance = 'guard';
      if (this.challengeT <= 0) {
        g.challenge = false; s.stance = null;
        this.say(line('declined'), true);
        N.anger = Math.max(0, N.anger - 30);
      }
      return;
    }

    if (s.disabled) { this.act = null; return; }
    if (this.act) {
      this.act.t += dt;
      const done = this.act.update(dt, this.act);
      if (done || this.act.t > (this.act.max || 30)) { this.act.end?.(); this.act = null; this.think = rand(0.4, 1.5); }
      return;
    }
    this.think -= dt;
    if (this.think > 0 || !s.onGround) return;
    this.choose();
  }

  choose() {
    const g = this.g, N = this.needs, s = this.s;
    const hour = new Date().getHours();
    const night = hour >= 23 || hour < 6;
    const mis = { calm: 0.3, normal: 1, chaos: 2.4 }[g.settings.mischief] ?? 1;
    const cookie = g.objects.find((o) => o.kind === 'cookie' && !o.dead);
    const ball = g.objects.find((o) => o.kind === 'ball' && !o.dead);
    const apps = g.apps.filter((a) => a.alive);
    const files = g.objects.filter((o) => o.kind === 'file' && !o.broken);
    const opts = [
      { w: cookie ? 50 : 0, f: () => this.actEat(cookie) },
      { w: ball ? 25 + (100 - N.fun) * 0.3 : 0, f: () => this.actBall(ball) },
      { w: N.energy < 25 ? 40 : night ? 12 : N.energy < 50 ? 4 : 0.5, f: () => this.actSleep() },
      { w: 14, f: () => this.actWander() },
      { w: 6, f: () => this.actIdle() },
      { w: g.widgetPlatforms().length ? 8 : 0, f: () => this.actSit() },
      { w: apps.length ? 7 : 0, f: () => this.actChat(pick(apps)) },
      { w: 4 + (100 - N.fun) * 0.06, f: () => this.actDoodle() },
      { w: 4, f: () => this.actExercise() },
      { w: g.widgetPlatforms().length > 1 ? 5 : 0, f: () => this.actParkour() },
      { w: g.settings.apps && g.apps.length < g.maxApps ? 3 + (100 - N.fun) * 0.04 : 0, f: () => this.actSummon() },
      { w: g.settings.files ? (files.length ? 5 : 2) * mis : 0, f: () => this.actFiles(files) },
      { w: 2.5 * mis, f: () => this.actPrank() },
      { w: g.pointer.x >= 0 ? 4 : 0, f: () => this.actFollowCursor() },
      { w: 3, f: () => this.actMeditate() },
      { w: 2.5, f: () => this.actHandstand() },
      { w: 1.2, f: () => this.actSneeze() },
      { w: s.plat && s.plat.x2 - s.plat.x1 > 300 ? 3.5 : 0, f: () => this.actSkate() },
      { w: 3, f: () => this.actJuggle() },
      { w: g.widgetPlatforms().length ? 3 : 0, f: () => this.actFish() },
      { w: 2.5, f: () => this.actPortal() },
      { w: 2.5, f: () => this.actMoonwalk() },
      { w: 2.5, f: () => this.actPlane() },
      { w: apps.length ? 2.5 : 0, f: () => this.actRide() },
      { w: N.food < 30 ? 6 : 0, f: () => this.actComplain('hungry') },
      { w: N.fun < 25 ? 5 : 0, f: () => this.actComplain('bored') },
      { w: g.settings.surpriseFights && !g.sheet ? (N.anger > 60 ? 30 : 0.5 * mis) : 0, f: () => this.actChallenge() },
      // layers: tear through a full-screen widget, sit in the hole, go back
      { w: g.tearWeight(mis), f: () => this.actTearIn() },
      { w: s.layer === 'front' && g.ledgePlatforms().length ? 6 : 0, f: () => this.actSitInHole() },
      { w: s.layer === 'front' ? 2 + g.frontTime() / 15 : 0, f: () => this.actReturnBack() },
    ];
    const o = weighted(opts);
    if (o) o.f();
  }

  start(name, update, opts = {}) {
    this.act = { name, t: 0, update, ...opts };
    return this.act;
  }

  actIdle() {
    const s = this.s;
    const dur = rand(2, 5);
    const pose = pick(['stand', 'think', 'stand', 'wave']);
    if (pose !== 'stand') s.play(pose, Math.min(dur, 2.2));
    if (chance(0.25)) this.say(line('chill'));
    this.start('idle', (dt, a) => {
      if (chance(dt * 0.4)) s.dir *= -1;
      return a.t > dur;
    });
  }

  randomSpot() {
    const g = this.g;
    const pls = g.platforms.filter((p) => p.x2 - p.x1 > 40 && p.kind !== 'object' && p.kind !== 'app');
    const pl = pick(pls);
    return { pl, x: rand(pl.x1 + 10, pl.x2 - 10) };
  }

  actWander() {
    const s = this.s;
    const { pl, x } = this.randomSpot();
    const run = chance(0.25);
    s.walkTo(x, pl, run);
    this.start('wander', () => !s.goal && s.onGround, { max: 14, end: () => s.stop() });
  }

  actSit() {
    const g = this.g, s = this.s;
    const pl = pick(g.widgetPlatforms());
    const right = chance(0.5);
    const x = right ? pl.x2 - 6 : pl.x1 + 6;
    s.walkTo(x, pl);
    const dur = rand(10, 25);
    let sat = false;
    this.start('sit', (dt, a) => {
      if (!sat) {
        if (!s.goal && s.onGround && s.platKey === pl.key) {
          sat = true; a.t = 0;
          s.dir = right ? 1 : -1;
          s.sitting = true;
          s.play('sit', dur, { hold: true });
          if (chance(0.4)) this.say(pick(['Nice view from up here.', 'This widget is comfy.', line('chill')]));
        }
        return a.t > 12;
      }
      if (chance(dt * 0.05)) this.say(line('chill'));
      return a.t > dur || s.platKey !== pl.key || !s.onGround;
    }, { max: 40, end: () => { s.sitting = false; if (s.action?.name === 'sit') s.cancelAction(); } });
  }

  actSleep() {
    const s = this.s, g = this.g, N = this.needs;
    this.say(line('sleepy'));
    const dur = rand(25, 70);
    s.play('sleep', dur, { hold: true });
    this.start('sleep', (dt, a) => {
      if (!g.dormant && chance(dt * 0.6)) { const h = s.head; g.fx.zzz(h.x + 6, h.y - 8); }
      return a.t > dur || (N.energy > 98 && a.t > 10) || s.action?.name !== 'sleep';
    }, { max: 90, end: () => {
      if (s.action?.name === 'sleep') s.cancelAction();
      if (!s.disabled) { s.play('stretch', 1.6); this.say(pick(['*yaaawn* Good nap.', '*stretch*', 'Mmm… what did I miss?'])); }
    } });
  }

  actEat(cookie) {
    const s = this.s, g = this.g, N = this.needs;
    this.start('eat', (dt, a) => {
      if (cookie.dead) return true;
      const cx = cookie.body.x;
      if (Math.abs(cx - s.x) > 18 || !cookie.body.ground) {
        if (!s.goal || Math.abs(s.goal.x - cx) > 10) s.walkTo(cx, cookie.body.ground, true);
        return false;
      }
      if (!a.eating) {
        a.eating = true; s.stop(); s.faceTo(cx);
        s.play('eat', 1.4, { onDone: () => {
          cookie.dead = true;
          N.food = clamp(N.food + 28, 0, 100);
          N.fun = clamp(N.fun + 5, 0, 100);
          g.sfx('eat');
          g.fx.burst(s.head.x, s.head.y, { count: 8, color: '#d4a056', type: 'debris', speed: 120, life: 0.6, size: 3, gravity: 900 });
          this.say(line('fed'), true);
          g.addXp(2);
        } });
      }
      return cookie.dead;
    }, { max: 20 });
  }

  actBall(ball) {
    const s = this.s, g = this.g, N = this.needs;
    let kicks = 0;
    this.start('ball', (dt, a) => {
      if (ball.dead) return true;
      const b = ball.body;
      if (Math.abs(b.x - s.x) > 26) {
        s.walkTo(b.x, b.ground, true);
        return a.t > 15;
      }
      if (!s.busy && s.onGround && b.y > s.y - 60) {
        s.faceTo(b.x);
        s.play('kick', 0.35);
        g.after(120, () => {
          const dir = s.x < g.w / 2 ? 1 : -1;
          b.vx = dir * rand(250, 650); b.vy = -rand(350, 750); b.sleep = 0;
          g.sfx('pop');
        });
        kicks++;
        N.fun = clamp(N.fun + 4, 0, 100);
        if (kicks === 1 && chance(0.5)) this.say(pick(['GOAL!', 'Watch this!', 'Wheee!']));
      }
      return kicks > 5 || a.t > 25;
    }, { max: 30 });
  }

  actChat(app) {
    const s = this.s, g = this.g, N = this.needs;
    if (!app) return;
    let phase = 0;
    this.start('chat', (dt, a) => {
      if (!app.alive) return true;
      const c = app.center;
      if (phase === 0) {
        if (Math.abs(c.x - s.x) > 55 || Math.abs(app.y - s.y) > 10) {
          if (!s.goal) s.walkTo(c.x - sign(c.x - s.x) * 45, g.platformByKey(app.platKey));
          if (a.t > 12) return true;
          return false;
        }
        s.stop(); s.faceTo(c.x); app.dir = -s.dir; app.goal = null;
        phase = 1; a.t2 = 0;
        const L = APPS[app.kind];
        const ex = pick([
          [`Hey ${app.name}! ${pick(['How\'s it going?', 'What\'s new?', 'Wanna hang out?'])}`, pick(L.idle)],
          [pick(['Wanna see a backflip?', 'Race you!', 'Tag, you\'re it!']), pick(L.stick)],
          [`${app.name}, do you think the Animator likes me?`, pick(['They keep dragging you around, so… maybe?', 'I mean… they haven\'t deleted you.', pick(L.idle)])],
          [pick(line('chill') ? [line('chill')] : ['…']), pick(L.idle)],
        ]);
        this.say(ex[0], true);
        g.after(2200, () => app.alive && app.say(ex[1]));
        a.flip = chance(0.3);
        return false;
      }
      a.t2 += dt;
      if (a.t2 > 4.5) {
        N.fun = clamp(N.fun + 8, 0, 100);
        g.bond(app.kind, 2);
        if (a.flip && !s.busy) { s.jumpTo(s.x - s.dir * 30, s.y, true); }
        return true;
      }
      return false;
    }, { max: 25 });
  }

  // Draw something in the air; it becomes a real (fake) object that falls.
  drawShape(kind, x, y, material = 'ink', then) {
    const s = this.s, g = this.g;
    const pts = shapePoints(kind, x, y, s.dir, s.scale);
    s.faceTo(x);
    s.stop();
    g.sfx('draw');
    const sketch = { pts, k: 0, material };
    g.sketches.push(sketch);
    s.play('draw', 1.1, {
      onUpdate: (A) => { sketch.k = A.k; if (chance(0.3)) g.sfx('draw'); },
      onDone: () => {
        sketch.done = true;
        const obj = new Drawn(pts, material, 'stick');
        g.addObject(obj);
        then?.(obj);
      },
    });
  }

  actDoodle() {
    const s = this.s, N = this.needs;
    const kind = pick(['heart', 'star', 'house', 'ball', 'box']);
    const x = s.x + s.dir * 50 * s.scale, y = s.y - 110 * s.scale;
    this.drawShape(kind, x, y, pick(['ink', 'ink', 'bouncy', 'fire', 'ice']), (obj) => {
      obj.life = 25;
      N.fun = clamp(N.fun + 10, 0, 100);
      this.say(line('doodle'));
    });
    this.start('doodle', () => !s.busy, { max: 5 });
  }

  actExercise() {
    const s = this.s, N = this.needs;
    const kind = pick(['pushup', 'dance', 'flip', 'flip']);
    if (kind === 'flip') {
      s.jumpTo(s.x + s.dir * rand(0, 60), s.y, true);
      this.start('flip', (dt, a) => s.onGround && a.t > 0.3, { max: 4 });
    } else {
      const dur = rand(4, 8);
      s.play(kind, dur, { hold: true });
      if (kind === 'dance') this.say(pick(['♪ Dance break! ♪', 'Check these moves!']));
      else this.say(pick(['Gotta stay in shape for our fights.', 'One… two… three…']));
      this.start(kind, (dt, a) => {
        if (kind === 'dance' && chance(dt * 2)) this.g.fx.notes(s.head.x, s.head.y - 10);
        return a.t > dur;
      }, { max: 10, end: () => { s.cancelAction(); N.fun = clamp(N.fun + 6, 0, 100); N.energy -= 3; } });
    }
  }

  actParkour() {
    const s = this.s, g = this.g;
    const route = [];
    const pls = g.widgetPlatforms();
    for (let i = 0; i < 3; i++) route.push(pick(pls));
    route.push(g.floor);
    let i = 0;
    if (chance(0.5)) this.say(pick(['Parkour!', 'Floor is lava!', 'Watch this!']));
    this.start('parkour', (dt, a) => {
      if (!s.goal && s.onGround) {
        if (i >= route.length) return true;
        const pl = route[i++];
        if (pl) s.walkTo(rand(pl.x1 + 10, pl.x2 - 10), pl, true);
      }
      return false;
    }, { max: 30, end: () => s.stop() });
  }

  actSummon() {
    const s = this.s, g = this.g;
    const x = clamp(s.x + s.dir * rand(80, 200), 40, g.w - 40);
    s.faceTo(x);
    this.say(line('summon'), true);
    s.play('cast', 1.0, { onDone: () => g.summonApp(null, x, s.y) });
    this.start('summon', () => !s.busy, { max: 4 });
  }

  actFiles(files) {
    const s = this.s, g = this.g, N = this.needs;
    let f = pick(files);
    if (!f) {
      f = g.spawnFileCopy();
      if (!f) return this.actIdle();
      this.say(line('files'), true);
    }
    let kicks = 0;
    this.start('files', (dt, a) => {
      if (f.broken || f.dead) return true;
      const b = f.body;
      const plat = g.platformUnderPoint(b.x, b.y + 30);
      if (Math.abs(b.x - s.x) > 34) {
        if (!s.goal || Math.abs(s.goal.x - b.x) > 20) s.walkTo(b.x - sign(b.x - s.x) * 20, plat, true);
        return a.t > 15;
      }
      if (!s.busy && s.onGround) {
        s.faceTo(b.x);
        s.play(chance(0.5) ? 'kick' : 'punch', 0.35);
        g.after(120, () => {
          f.knock(s.dir * rand(150, 450), -rand(250, 650));
          g.sfx('pop');
          if (g.settings.mischief === 'chaos' && chance(0.3)) f.damage(g, 2);
        });
        kicks++;
        N.fun = clamp(N.fun + 3, 0, 100);
      }
      return kicks > 3;
    }, { max: 25 });
  }

  actPrank() {
    const s = this.s, g = this.g;
    const k = pick(['popup', 'tip', 'mustache', 'laugh']);
    const apps = g.apps.filter((a) => a.alive);
    if (k === 'popup') {
      s.play('throwRelease', 0.4);
      g.addObject(new Popup(clamp(s.x + s.dir * 160, 140, g.w - 140), clamp(s.y - 160, 70, g.h - 80),
        'Stickman.exe', pick(['Stickman would like to be your friend.', 'Your desktop is 3% cooler now.', 'Hi! I live here now. :)', 'Please rate your stickman experience ★★★★★'])));
      this.say(pick(['Hehe, check your messages.', 'Totally real error. Trust me.']));
    } else if (k === 'tip' && apps.length) {
      const app = pick(apps);
      this.start('tip', (dt, a) => {
        const c = app.center;
        if (Math.abs(c.x - s.x) > 40) { if (!s.goal) s.walkTo(c.x, g.platformByKey(app.platKey), true); return a.t > 12; }
        s.faceTo(c.x);
        s.play('punch', 0.3);
        app.tumble(s.dir * 260, -380);
        app.say(pick(['HEY!', 'Rude!', 'Why?!']));
        g.bond(app.kind, -3);
        this.say(pick(['Hehe.', 'Oops.', 'Tag!']));
        return true;
      }, { max: 14 });
      return;
    } else {
      s.play('laugh', 1.5);
      this.say(pick(['Hahaha!', 'I just thought of something funny.']));
    }
    this.start('prank', () => !s.busy, { max: 4 });
  }

  actFollowCursor() {
    const s = this.s, g = this.g;
    this.start('follow', (dt, a) => {
      const p = g.pointer;
      if (p.x < 0) return true;
      const under = g.platformUnderPoint(p.x, p.y);
      if (!s.goal || Math.abs(s.goal.x - p.x) > 40) s.walkTo(p.x, under, dist(p.x, p.y, s.x, s.y) > 300);
      if (a.t > 1 && chance(dt * 0.15)) this.say(pick(['Where are you going?', 'Wait for me!', 'I\'ll catch you!', 'Tag!']));
      return a.t > rand(6, 12);
    }, { max: 14, end: () => s.stop() });
  }

  actComplain(kind) {
    this.say(line(kind), true);
    this.s.play(kind === 'hungry' ? 'think' : 'taunt', 1.5);
    this.start('complain', () => !this.s.busy, { max: 3 });
  }

  actChallenge() {
    const s = this.s, g = this.g;
    if (!g.settings.surpriseFights) return this.actIdle();
    this.challengeT = 15;
    g.challenge = true;
    s.stop();
    this.say(line('challenge'), true);
    g.fx.burst(s.head.x, s.head.y - 20, { count: 6, color: '#ff4d4d', type: 'text', text: '!', speed: 80, life: 1, size: 18, gravity: 0 });
  }

  cancelChallenge() { this.challengeT = 0; this.g.challenge = false; this.s.stance = null; }

  async checkSystem() {
    const g = this.g, s = this.s;
    let st;
    try { st = await g.ctx.host.stats(); } catch { return; }
    if (!st || g.mode === 'fight' || s.disabled || this.act?.name === 'sleep') return;
    if (st.cpu > 85) {
      this.say(line('cpuHot', { cpu: Math.round(st.cpu) }), true);
      for (let i = 0; i < 4; i++) g.after(i * 300, () => g.fx.sweat(s.head.x, s.head.y));
    } else if (st.battery && st.battery.percent < 15 && !/charg/i.test(st.battery.status || '')) {
      this.say(line('batteryLow', { bat: Math.round(st.battery.percent) }), true);
      this.needs.energy = Math.min(this.needs.energy, 30);
    }
  }

  // reactions to the user (chill mode)
  onPoke() {
    const N = this.needs;
    N.anger = clamp(N.anger + 9, 0, 100);
    this.s.play('hurt', 0.3);
    this.say(N.anger > 55 ? line('angry') : line('poked'), true);
  }
  onPet() {
    const N = this.needs, g = this.g, s = this.s;
    N.fun = clamp(N.fun + 6, 0, 100);
    N.anger = clamp(N.anger - 8, 0, 100);
    s.play('cheer', 0.9);
    g.ctx.particles.burst({ x: s.head.x, y: s.head.y - 10, preset: 'hearts', count: 6 });
    this.say(line('petted'));
    g.addXp(1);
  }
  onThrown(speed) {
    const N = this.needs;
    this.act = null;
    if (speed > 900) { N.anger = clamp(N.anger + 12, 0, 100); this.say(line('thrown'), true); }
    else N.fun = clamp(N.fun + 3, 0, 100);
  }
  onLanded(hard) {
    if (this.s.slamming) return this.onSlamLand();
    if (this.g.mode === 'fight') return;
    if (hard) { this.s.st.dizzy = 1.8; this.say(line('landed'), true); }
  }

  // ================================================================ fight
  fight(dt) {
    const s = this.s, g = this.g;
    const P = g.power, lvl = g.level;
    this.beamTick(dt);
    // track how fast your cursor moves, for leading shots
    const lp = this.lastPtr, cp = g.pointer;
    if (lp && dt > 0) { const k = Math.min(1, dt * 8); this.cursorVel = { x: lerp((this.cursorVel?.x || 0), (cp.x - lp.x) / dt, k), y: lerp((this.cursorVel?.y || 0), (cp.y - lp.y) / dt, k) }; }
    this.lastPtr = { x: cp.x, y: cp.y };
    if (lvl >= 2 && !this.beam) this.ult = Math.min(100, this.ult + dt * P.ult);
    // from level 3 he breaks out of cages and freezes early
    if (lvl >= 3 && s.st.caged > 0) s.st.caged = Math.max(0, s.st.caged - dt * 0.3 * (lvl - 2));
    if (lvl >= 3 && s.st.frozen > 0) s.st.frozen = Math.max(0, s.st.frozen - dt * 0.3 * (lvl - 2));
    // an interrupted charge must not leave his aura lit
    if (s.aura && !this.beam && !this.storm && s.action?.name !== 'charge') s.aura = null;
    this.levitateTick(dt);
    if (s.disabled) return;

    this.dodge();

    if (s.airPose === 'flyingKick' && s.mode === 'air') {
      const f = s.limb('f2');
      const tg = this.targetAt(f.x, f.y, 26 + P.reach * 1.5);
      if (tg) { tg.hit(this.dmg(14), s.dir * 600, -200, 'flyingKick'); s.airPose = 'fall'; g.fx.ring(f.x, f.y, 40); }
    }

    if (this.fightAct || s.busy || !s.onGround || this.beam) return;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = rand(0.25, 0.7) / P.speed;
    if (this.ult >= 100 && lvl >= 2 && g.fightT > 50) return this.ultimate();   // no ultimate in the opening

    const cur = g.cursorTarget();
    const ally = this.nearestAlly(500);
    const c = s.center;
    const dCur = dist(cur.x, cur.y, c.x, c.y);
    if (chance(0.06)) this.say(line('taunt'));

    // steal a drawn weapon lying around
    if (!s.weapon) {
      const w = g.objects.find((o) => o.kind === 'drawn' && o.isStick && !o.heldBy && !o.dead && o.owner === 'user' && dist(o.body.x, o.body.y, s.x, s.y) < 420);
      if (w && chance(0.6)) { g.noteMove('stick', 'steal'); return this.goGrab(w); }
    }

    // n names the move for the fight report
    const options = [];
    if (ally && dist(ally.center.x, ally.center.y, c.x, c.y) < 70) options.push({ n: 'melee', w: 40, f: () => this.melee(this.appTarget(ally)) });
    if (dCur < 95 + P.reach) options.push({ n: 'melee', w: 45, f: () => this.melee(this.cursorTgt()) });
    if (s.weapon) {
      options.push({ n: 'slash', w: 30, f: () => this.weaponAttack(dCur < 140 ? this.cursorTgt() : ally && dist(ally.center.x, ally.center.y, c.x, c.y) < 140 ? this.appTarget(ally) : null) });
      options.push({ n: 'throwWeapon', w: 8, f: () => this.throwWeapon() });
    }
    options.push({ n: 'approach', w: 14, f: () => this.approach(cur) });
    if (this.blastCd <= 0) options.push({ n: 'blast', w: 22 + lvl * 3, f: () => this.blast() });
    const throwable = this.findThrowable();
    if (throwable) options.push({ n: 'throw', w: 18, f: () => this.throwThing(throwable) });
    if (!s.weapon && this.drawCd <= 0 && lvl >= 2) options.push({ n: 'drawWeapon', w: 14, f: () => this.drawWeapon() });
    if (ally && this.possessCd <= 0 && lvl >= 2 && g.apps.filter((a) => a.possessed > 0).length === 0) options.push({ n: 'possess', w: 12, f: () => this.possess(ally) });
    if (this.popupCd <= 0 && lvl >= 3 && g.objects.filter((o) => o.kind === 'popup').length < 3) options.push({ n: 'popups', w: 10, f: () => this.popups() });
    if (cur.y < s.y - 60 && dCur < 420 + P.reach * 8 && lvl >= 2) options.push({ n: 'flyingKick', w: 12 + lvl * 2, f: () => this.flyingKick(cur) });
    if (lvl >= 2 && g.t > (this.poundCd || 0) && dCur < 500) options.push({ n: 'groundPound', w: 9 + lvl, f: () => this.groundPound() });
    if (lvl >= 3 && g.t > (this.teleCd || 0) && dCur > 250) options.push({ n: 'teleport', w: 9 + lvl * 2, f: () => this.teleportStrike() });
    const file = g.objects.find((o) => o.kind === 'file' && !o.broken && dist(o.body.x, o.body.y, s.x, s.y) < 300);
    if (file) options.push({ n: 'smashFile', w: 8, f: () => this.smashFile(file) });
    if (ally && dist(ally.center.x, ally.center.y, c.x, c.y) < 300) options.push({ n: 'chaseApp', w: 10, f: () => this.approach(ally.center, true) });
    // the heavy hitters draw his attention now and then (so a boss's extra hp actually matters)
    const heavy = g.apps.find((a) => a.alive && a.possessed <= 0 && (a.tier === 'boss' || a.tier === 'strong') && dist(a.center.x, a.center.y, c.x, c.y) < 700);
    if (heavy) options.push({ n: 'huntApp', w: heavy.tier === 'boss' ? 9 : 5, f: () => this.approach(heavy.center, true) });
    options.push({ n: 'taunt', w: 3, f: () => { s.play('taunt', 0.8); this.say(line('taunt'), true); } });
    // take the fight up the screen: float up and fight from the air, or perch on a widget
    if (!(this.levT > 0) && g.t > (this.levCd || 0)) options.push({ n: 'levitate', w: 24 + lvl * 2, f: () => this.levitate() });
    const perch = s.layer === 'back' ? pick(g.widgetPlatforms()) : null;
    if (perch && s.platKey === 'floor') options.push({ n: 'perch', w: 8, f: () => { s.walkTo(rand(perch.x1 + 10, perch.x2 - 10), perch, true); this.think = rand(0.8, 1.4); } });
    const o = weighted(options);
    if (o) { g.noteMove('stick', o.n); o.f(); }
  }

  // Float a few hundred px up and keep fighting from the air (blasts, slashes, moving sideways).
  levitate() {
    const s = this.s, g = this.g;
    this.levT = rand(10, 16);
    this.levH = rand(230, 380) * s.scale;
    this.levCd = g.t + this.levT + rand(2, 4);
    if (chance(0.5)) this.say(pick(['Up here!', 'Gravity is optional.', 'Catch me if you can!']), true);
    g.fx.dust(s.x, s.y, 8);
  }

  levitateTick(dt) {
    const s = this.s;
    if (!(this.levT > 0)) return;
    this.levT -= dt;
    if (s.ragdolled) { this.levT = 0; return; }   // a jump or dodge doesn't end it, a knockdown does
    s.hover = lerp(s.hover, this.levT > 0.6 ? this.levH : 0, Math.min(1, dt * 3));
    if (Math.random() < dt * 6) this.g.fx.burst(s.x, s.y - s.hover + 4, { count: 1, color: '#ffb36b', type: 'spark', speed: 40, life: 0.5, size: 2.5, gravity: 120 });
  }

  onDealt(dmg) { if (this.g.level >= 2) this.ult = Math.min(100, this.ult + dmg * 0.8); }
  onTaken(dmg) { if (this.g.level >= 2) this.ult = Math.min(100, this.ult + dmg * 0.9); }

  // The ultimate gets bigger with his level: an overcharged blast volley at 2, an ink storm
  // from the sky at 3 (plus a quake at 4), and a sweeping energy beam at 5.
  ultimate() {
    const s = this.s, g = this.g, lvl = g.level;
    this.ult = 0;
    s.stop();
    s.faceTo(g.pointer.x);
    const name = lvl >= 5 ? 'finalBeam' : lvl >= 3 ? 'inkStorm' : 'overcharge';
    g.noteMove('stick', 'ULT ' + name);
    const title = { overcharge: 'OVERCHARGE', inkStorm: lvl >= 4 ? 'INK STORM + QUAKE' : 'INK STORM', finalBeam: 'FINAL FORM' }[name];
    g.fx.popText(s.head.x, s.head.y - 40, '★ ' + title + ' ★', '#ffd166', 26);
    g.arena?.flashUlt(title);
    s.aura = name === 'finalBeam' ? '#ffffff' : '#ff3b1f';
    g.fx.shake(6);
    if (name === 'overcharge') {
      this.say(pick(['OVERCHARGE!', 'Full power!']), true);
      s.play('charge', 0.7, { onDone: () => { s.aura = null; for (let i = 0; i < 3; i++) g.after(i * 220, () => this.fireBlast(2.2)); } });
    } else if (name === 'inkStorm') {
      this.say(pick(['INK STORM!', 'Let it rain… ink!', 'Look up, Animator!']), true);
      s.play('cast', 1.6, { hold: false });
      const n = lvl >= 4 ? 10 : 7;
      this.storm = true;
      for (let i = 0; i < n; i++) {
        g.after(250 + i * 150, () => {
          if (g.mode !== 'fight') return;
          const p = g.pointer;
          const x = clamp(p.x + rand(-160, 160), 20, g.w - 20);
          const a = Math.atan2(p.y - -20, p.x - x);
          g.projectiles.push(new Projectile(x, -20, Math.cos(a) * 760, Math.sin(a) * 760, {
            owner: 'stick', type: 'spike', dmg: this.dmg(6), r: 10, color: '#ff5a1f', aim: { x: p.x, y: p.y }, life: 2.4,
          }));
          g.sfx('whoosh');
        });
      }
      g.after(250 + n * 150 + 200, () => { s.aura = null; this.storm = false; if (lvl >= 4 && g.mode === 'fight' && s.onGround && !s.disabled) this.groundPound(); });
    } else {
      this.say(pick(['FINAL FORM!', 'This isn\'t even my final… oh wait, it is.', 'KA… ME… STICK!']), true);
      g.timeWarp(0.55, 1.1);
      g.fx.ring(s.center.x, s.center.y, 160, 'rgba(255,255,255,0.9)', 0.9);
      s.play('charge', 1.1, { onDone: () => {
        const h = s.limb('h2');
        this.beam = { t: 0, dur: 1.5, a: Math.atan2(g.pointer.y - h.y, g.pointer.x - h.x), tick: 0 };
        s.play('cast', 1.5);
        g.sfx('zap');
      } });
    }
  }

  // The final beam tracks your cursor, but it can only turn so fast: outrun it.
  beamTick(dt) {
    const b = this.beam;
    if (!b) return;
    const s = this.s, g = this.g;
    b.t += dt;
    if (b.t > b.dur || g.mode !== 'fight' || s.disabled) { this.beam = null; s.aura = null; return; }
    const h = s.limb('h2');
    const want = Math.atan2(g.pointer.y - h.y, g.pointer.x - h.x);
    let d = want - b.a; d = Math.atan2(Math.sin(d), Math.cos(d));
    b.a += clamp(d, -1.6 * dt, 1.6 * dt);
    const L = Math.hypot(g.w, g.h);
    b.x1 = h.x; b.y1 = h.y; b.x2 = h.x + Math.cos(b.a) * L; b.y2 = h.y + Math.sin(b.a) * L;
    s.faceTo(b.x2);
    g.fx.shake(4);
    if ((b.tick -= dt) > 0) return;
    b.tick = 0.2;
    const near = segDistTo(g.pointer, b);
    if (near < 36) g.hitCursor(this.dmg(4), g.pointer.x, g.pointer.y, true, 'beam');
    else if (chance(0.4)) { const k = rand(0.3, 0.8); g.fx.crack(b.x1 + (b.x2 - b.x1) * k * 0.5, b.y1 + (b.y2 - b.y1) * k * 0.5, 0.5); }
    for (const a of g.apps) if (a.alive && a.possessed <= 0 && segDistTo(a.center, b) < 30) a.hurt(this.dmg(3), Math.cos(b.a) * 300, -200);
  }

  drawFx(gx) {
    const b = this.beam;
    if (!b || b.x1 === undefined) return;
    const k = Math.min(1, b.t * 6, (b.dur - b.t) * 4);
    gx.save();
    gx.lineCap = 'round';
    for (const [w, c] of [[34, 'rgba(255,138,31,0.22)'], [18, 'rgba(255,200,90,0.75)'], [6, '#fff']]) {
      gx.strokeStyle = c; gx.lineWidth = w * k;
      gx.beginPath(); gx.moveTo(b.x1, b.y1); gx.lineTo(b.x2, b.y2); gx.stroke();
    }
    gx.restore();
  }

  // ---- targets: something that can be hit by a fist or weapon at point x,y
  cursorTgt() {
    const g = this.g;
    return { get x() { return g.pointer.x; }, get y() { return g.pointer.y; }, hit: (d, vx, vy, by) => g.hitCursor(d, g.pointer.x, g.pointer.y, true, by), kind: 'cursor' };
  }
  appTarget(a) {
    return { get x() { return a.center.x; }, get y() { return a.center.y; }, hit: (d, vx, vy) => a.hurt(d, vx, vy), kind: 'app', app: a };
  }
  targetAt(x, y, r) {
    const g = this.g;
    if (dist(g.pointer.x, g.pointer.y, x, y) < r) return this.cursorTgt();
    for (const a of g.apps) if (a.alive && a.possessed <= 0 && dist(a.center.x, a.center.y, x, y) < r + 18) return this.appTarget(a);
    return null;
  }
  nearestAlly(maxD) {
    let best = null, bd = maxD;
    const c = this.s.center;
    for (const a of this.g.apps) {
      if (!a.alive || a.possessed > 0) continue;
      const d = dist(a.center.x, a.center.y, c.x, c.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // He sees a threat once, decides once (P.dodge), and reacts after P.react seconds.
  // Higher levels see further, react sooner, cancel attacks to dodge (4+), blink away (3+)
  // and sometimes catch a thrown stick right out of the air (4+).
  dodge() {
    const s = this.s, g = this.g, P = g.power, lvl = g.level;
    const c = s.center;
    const see = (t) => { if (this.seen.has(t)) return; this.seen.add(t); if (!this.threat && chance(P.dodge)) { this.threat = t; this.dodgeAt = g.t + P.react; this.threatCancel = chance(P.cancel); } };
    for (const o of g.objects) {
      if (!o.body || o.heldBy || o.owner === 'stick' || o.dead) continue;
      const d = dist(o.body.x, o.body.y, c.x, c.y);
      if (o.kind === 'bomb' || o.item === 'tornado') {
        // a lit bomb next to him gets a fresh look every half second
        if (d < 190 && g.t - (o.seenAt || -9) > 0.5) { o.seenAt = g.t; this.seen.delete(o); see(o); }
        continue;
      }
      const v = o.body.speed();
      if (v < 350) continue;
      const tx = c.x - o.body.x, ty = c.y - o.body.y;
      if (d < 220 + lvl * 30 && (tx * o.body.vx + ty * o.body.vy) / (d * v) > 0.7) see(o);
    }
    for (const p of g.projectiles) {
      if (p.owner === 'stick' || p.dead) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < 160 + lvl * 25 && (c.x - p.x) * p.vx + (c.y - p.y) * p.vy > 0) see(p);
    }
    // from level 3 he notices a lightning or bomb cursor hovering over him
    const ar = g.arena;
    if (lvl >= 3 && ar && (ar.tool === 'zap' || ar.tool === 'bomb') && ar.cd[ar.tool] <= 0 && dist(g.pointer.x, g.pointer.y, c.x, c.y) < 70) {
      ar.hoverMark ||= {};
      see(ar.hoverMark);
    } else if (ar) ar.hoverMark = null;

    const t = this.threat;
    if (!t || g.t < this.dodgeAt) return;
    if (this.dodgeCd > 0 || !s.onGround || s.disabled || (s.busy && !this.threatCancel)) { if (g.t > this.dodgeAt + 0.6) this.threat = null; return; }
    this.threat = null;
    if (t.dead) return;
    this.dodgeCd = P.dodgeCd;
    if (s.busy) s.cancelAction();
    const tx = t.body ? t.body.x : t.x ?? g.pointer.x;
    const away = sign(c.x - tx) || 1;
    if (t.kind === 'drawn' && t.isStick && !s.weapon && lvl >= 4 && chance(0.3)) {
      s.takeWeapon(t);
      t.thrownAt = null;
      g.noteMove('stick', 'catch');
      this.say(pick(['Thanks for the spear!', 'Caught it!', 'Return to sender? Nah, I\'ll keep it.']), true);
      return;
    }
    if (t.kind === 'bomb' || t.item === 'tornado') {
      s.walkTo(clamp(s.x + away * 240, 20, g.w - 20), s.plat, true);
      g.noteMove('stick', 'dodge');
      return;
    }
    if (lvl >= 3 && chance(0.35)) return this.blink(away);
    s.jumpTo(clamp(s.x + away * 150, 20, g.w - 20), s.y - 70 * s.scale, true);
    g.noteMove('stick', 'dodge');
    if (chance(0.4)) this.say(pick(['Missed!', 'Too slow!', 'Nope!']));
  }

  blink(away) {
    const s = this.s, g = this.g;
    const pl = s.plat || g.floor;
    g.noteMove('stick', 'blink');
    g.fx.burst(s.center.x, s.center.y, { count: 10, color: 'rgba(60,60,70,0.7)', type: 'dust', speed: 140, life: 0.45, size: 8, gravity: -40 });
    s.x = clamp(s.x + away * 170, pl.x1 + 8, pl.x2 - 8);
    g.fx.burst(s.x, s.y - 40, { count: 10, color: 'rgba(60,60,70,0.7)', type: 'dust', speed: 140, life: 0.45, size: 8, gravity: -40 });
    g.sfx('whoosh');
    if (chance(0.4)) this.say(pick(['Blink!', 'Over here!', 'Can\'t touch this.']));
  }

  approach(p, run = true) {
    const s = this.s, g = this.g;
    const pl = g.platformUnderPoint(p.x, p.y);
    s.walkTo(p.x - sign(p.x - s.x) * 50, pl, run);
    this.think = rand(0.6, 1.2);
  }

  melee(tg, forced) {
    const s = this.s, g = this.g;
    s.stop();
    s.faceTo(tg.x);
    const kind = forced || pick(['punch', 'punch', 'kick', 'uppercut']);
    const dur = kind === 'kick' ? 0.42 : 0.32;
    const limb = kind === 'kick' ? 'f2' : 'h2';
    const dmg = this.dmg({ punch: 6, kick: 9, uppercut: 11 }[kind]);
    const reach = 40 + (g.power?.reach || 0);
    s.play(kind, dur, {
      onUpdate: (A) => {
        if (A.k > 0.3 && !A.fired.hit) {
          const p = s.limb(limb);
          if (dist(p.x, p.y, tg.x, tg.y) < reach) {
            A.fired.hit = true;
            g.sfx('hit');
            tg.hit(dmg, s.dir * (kind === 'uppercut' ? 200 : 450), kind === 'uppercut' ? -650 : -200, kind);
          }
        }
      },
    });
  }

  goGrab(w) {
    const s = this.s, g = this.g;
    this.say(line('stealWeapon'), true);
    s.walkTo(w.body.x, w.body.ground, true);
    this.start('grab', (dt, a) => {
      if (w.dead || w.heldBy) return true;
      if (Math.abs(w.body.x - s.x) < 30 && s.onGround) {
        s.play('crouch', 0.2, { onDone: () => { if (!w.dead && !w.heldBy) s.takeWeapon(w); } });
        return true;
      }
      if (!s.goal) s.walkTo(w.body.x, w.body.ground, true);
      return a.t > 5;
    }, { max: 6 });
    // run the grab activity through the fight loop
    this.fightAct = this.act;
    this.act = null;
    this.runAct(this.fightAct);
  }

  runAct(a) {
    const g = this.g;
    const tick = () => {
      if (g.mode !== 'fight' || !a || this.s.disabled) { this.fightAct = null; return; }
      a.t += 1 / 30;
      if (a.update(1 / 30, a) || a.t > a.max) { this.fightAct = null; return; }
      g.after(33, tick);
    };
    tick();
  }

  weaponAttack(tg) {
    const s = this.s, g = this.g;
    if (!tg) {
      const cur = g.cursorTarget();
      return this.approach(cur);
    }
    s.stop(); s.faceTo(tg.x);
    const mat = s.weapon.material;
    s.play('slash', 0.5, {
      onUpdate: (A) => {
        if (A.k < 0.15 || A.k > 0.7 || A.fired.hit || !s.weapon) return;
        for (const p of s.weaponPts()) {
          if (dist(p.x, p.y, tg.x, tg.y) < 26 + (g.power?.reach || 0)) {
            A.fired.hit = true;
            tg.hit(this.dmg(12 + (mat === 'fire' ? 5 : 0)), s.dir * 500, -300, 'slash');
            if (mat === 'fire') g.fx.embers(p.x, p.y, 10);
            break;
          }
        }
      },
    });
    g.sfx('whoosh');
  }

  throwWeapon() {
    const s = this.s, g = this.g;
    const w = s.weapon;
    const cur = g.cursorTarget();
    s.faceTo(cur.x);
    s.play('throwWind', 0.25, { onDone: () => {
      s.play('throwRelease', 0.2);
      if (s.weapon !== w) return;
      s.dropWeapon();
      this.launch(w.body, cur.x, cur.y, 900);
      w.thrownAt = { x: cur.x, y: cur.y, by: 'stick', t: 1.5 };
    } });
  }

  launch(body, tx, ty, speed = 800) {
    const dx = tx - body.x, dy = ty - body.y;
    const T = clamp(Math.hypot(dx, dy) / speed, 0.25, 0.9);
    body.static = false;
    body.sleep = 0;
    body.vx = dx / T;
    body.vy = dy / T - 0.5 * GRAVITY * T;
    body.w = rand(-12, 12);
  }

  findThrowable() {
    const s = this.s, g = this.g;
    let best = null, bd = 260;
    for (const o of g.objects) {
      if (o.dead || !o.body || o.heldBy || o.kind === 'popup' || (o.kind === 'file' && o.broken)) continue;
      if (o.kind === 'drawn' && o.length > 400) continue;
      const d = dist(o.body.x, o.body.y, s.x, s.y - 20);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  throwThing(o) {
    const s = this.s, g = this.g;
    const cur = g.cursorTarget();
    this.start('throw', (dt, a) => {
      if (o.dead || o.heldBy || (o.kind === 'file' && o.broken)) return true;
      const b = o.body;
      if (Math.abs(b.x - s.x) > 34) {
        if (!s.goal) s.walkTo(b.x, g.platformUnderPoint(b.x, b.y + 30), true);
        return a.t > 4;
      }
      s.stop(); s.faceTo(cur.x);
      s.play('throwWind', 0.22, { onDone: () => {
        s.play('throwRelease', 0.2);
        const p = g.pointer;
        if (o.kind === 'file') { o.knock(0, 0); }
        b.x = s.limb('h2').x; b.y = s.limb('h2').y - 10;
        this.launch(b, p.x, p.y, 950);
        o.thrownAt = { x: p.x, y: p.y, by: 'stick', t: 1.5 };
        g.sfx('whoosh');
      } });
      return true;
    }, { max: 5 });
    this.fightAct = this.act; this.act = null; this.runAct(this.fightAct);
  }

  blast() {
    const s = this.s, g = this.g;
    this.blastCd = rand(3.5, 6) / (1 + g.level * 0.12);
    s.stop();
    s.faceTo(g.pointer.x);
    s.aura = '#ff8a1f';
    if (chance(0.3)) this.say(pick(['HAAAAA!', 'Energy blast!', 'Catch!']), true);
    s.play('charge', 0.55, {
      onUpdate: () => { const h = s.limb('h2'); if (chance(0.5)) g.fx.embers(h.x, h.y, 1); },
      onDone: () => {
        s.aura = null;
        const n = chance(g.power.double) ? 2 : 1;
        for (let i = 0; i < n; i++) g.after(i * 200, () => this.fireBlast(g.power.homing));
      },
    });
  }

  // His blasts curve after your cursor (turn: radians per second, more with every level).
  fireBlast(turn = 0) {
    const s = this.s, g = this.g;
    if (g.mode !== 'fight') return;
    const h = s.limb('h2');
    const v = 640 + (g.level - 1) * 30;
    // he leads his shots (aims where your cursor is heading), better with every level
    const pv = this.cursorVel || { x: 0, y: 0 };
    const lead = Math.min(0.5, dist(h.x, h.y, g.pointer.x, g.pointer.y) / v) * Math.min(1, 0.3 + (g.level - 1) * 0.35);
    const p = { x: g.pointer.x + pv.x * lead, y: g.pointer.y + pv.y * lead };
    s.faceTo(p.x);
    s.play('cast', 0.3);
    const a = Math.atan2(p.y - h.y, p.x - h.x);
    g.projectiles.push(new Projectile(h.x, h.y, Math.cos(a) * v, Math.sin(a) * v, {
      owner: 'stick', type: 'blast', dmg: this.dmg(10), r: 9, aim: turn ? null : { x: p.x, y: p.y },
      target: turn ? () => g.pointer : null, turn,
    }));
    g.sfx('zap');
  }

  drawWeapon() {
    const s = this.s, g = this.g;
    this.drawCd = rand(10, 16);
    this.say(line('drawing'), true);
    const kind = pick(['sword', 'spear', 'staff']);
    const mat = g.level >= 3 && chance(0.5) ? 'fire' : 'ink';
    const h = s.limb('h2');
    this.drawShape(kind, h.x, h.y, mat, (obj) => { s.takeWeapon(obj); });
  }

  // He watches what you draw. Sometimes he draws the same weapon back at you.
  onUserItem(kind) {
    const s = this.s, g = this.g;
    const map = { spear: 'spear', shuriken: 'star', rocket: 'triangle', lightning: 'zigzag', boomerang: 'vee', bow: 'arc', shield: 'ball' };
    if (!map[kind] || g.level < 2 || s.disabled || s.busy || !s.onGround || Math.random() > 0.3) return;
    this.copyCd = this.copyCd || 0;
    if (g.t < this.copyCd) return;
    this.copyCd = g.t + 8;
    const h = s.limb('h2');
    this.say(pick(['Ooh, nice one. My turn!', 'Copycat time!', 'Two can play this game!']), true);
    const x = h.x + s.dir * 30, y = h.y - 40;
    g.noteMove('stick', 'copycat');
    this.drawShape(map[kind], x, y, g.level >= 3 && kind === 'spear' ? 'fire' : 'ink', (obj) => {
      makeItem(g, obj, kind, { radius: 34 }, 'stick');
    });
  }

  possess(app) {
    const s = this.s, g = this.g;
    this.possessCd = rand(15, 22);
    s.stop(); s.faceTo(app.center.x);
    this.say(line('possess'), true);
    s.play('cast', 0.7, { onDone: () => {
      if (!app.alive) return;
      const h = s.limb('h2');
      g.fx.beam(h.x, h.y, app.center.x, app.center.y, '#9d4edd', 0.6, 5);
      app.possess(8 + g.level);
    } });
  }

  popups() {
    const g = this.g, s = this.s;
    this.popupCd = rand(12, 18);
    s.play('laugh', 0.8);
    const n = Math.min(3, 1 + Math.floor(g.level / 2));
    for (let i = 0; i < n; i++) {
      g.after(i * 350, () => {
        const [t, m] = pick(POPUPS);
        g.addObject(new Popup(clamp(g.pointer.x + rand(-220, 220), 140, g.w - 140), clamp(g.pointer.y + rand(-160, 160), 70, g.h - 70), t, m));
        g.sfx('blip');
      });
    }
  }

  flyingKick(cur) {
    const s = this.s, g = this.g;
    if (s.jumpTo(cur.x, cur.y + 20)) {
      s.flip = 0;
      s.airPose = 'flyingKick';
      if (chance(0.4)) this.say(pick(['HI-YAH!', 'Flying kick!']), true);
    }
    void g;
  }

  smashFile(f) {
    const s = this.s, g = this.g;
    this.start('smash', (dt, a) => {
      if (f.broken) return true;
      const b = f.body;
      if (Math.abs(b.x - s.x) > 34) {
        if (!s.goal) s.walkTo(b.x - sign(b.x - s.x) * 20, g.platformUnderPoint(b.x, b.y + 30), true);
        return a.t > 5;
      }
      s.stop(); s.faceTo(b.x);
      s.play(chance(0.5) ? 'kick' : 'uppercut', 0.4);
      g.after(150, () => {
        f.knock(s.dir * 300, -500);
        f.damage(g, 2);
        if (f.broken) g.hitDesk(this.dmg(4), b.x, b.y, false, 'smashFile');
      });
      return true;
    }, { max: 6 });
    this.fightAct = this.act; this.act = null; this.runAct(this.fightAct);
  }
}


const segDistTo = (p, b) => segDist(p.x, p.y, b.x1, b.y1, b.x2, b.y2).d;

installTricks(Brain);
installLayers(Brain);
