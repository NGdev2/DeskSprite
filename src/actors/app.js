// Your apps, alive: an icon that sprouts little legs, walks around, chats and helps you
// fight. The stickman can "possess" one for a while and turn it against you.
import { Body, rectShape, GRAVITY, landing, platformUnder } from '../world/physics.js';
import { Projectile, TextBlock } from '../world/objects.js';
import { APPS, appLine } from './lore.js';
import { artImage, urlImage } from './art.js';
import { clamp, rand, pick, chance, sign, TAU, nextId, dist } from '../util.js';

const SIZE = 44;

export class AppActor {
  constructor(game, kind, x, y, info = {}) {
    this.g = game;
    this.id = nextId('app');
    this.kind = kind;
    this.L = APPS[kind] || APPS.folder;
    this.name = info.name || this.L.nick;
    this.realName = info.name || null;
    this.img = info.iconUrl ? urlImage(info.iconUrl) : artImage(kind);
    this.fallback = artImage(kind);
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.dir = chance(0.5) ? 1 : -1;
    this.mode = 'air';
    this.platKey = null;
    this.goal = null;
    this.t = rand(10);
    this.phase = 0;
    this.maxHp = this.L.hp;
    this.hp = this.maxHp;
    this.down = 0;          // "not responding" timer
    this.possessed = 0;
    this.cd = rand(1, 3);   // ability cooldown
    this.idleT = rand(2, 6);
    this.talkT = rand(6, 20);
    this.body = null;       // rigid body while tumbling
    this.squash = 0;
    this.st = { stun: 0, dance: 0, shieldUp: 0, full: 0 };
    this.spawnT = 0;
    this.dead = false;
    this.speed = this.L.speed;
    this.hostile = false;
  }

  get center() {
    if (this.body) return { x: this.body.x, y: this.body.y };
    return { x: this.x, y: this.y - 14 - SIZE / 2 };
  }
  get alive() { return this.down <= 0 && !this.dead; }
  get enemyOfStick() { return this.possessed <= 0; }

  contains(x, y) {
    const c = this.center;
    return Math.abs(x - c.x) < SIZE / 2 + 6 && Math.abs(y - c.y) < SIZE / 2 + 14;
  }

  walkTo(x, plat = null) { this.goal = { x, key: plat ? plat.key : null }; }

  tumble(vx, vy, w = rand(-8, 8)) {
    const c = this.center;
    if (!this.body) this.body = new Body(rectShape(SIZE, SIZE), c.x, c.y, { restitution: 0.35, friction: 0.6 });
    this.body.vx += vx; this.body.vy += vy; this.body.w += w;
    this.body.sleep = 0;
    this.mode = 'tumble';
    this.goal = null;
  }

  grab(x, y) {
    this.tumble(0, 0, 0);
    this.body.held = { x, y, ox: x - this.body.x, oy: y - this.body.y };
  }
  dragTo(x, y) { if (this.body?.held) { this.body.held.x = x; this.body.held.y = y; } }
  release(vx, vy) {
    if (!this.body?.held) return;
    this.body.held = null;
    this.body.vx = clamp(vx, -2400, 2400); this.body.vy = clamp(vy, -2400, 2400);
    this.body.w = rand(-10, 10);
    this.thrown = 1.2;
    if (Math.hypot(vx, vy) > 500) this.say(pick(['WHOAAA!', 'I\'m flyiiing!', 'Not the face!']));
  }

  hurt(dmg, vx = 0, vy = 0) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - dmg);
    const c = this.center;
    this.g.fx.popText(c.x, c.y - 30, `-${Math.round(dmg)}`, '#ff9aa2', 14);
    this.g.fx.sparks(c.x, c.y, '#fff', 6);
    if (Math.hypot(vx, vy) > 150 || dmg > 8) this.tumble(vx, vy);
    if (this.hp <= 0) {
      this.down = 9;
      this.say(appLine(this.kind, 'hurt') + ' (not responding)');
      this.g.fx.burst(c.x, c.y, { count: 8, color: 'rgba(200,200,200,0.8)', type: 'dust', speed: 80, life: 1.2, size: 7, gravity: -60 });
    } else if (chance(0.35)) this.say(appLine(this.kind, 'hurt'));
    return true;
  }

  possess(t = 9) {
    this.possessed = t;
    this.g.fx.burst(this.center.x, this.center.y, { count: 14, color: ['#9d4edd', '#ff006e'], speed: 160, life: 0.7, size: 4, gravity: 0 });
    this.say(pick(['…yes, master.', 'MUST… OBEY… STICKMAN…', 'Why am I doing this?!']));
  }

  say(text) { this.g.say(this, text); }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.spawnT = Math.min(1, this.spawnT + dt * 2);
    for (const k in this.st) this.st[k] = Math.max(0, this.st[k] - dt);
    // the more helpers there are, the slower each one recharges, so they can't swarm him
    const helpers = g.mode === 'fight' ? g.apps.filter((a) => a.alive && a.possessed <= 0).length : 1;
    this.cd -= dt * (this.possessed > 0 ? 1.3 : 2 / Math.max(2, helpers));
    this.squash *= Math.exp(-dt * 10);
    this.thrown = Math.max(0, (this.thrown || 0) - dt);
    if (this.possessed > 0) {
      this.possessed -= dt;
      if (this.possessed <= 0) this.say(pick(['Huh? What happened?', 'I feel… free!', 'Sorry about that!']));
    }
    if (this.down > 0) {
      this.down -= dt;
      if (this.down <= 0) {
        this.hp = Math.round(this.maxHp * 0.6);
        this.say(pick(['Restarted! I\'m back.', 'Rebooted and ready.', '…what year is it?']));
      }
    }

    if (this.mode === 'tumble') {
      const b = this.body;
      const hit = b.step(dt, g.world);
      if (hit > 400) { this.squash = 1; g.fx.dust(b.x, b.y + SIZE / 2, 4); }
      if (!b.held && b.sleep > 0.25 && this.down <= 0) {
        this.mode = 'ground';
        this.x = b.x; this.y = b.ground ? b.ground.y : b.y + SIZE / 2;
        this.platKey = b.ground?.key || null;
        this.body = null;
        if (chance(0.4)) this.say(pick(['Ow.', 'I\'m okay!', 'Dizzy…', 'Again! …no.']));
      }
      if (b.y > g.h + 300) { this.mode = 'air'; this.body = null; this.x = rand(100, g.w - 100); this.y = -50; this.vy = 0; }
      return;
    }

    if (this.mode === 'air') {
      const py = this.y;
      this.vy += GRAVITY * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.x = clamp(this.x, SIZE / 2, g.w - SIZE / 2);
      if (this.vy > 0) {
        const pl = landing(g.appPlatforms || g.platforms, this.x, py, this.y);
        if (pl) {
          this.y = pl.y; this.mode = 'ground'; this.platKey = pl.key; this.vx = 0;
          if (this.vy > 600) this.squash = 1;
          this.vy = 0;
        }
      }
      if (this.y > g.h + 300) { this.x = rand(100, g.w - 100); this.y = -50; this.vy = 0; }
      return;
    }

    // ground
    let pl = this.platKey ? g.platformByKey(this.platKey) : null;
    if (pl && (this.x < pl.x1 - 4 || this.x > pl.x2 + 4 || Math.abs(pl.y - this.y) > 30)) pl = null;
    if (!pl) pl = platformUnder(g.appPlatforms || g.platforms, this.x, this.y, 3);
    if (!pl || pl.y - this.y > 3) { this.mode = 'air'; this.vy = 0; return; }
    if (this.lastX1 !== undefined && pl.key === this.platKey) this.x += pl.x1 - this.lastX1;
    this.y = pl.y; this.platKey = pl.key; this.lastX1 = pl.x1;

    if (this.down > 0 || this.st.stun > 0) return;
    if (this.job && g.mode !== 'fight') this.cleanThink(dt, pl);
    else if (g.mode === 'fight' && (this.possessed > 0 || g.engaged.has(this))) this.fightThink(dt, pl);
    else this.chillThink(dt, pl);
    if (g.mode === 'fight' && !g.engaged.has(this) && this.possessed <= 0 && chance(dt * 0.15)) {
      this.say(pick(['Go go go!', 'You can do it, Animator!', 'Get him!', 'I\'m on standby!', 'Tag me in!']));
    }

    let moving = false;
    const speed = this.speed * (this.job ? 2.6 : 1);   // Binny hurries to the mess
    if (this.goal) {
      const gp = this.goal.key ? g.platformByKey(this.goal.key) : null;
      if (gp && gp.key !== pl.key) {
        const tx = clamp(this.goal.x, gp.x1 + 10, gp.x2 - 10);
        if (Math.abs(tx - this.x) < 200 || this.x <= pl.x1 + 6 || this.x >= pl.x2 - 6) this.jump(tx, gp.y);
        else { this.dir = sign(tx - this.x); this.x += this.dir * speed * dt; moving = true; }
      } else {
        const tx = clamp(this.goal.x, pl.x1 + 10, pl.x2 - 10);
        if (Math.abs(tx - this.x) > 4) {
          this.dir = sign(tx - this.x);
          this.x += this.dir * Math.min(Math.abs(tx - this.x), speed * dt * (this.st.dance > 0 ? 0.3 : 1));
          moving = true;
        } else this.goal = null;
      }
    }
    if (moving) this.phase = (this.phase + dt * speed / 26) % 1;
  }

  jump(tx, ty) {
    const rise = Math.max(40, this.y - ty + 50);
    const vy0 = -Math.sqrt(2 * GRAVITY * rise);
    const t = (-vy0 + Math.sqrt(Math.max(0, vy0 * vy0 - 2 * GRAVITY * (this.y - ty)))) / GRAVITY;
    this.vx = clamp((tx - this.x) / Math.max(0.2, t), -600, 600);
    this.vy = vy0;
    this.mode = 'air';
    this.goal = null;
  }

  chillThink(dt, pl) {
    const g = this.g;
    // everyone keeps quiet while the stickman naps
    if (g.stick.action?.name === 'sleep') { this.talkT = Math.max(this.talkT, 5); return; }
    this.idleT -= dt;
    if (this.idleT <= 0 && !this.goal) {
      this.idleT = rand(3, 9);
      if (chance(0.25)) {
        // hop to another platform sometimes
        const other = pick(g.platforms.filter((p) => p.x2 - p.x1 > 80));
        if (other) this.walkTo(rand(other.x1 + 20, other.x2 - 20), other);
      } else this.walkTo(clamp(this.x + rand(-200, 200), pl.x1 + 10, pl.x2 - 10));
    }
    this.talkT -= dt;
    if (this.talkT <= 0) {
      this.talkT = rand(18, 45);
      const buddy = g.apps.find((a) => a !== this && a.alive && a.mode === 'ground' && Math.abs(a.x - this.x) < 180 && Math.abs(a.y - this.y) < 20);
      if (g.settings.talk && buddy && chance(0.7)) this.chatWith(buddy);
      else if (g.settings.talk && chance(0.6)) this.say(appLine(this.kind, 'idle'));
    }
    if (this.kind === 'music' && chance(dt * 0.8)) g.fx.notes(this.center.x, this.center.y - 20);
    // the trash bin tidies up stray objects
    if (this.kind === 'trash' && this.st.full <= 0) this.eatNearby(false);
  }

  // After a fight Binny walks to a leftover (game.cleanup picks it) and eats it on arrival.
  cleanThink(dt, pl) {
    const g = this.g, o = this.job.o;
    if (o.dead) { this.job = null; return; }
    const b = o.body;
    if (Math.abs(b.x - this.x) < 42 && Math.abs(b.y - (this.y - 22)) < 70) { g.cleanup.eat(this, this.job); return; }
    if (b.sleep < 0.3 && b.speed() > 60 && this.jobT < 10) return;   // wait until it lands
    if (!this.goal || Math.abs(this.goal.x - b.x) > 20) {
      const tp = g.platformUnderPoint(b.x, b.y + 10);
      this.walkTo(b.x, tp && tp.key !== pl.key ? tp : null);
    }
  }

  // two of your apps gossiping
  chatWith(b) {
    const g = this.g;
    this.goal = null; b.goal = null;
    this.dir = Math.sign(b.x - this.x) || 1; b.dir = -this.dir;
    const opener = pick([
      `Hey ${b.name}, ${pick(['seen the stickman today?', 'how\'s your RAM?', 'nice icon!', 'did you get updated?'])}`,
      pick(['Do you ever wonder why we have legs now?', 'I think the stickman is kind of cool.', 'The Animator clicked me today!']),
      appLine(this.kind, 'idle'),
    ]);
    this.say(opener);
    b.talkT = rand(20, 40);
    g.after(2300, () => b.alive && b.say(pick([appLine(b.kind, 'idle'), 'Haha, true.', 'Don\'t tell the antivirus.', pick(['Same.', 'Totally.', 'Shh, he\'s listening.'])])));
  }

  eatNearby(fightOnly) {
    const g = this.g;
    for (const o of g.objects) {
      if (o.dead || !o.body || o.heldBy || o.kind === 'file' || o.kind === 'popup') continue;
      if (fightOnly && o.owner !== 'stick') continue;
      if (o.cleanup) continue;   // reserved for the post-fight cleanup
      if (o.kind === 'drawn' && o.owner === 'user' && !fightOnly && g.mode !== 'fight' && o.body.sleep < 0.5) continue;
      if (dist(o.body.x, o.body.y, this.x, this.y - 20) < 40) {
        o.dead = true;
        this.st.full = 2;
        this.squash = 1;
        g.fx.burst(this.x, this.y - 40, { count: 6, color: ['#888', '#bbb'], type: 'debris', speed: 120, life: 0.6, size: 4, gravity: 900 });
        if (chance(0.5)) this.say(pick(['Nom!', 'Recycled!', 'Tasty junk.']));
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ fighting
  fightThink(dt, pl) {
    const g = this.g;
    const s = g.stick;
    const hostile = this.possessed > 0;
    const target = hostile ? g.cursorTarget() : (s.st.devoured > 0 ? null : { x: s.center.x, y: s.center.y });
    if (!target) return;
    const dx = target.x - this.x;
    const range = { dash: 60, devour: 40, roll: 50 }[this.L.ability] || 260;
    if (!this.goal || chance(dt)) {
      const want = this.L.ability === 'shield' && !hostile
        ? (g.pointer.x + s.center.x) / 2
        : target.x - sign(dx) * range * 0.8;
      const tp = platformUnder(g.platforms, target.x, target.y, 200);
      if (Math.abs(want - this.x) > 30) this.walkTo(want, tp && Math.abs(tp.y - this.y) > 40 && chance(0.3) ? tp : null);
    }
    this.dir = sign(dx) || this.dir;
    if (this.cd > 0) {
      if (this.L.ability === 'shield') this.shieldTick();
      return;
    }
    this.useAbility(target, hostile);
  }

  shieldTick() {
    const g = this.g;
    this.st.shieldUp = 0.2;
    const c = this.center;
    for (const p of g.projectiles) {
      if (p.owner === 'stick' && !p.dead && dist(p.x, p.y, c.x, c.y) < 50) {
        p.dead = true;
        g.fx.sparks(p.x, p.y, '#ffd36e', 8);
        g.fx.ring(c.x, c.y, 50, 'rgba(255,212,100,0.9)', 0.3);
        if (chance(0.3)) this.say(appLine('folder', 'fight'));
      }
    }
  }

  useAbility(target, hostile) {
    const g = this.g;
    const c = this.center;
    const owner = hostile ? 'stick' : 'ally';
    const d = dist(c.x, c.y, target.x, target.y);
    const shout = () => { if (chance(0.45)) this.say(appLine(this.kind, 'fight')); };
    const s = g.stick;
    switch (this.L.ability) {
      case 'dash': {
        if (d > 340) return;
        this.cd = rand(2.5, 4);
        shout();
        this.jump(target.x, target.y + 10);
        this.vx = sign(target.x - this.x) * 620;
        this.dashT = 0.6;
        break;
      }
      case 'roll': {
        if (d > 320) return;
        this.cd = rand(2.5, 4);
        shout();
        this.tumble(sign(target.x - c.x) * 900, -150, sign(target.x - c.x) * 18);
        this.thrown = 1;
        break;
      }
      case 'quarantine': {
        if (d > 420) return;
        this.cd = rand(9, 12);
        shout();
        g.sfx('scan');
        g.fx.beam(c.x, c.y - 10, target.x, target.y, '#2ee87a', 0.5, 4);
        if (hostile) g.hitCursor(6, target.x, target.y);
        else { s.st.caged = 2; s.hurt(5, 0, 0, { app: this }); }
        break;
      }
      case 'command': {
        this.cd = rand(6, 9);
        const cmds = hostile ? ['sudo rage', 'make chaos', 'yes | bad'] : ['sudo stop', 'kill -9 stick', 'chmod -x stick', '> /dev/null', 'git revert stick', 'shutdown -h stick'];
        const txt = pick(cmds);
        this.say('$ ' + txt);
        const tb = new TextBlock(target.x + rand(-20, 20), Math.max(20, target.y - 260), txt, owner);
        g.addObject(tb);
        break;
      }
      case 'devour': {
        if (hostile) return;
        if (this.eatNearby(true)) { this.cd = 1; return; }
        if (d < 60 && !s.ragdolled && s.st.devoured <= 0) {
          this.cd = rand(7, 10);
          shout();
          s.st.devoured = 2;
          this.squash = 1;
          this.st.full = 2.4;
          g.after(2000, () => {
            const cc = this.center;
            s.x = cc.x; s.y = cc.y - 20; s.mode = 'air'; s.vx = this.dir * 300; s.vy = -500;
            s.st.devoured = 0;
            s.hurt(14, this.dir * 500, -600, { force: true, app: this });
            this.say(pick(['Bleh! Tastes like orange.', 'Spit out!', 'Too spicy!']));
          });
        } else this.cd = 0.4;
        break;
      }
      case 'shield': this.cd = 0.1; this.shieldTick(); break;
      case 'repair': {
        this.cd = rand(4, 6);
        if (hostile) return;
        const cr = g.fx.cracks[0];
        if (cr) {
          g.fx.beam(c.x, c.y, cr.x, cr.y, '#ff99c8', 0.5, 6);
          cr.healing = true;
        }
        g.healDesk(6);
        g.ink = Math.min(g.maxInk, g.ink + 30);
        g.fx.burst(c.x, c.y - 20, { count: 10, color: ['#e63946', '#ffb703', '#2a9d8f', '#457bf5'], speed: 200, life: 0.8, size: 4, gravity: 300 });
        shout();
        break;
      }
      case 'dance': {
        this.cd = rand(14, 18);
        shout();
        g.sfx('note');
        for (let i = 0; i < 6; i++) g.fx.notes(c.x + rand(-30, 30), c.y - 20);
        g.fx.ring(c.x, c.y, 500, 'rgba(199,125,255,0.7)', 0.8);
        if (!hostile) {
          if (!s.ragdolled && s.onGround) {
            s.play('dance', 2.6);
            g.say(s, pick(['Can\'t… stop… dancing!', 'Hey, this is a banger!', 'NOT FAIR!']));
          }
          s.st.stun = 2.6;
        } else {
          for (const a of g.apps) if (a !== this && a.possessed <= 0) a.st.dance = 3;
        }
        break;
      }
      case 'numbers': case 'letters': case 'ping': {
        if (d > 600) return;
        this.cd = rand(1.4, 2.4);
        if (chance(0.3)) shout();
        const sym = this.L.ability === 'numbers' ? pick(['π', '∞', '÷0', '42', '√', 'Σ', '%']) : this.L.ability === 'letters' ? '✉' : '@';
        const a = Math.atan2(target.y - c.y, target.x - c.x);
        const sp = 520;
        g.projectiles.push(new Projectile(c.x, c.y - 10, Math.cos(a) * sp, Math.sin(a) * sp - 120, {
          owner, type: 'text', text: sym, r: 10, dmg: 5, gravity: 300, color: this.L.ability === 'numbers' ? '#ffb703' : '#4cc9f0',
          target: this.L.ability === 'letters' ? () => (hostile ? g.cursorTarget() : s.center) : null,
        }));
        break;
      }
      case 'slow': {
        this.cd = rand(15, 20);
        shout();
        g.fx.ring(c.x, c.y, 600, 'rgba(58,134,255,0.6)', 1);
        if (!hostile) s.st.slow = 4;
        else g.timeWarp(0.5, 3);
        break;
      }
      default: this.cd = 2;
    }
  }

  // contact damage during dashes and rolls
  checkContact() {
    const g = this.g;
    const s = g.stick;
    if (g.mode !== 'fight' || this.possessed > 0) return;
    const c = this.center;
    const moving = (this.dashT > 0 && this.mode === 'air') || (this.mode === 'tumble' && (this.thrown > 0) && this.body && this.body.speed() > 350);
    if (!moving || s.st.devoured > 0) return;
    if (s.distTo(c.x, c.y) < SIZE / 2 + 4) {
      const vx = this.body ? this.body.vx : this.vx, vy = this.body ? this.body.vy : this.vy;
      const sp = Math.hypot(vx, vy);
      s.hurt(clamp(sp / 60, 6, 22), vx * 0.8, vy * 0.6 - 300, { app: this });
      this.dashT = 0; this.thrown = 0;
      if (this.kind === 'browser') g.fx.embers(c.x, c.y, 12);
    }
  }

  postUpdate(dt) {
    this.dashT = Math.max(0, (this.dashT || 0) - dt);
    if (this.dashT > 0 && this.kind === 'browser') this.g.fx.embers(this.center.x, this.center.y, 2);
    this.checkContact();
  }

  // ------------------------------------------------------------ drawing
  draw(gx) {
    const g = this.g;
    const c = this.center;
    const img = this.img.complete && this.img.naturalWidth ? this.img : this.fallback;
    const grey = this.down > 0;
    const sp = this.spawnT;
    gx.save();
    if (this.mode === 'tumble' && this.body) {
      gx.translate(this.body.x, this.body.y);
      gx.rotate(this.body.a);
      gx.scale(sp, sp);
      this.drawLimbs(gx, 0, SIZE / 2, true);
      if (grey) gx.filter = 'grayscale(1) brightness(0.8)';
      if (img.complete && img.naturalWidth) gx.drawImage(img, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
      gx.filter = 'none';
      this.drawEyes(gx, 0, -6);
      gx.restore();
      return;
    }
    const walking = !!this.goal && this.mode === 'ground';
    const dancing = this.st.dance > 0 || (this.kind === 'music' && g.mode !== 'fight' && Math.sin(this.t * 0.4) > 0.6);
    const bob = walking ? Math.abs(Math.sin(this.phase * TAU)) * 4 : dancing ? Math.abs(Math.sin(this.t * 8)) * 6 : Math.sin(this.t * 2) * 1;
    const sq = this.squash;
    const sx = 1 + sq * 0.25, sy = 1 - sq * 0.25;
    gx.translate(this.x, this.y);
    gx.scale(sp, sp);
    // legs
    const legH = 14;
    gx.strokeStyle = '#2a2a33'; gx.lineWidth = 3; gx.lineCap = 'round';
    const sw = walking ? Math.sin(this.phase * TAU) * 7 : 0;
    gx.beginPath();
    gx.moveTo(-7, -legH - bob); gx.lineTo(-7 + sw, 0);
    gx.moveTo(7, -legH - bob); gx.lineTo(7 - sw, 0);
    gx.stroke();
    gx.translate(0, -legH - bob);
    gx.scale(sx, sy);
    if (dancing) gx.rotate(Math.sin(this.t * 8) * 0.15);
    // arms
    const wave = this.saying > 0 ? Math.sin(this.t * 12) * 0.6 : 0;
    gx.beginPath();
    gx.moveTo(-SIZE / 2 + 2, -SIZE / 2); gx.lineTo(-SIZE / 2 - 9, -SIZE / 2 + 12 + Math.sin(this.t * 3) * 2);
    gx.moveTo(SIZE / 2 - 2, -SIZE / 2); gx.lineTo(SIZE / 2 + 9, -SIZE / 2 + 12 - wave * 16);
    gx.stroke();
    if (grey) gx.filter = 'grayscale(1) brightness(0.8)';
    if (this.possessed > 0) { gx.shadowColor = '#9d4edd'; gx.shadowBlur = 16; }
    if (this.st.shieldUp > 0) { gx.shadowColor = '#ffd36e'; gx.shadowBlur = 20; }
    if (img.complete && img.naturalWidth) gx.drawImage(img, -SIZE / 2, -SIZE, SIZE, SIZE);
    gx.filter = 'none'; gx.shadowBlur = 0;
    this.drawEyes(gx, 0, -SIZE * 0.62);
    if (this.st.full > 0 && this.kind === 'trash') {
      gx.font = '700 11px system-ui'; gx.fillStyle = '#fff'; gx.textAlign = 'center';
      gx.fillText('*munch*', 0, -SIZE - 6);
    }
    gx.restore();
    if (g.mode === 'fight' && this.hp < this.maxHp && this.down <= 0) {
      const w = 36, x = c.x - w / 2, y = c.y - SIZE / 2 - 22;
      gx.fillStyle = 'rgba(0,0,0,0.45)'; gx.fillRect(x, y, w, 4);
      gx.fillStyle = this.possessed > 0 ? '#c77dff' : '#7CFF8A';
      gx.fillRect(x, y, (w * this.hp) / this.maxHp, 4);
    }
    if (this.down > 0) {
      gx.font = '600 10px system-ui'; gx.fillStyle = 'rgba(255,255,255,0.9)'; gx.textAlign = 'center';
      gx.fillText('(Not Responding)', c.x, c.y - SIZE / 2 - 14);
    }
  }

  drawLimbs(gx, x, y, flail) {
    gx.strokeStyle = '#2a2a33'; gx.lineWidth = 3; gx.lineCap = 'round';
    const f = flail ? Math.sin(this.t * 20) * 6 : 0;
    gx.beginPath();
    gx.moveTo(-7, y); gx.lineTo(-9 + f, y + 13);
    gx.moveTo(7, y); gx.lineTo(9 - f, y + 13);
    gx.moveTo(-SIZE / 2, 0); gx.lineTo(-SIZE / 2 - 10, -8 + f);
    gx.moveTo(SIZE / 2, 0); gx.lineTo(SIZE / 2 + 10, -8 - f);
    gx.stroke();
  }

  drawEyes(gx, x, y) {
    const g = this.g;
    const blink = Math.sin(this.t * 1.7) > 0.985;
    let tx = this.dir * 2, ty = 0;
    const look = g.mode === 'fight' ? g.stick.head : g.pointer;
    if (look && look.x >= 0) {
      const c = this.center;
      const a = Math.atan2(look.y - c.y, look.x - c.x);
      tx = Math.cos(a) * 2.2; ty = Math.sin(a) * 2.2;
    }
    for (const ex of [-7, 7]) {
      gx.fillStyle = '#fff';
      gx.beginPath();
      gx.ellipse(x + ex, y, 5, blink || this.down > 0 ? 1 : 6, 0, 0, TAU);
      gx.fill();
      gx.strokeStyle = 'rgba(0,0,0,0.5)'; gx.lineWidth = 1; gx.stroke();
      if (!blink && this.down <= 0) {
        gx.fillStyle = this.possessed > 0 ? '#ff1744' : '#111';
        gx.beginPath(); gx.arc(x + ex + tx, y + ty, 2.6, 0, TAU); gx.fill();
      }
    }
    if (this.possessed > 0 || (g.mode === 'fight' && this.cd < 0.5)) {
      gx.strokeStyle = '#111'; gx.lineWidth = 2;
      gx.beginPath();
      gx.moveTo(x - 12, y - 9); gx.lineTo(x - 3, y - 6);
      gx.moveTo(x + 12, y - 9); gx.lineTo(x + 3, y - 6);
      gx.stroke();
    }
  }
}
