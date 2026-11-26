// The game: owns the world (platforms from your widgets, objects, apps, the stickman),
// runs the loop, resolves combat, and switches between "chill" and "fight" modes.
//
// SAFETY: this module never writes files, never launches apps and never runs commands.
// Desktop files and apps are read once (names and icons only) to make visual copies.
import { Stickman } from './stickman/stickman.js';
import { Brain, power } from './stickman/brain.js';
import { AppActor } from './actors/app.js';
import { ARCHETYPES, archetypeFor } from './actors/art.js';
import { line, tierOf } from './actors/lore.js';
import { FX } from './fx/fx.js';
import { Sound } from './fx/sound.js';
import { FileCopy, Ball, Cookie, drawInk, Projectile } from './world/objects.js';
import { platformUnder } from './world/physics.js';
import { Arena } from './ui/arena.js';
import { Hitboxes } from './ui/hitboxes.js';
import { Cleanup } from './world/cleanup.js';
import { clamp, rand, pick, chance, dist, TAU } from './util.js';

// Repaint rate in chill while something moves (fights run at 60). The host recomposites the whole
// screen on every change, so this is the main cost of an awake stickman: measured (DS-11) about
// 18% of a core at 15 fps vs 14% at 10 fps, with 7.5% while he sleeps.
const CALM_FPS = 10;
const DEFAULT_STATS = { energy: 85, fun: 70, food: 75, anger: 0, xp: 0, level: 1, wins: 0, losses: 0, fights: 0, bonds: {}, apps: [] };
const FAKE_FILES = [
  { name: 'homework_final_v3.docx', kind: 'file' },
  { name: 'Photos', kind: 'dir' },
  { name: 'secret_plans.txt', kind: 'file' },
  { name: 'cat.png', kind: 'file', mime: 'image/png' },
  { name: 'Projects', kind: 'dir' },
];

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'chill';
    this.t = 0;
    this.timeScale = 1;
    this.warpT = 0;
    this.objects = [];
    this.projectiles = [];
    this.apps = [];
    this.sketches = [];
    this.timers = [];
    this.pointer = { x: -1, y: -1 };
    this.widgetRects = [];
    this.platforms = [];
    this.platMap = new Map();
    this.fx = new FX(this);
    this.sound = new Sound();
    this.ink = 100; this.maxInk = 100;
    this.deskHp = 100;
    this.challenge = false;
    this.maxApps = 4;
    this.engaged = new Set();   // apps actively fighting (the rest cheer)
    this.bubbles = new Map();
    this.hostApps = null;
    this.hostFiles = null;
    this.stats = { ...DEFAULT_STATS, ...(ctx.shared.get('stats', {}) || {}) };
    this.stats.bonds = this.stats.bonds || {};
    this.settings = ctx.settings;
    this.sound.on = !!this.settings.sound;
    // layers: the full-screen "sheet", holes he tore, paper scraps on the floor
    this.sheet = null;
    this.sheetSince = 0;
    this.frontSince = 0;
    this.myTears = new Set();
    this.scraps = [];
    this.cleanup = new Cleanup(this);
    this.fightLevel = null;     // a test fight can override his level without changing his stats
    this.power = power(this.stats.level);
    this.report = null;
    this.resize();
  }

  get level() { return this.fightLevel || this.stats.level; }
  get w() { return this.size.w; }
  get h() { return this.size.h; }
  get world() { return this.worldRef; }

  // ---------------------------------------------------------------- setup
  async start() {
    const ctx = this.ctx;
    this.layer = ctx.overlay.create({ className: 'ds-layer' });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ds-canvas';
    this.layer.append(this.canvas);
    this.gx = this.canvas.getContext('2d');
    // a second canvas in front of an expanded widget, used while he's on the front side
    this.layerFront = ctx.overlay.create({ className: 'ds-layer', layer: 'front' });
    this.canvasFront = document.createElement('canvas');
    this.canvasFront.className = 'ds-canvas';
    this.layerFront.append(this.canvasFront);
    this.gxFront = this.canvasFront.getContext('2d');
    this.fitCanvas();
    this.hit = new Hitboxes(this);
    this.refreshWidgets();
    this.rebuildPlatforms();

    const nest = this.nestRect();
    this.stick = new Stickman(this, nest ? nest.x + nest.w / 2 : this.w / 2, nest ? nest.y - 200 : 100);
    this.stick.layer = 'back';
    this.brain = new Brain(this, this.stick);

    this.sheet = ctx.desktop.sheet?.() || null;
    ctx.on('sheet', (sheet) => {
      if (sheet && !this.sheet) this.sheetSince = performance.now();
      this.sheet = sheet;
      if (!sheet && this.stick.layer === 'front' && !this.fightFront) this.setStickLayer('back');  // the panel closed: drop onto the desktop
      if (this.mode === 'fight' || this.mode === 'ending') this.setFightFront(!!sheet);
      this.wake();
    });
    ctx.on('ticket', ({ type, ticket }) => this.onTicket(type, ticket));

    ctx.on('layout', () => { this.refreshWidgets(); this.wake(); }); // his bed may have moved
    ctx.on('resize', () => this.refreshWidgets());
    ctx.on('move', () => this.refreshWidgets());
    this.listenPointer();
    ctx.on('visibility', ({ visible }) => { this.hidden = !visible; });
    ctx.on('settings', (s) => {
      this.wake();
      this.settings = s;
      this.sound.on = !!s.sound;
      this.stick.setScale(s.scale || 1);
    });
    ctx.on('key', (k) => this.arena?.key(k));
    ctx.on('message', ({ data }) => this.onMessage(data));
    ctx.every(1000, () => { this.refreshWidgets(); if (this.dormant) this.dormantTick(1); });
    ctx.every(10000, () => this.save());
    this.startLoop();

    // read-only snapshots of what's on this computer (names and icons only)
    ctx.host.apps?.().then((a) => { this.hostApps = Array.isArray(a) ? a : []; this.restoreApps(); }).catch(() => { this.hostApps = []; this.restoreApps(); });
    ctx.host.desktopItems?.().then((d) => { this.hostFiles = Array.isArray(d) ? d : []; }).catch(() => { this.hostFiles = []; });

    const hour = new Date().getHours();
    this.after(1500, () => {
      const name = this.settings.name;
      if (hour >= 5 && hour < 11) this.say(this.stick, line('morning'));
      else if (hour >= 23 || hour < 5) this.say(this.stick, line('night'));
      else this.say(this.stick, pick([`${name} is here!`, 'Hi again!', 'Did you miss me?']));
    });
  }

  // ---------------------------------------------------------------- dormancy
  // While he sleeps and nothing moves, the animation loop and cursor polling stop entirely
  // (an idle loop still costs the host a full-screen recomposite). A 1 s timer keeps his
  // needs and sleep going, and any interaction wakes the loop again.
  listenPointer() {
    if (this.offPointer) return;
    this.offPointer = this.ctx.on('pointer', (p) => {
      if (this.arena) return;
      const moved = Math.abs(p.x - this.pointer.x) + Math.abs(p.y - this.pointer.y) > 3;
      this.pointer = { x: p.x, y: p.y };
      if (!moved) return;
      const now = performance.now();
      if (this.lastMove && now - this.lastMove > 90000) this.brain.onUserReturn?.();
      this.lastMove = now;
    });
  }

  canDoze() {
    const s = this.stick;
    if (this.mode !== 'chill' || this.hit.drag || this.challenge) return false;
    if (s.action?.name !== 'sleep' || this.brain.act?.name !== 'sleep' || this.brain.act.t < 3 || !s.onGround || s.hover > 1) return false;
    const fx = this.fx;
    if (fx.parts.length || fx.bolts.length || fx.beams.length || fx.rings.length || fx.texts.length || fx.shakeAmp || fx.flashA || fx.glitchT) return false;
    if (this.projectiles.length || this.sketches.length || this.timers.length || this.cleanup.active) return false;
    if (this.objects.some((o) => o.body && !o.body.static && (o.body.sleep <= 0.6 || o.body.held) || o.kind === 'bomb' || o.kind === 'popup')) return false;
    if (this.apps.some((a) => a.mode !== 'ground' || a.goal || a.squash > 0.05 || a.spawnT < 1)) return false;
    return true;
  }

  doze() {
    this.dormant = true;
    this.stopLoop?.();
    this.stopLoop = null;
    this.offPointer?.();
    this.offPointer = null;
    this.render();
  }

  dormantTick(dt) {
    this.brain.update(dt);
    if (this.stick.action) { this.stick.action.t += dt; }
    if (this.stick.action?.name !== 'sleep' || this.brain.act?.name !== 'sleep') this.wake();
  }

  // Fights run on a 60 Hz animation frame. Chill runs on a 30 Hz timer: a 60 Hz
  // requestAnimationFrame alone costs the host several percent of a core, even with nothing drawn.
  startLoop() {
    this.stopLoop?.();
    if (this.mode === 'chill') {
      let last = performance.now();
      this.stopLoop = this.ctx.every(33, () => { const now = performance.now(); this.frame((now - last) / 1000); last = now; });
    } else this.stopLoop = this.ctx.raf((dt) => this.frame(dt));
  }

  wake() {
    if (!this.dormant) return;
    this.dormant = false;
    this.listenPointer();
    this.startLoop();
  }

  destroy() {
    this.save();
    if (this.arena) this.arena.destroy();
    this.hit?.destroy();
    for (const b of this.bubbles.values()) b.close?.();
  }

  // Temporary apps (a Binny called in to clean up) are never saved. During an exhibition the
  // roster saved is the one from before the fight.
  save() {
    this.stats.apps = this.rosterLock ? this.rosterLock.slice() : this.apps.filter((a) => !a.dead && !a.temp).map((a) => a.kind);
    this.ctx.shared.set('stats', this.stats);
  }

  resize() {
    this.size = this.ctx.desktop.size();
    this.worldRef = { platforms: this.platforms, w: this.size.w };
  }

  fitCanvas() {
    const { w, h } = this.size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    for (const [layer, canvas] of [[this.layer, this.canvas], [this.layerFront, this.canvasFront]]) {
      if (!layer) continue;
      layer.style.width = w + 'px';
      layer.style.height = h + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
  }

  refreshWidgets() {
    try { this.widgetRects = this.ctx.desktop.widgets().filter((w) => !w.expanded); } catch { this.widgetRects = []; }
    const s = this.ctx.desktop.size();
    if (s.w !== this.size.w || s.h !== this.size.h) { this.resize(); this.fitCanvas(); }
  }

  nestRect() {
    const me = this.widgetRects.find((w) => w.id === this.ctx.id);
    return me ? me.rect : null;
  }

  rebuildPlatforms() {
    const P = [];
    const { w, h } = this.size;
    this.floor = { x1: 0, x2: w, y: h - 2, key: 'floor', kind: 'floor' };
    P.push(this.floor);
    // the bottom edges of holes in the sheet: seats for whoever is in front of it
    for (const t of this.sheet?.tears || []) {
      if (t.ledge?.w > 24) P.push({ x1: t.ledge.x + 4, x2: t.ledge.x + t.ledge.w - 4, y: t.ledge.y, key: 't:' + t.id, kind: 'ledge' });
    }
    const front = this.stick?.layer === 'front';
    for (const wd of front ? [] : this.widgetRects) {   // in front of the sheet the widgets behind it are out of reach
      const r = wd.rect;
      if (r.w < 30 || r.y < 110 * (this.settings.scale || 1)) continue; // no room to stand above it
      P.push({ x1: r.x + 4, x2: r.x + r.w - 4, y: r.y, key: 'w:' + wd.id, kind: 'widget', mine: wd.id === this.ctx.id });
    }
    for (const o of this.objects) {
      if (o.kind === 'file' && o.solid) {
        P.push({ x1: o.body.x - 22, x2: o.body.x + 22, y: o.body.y - 24, key: 'o:' + o.id, kind: 'file' });
      } else if (o.body && !o.heldBy && o.body.sleep > 0.6 && (o.kind === 'textblock' || (o.kind === 'drawn' && o.closed))) {
        const bb = o.body.aabb();
        if (bb.x2 - bb.x1 > 36) P.push({ x1: bb.x1 + 4, x2: bb.x2 - 4, y: bb.y1, key: 'o:' + o.id, kind: 'object' });
      }
    }
    // apps can be stood on (he rides them), but apps don't stand on each other
    this.appPlatforms = P.slice();
    for (const a of this.apps) {
      if (a.mode !== 'ground' || !a.alive) continue;
      P.push({ x1: a.x - 18, x2: a.x + 18, y: a.y - 14 - 44, key: 'a:' + a.id, kind: 'app' });
    }
    this.platforms = P;
    this.worldRef = { platforms: P, w };
    this.platMap.clear();
    for (const p of P) this.platMap.set(p.key, p);
  }

  platformByKey(k) { return this.platMap.get(k) || null; }
  ledgePlatforms() { return this.platforms.filter((p) => p.kind === 'ledge'); }

  // ---------------------------------------------------------------- layers & tears
  setStickLayer(layer) {
    const s = this.stick;
    if (s.layer === layer) return;
    s.layer = layer;
    this.frontSince = layer === 'front' ? performance.now() : 0;
    this.hit.map.get(s)?.setLayer?.(layer);           // his hitbox, and so his speech bubbles, follow him
    this.rebuildPlatforms();
    if (layer === 'back' && s.plat?.kind === 'ledge') { s.mode = 'air'; s.vy = 0; }
    this.lastSig = null;
  }
  // A fight while a widget is full screen happens in front of it: everything is painted on the
  // front canvas, and he and the apps (their bubbles) move to the front layer until it ends.
  setFightFront(on) {
    if (!!this.fightFront === on) return;
    this.fightFront = on;
    this.arena?.el.classList.toggle('ds-sheet', on);   // HUD steps down below the host's exit-full-screen pill
    this.hit.setLayer(on ? 'front' : 'back');
    this.setStickLayer(on ? 'front' : 'back');
    const clear = (cv, gx) => { gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, cv.width, cv.height); };
    clear(on ? this.canvas : this.canvasFront, on ? this.gx : this.gxFront);
    this.frontDirty = !on;
    this.lastSig = null;
  }

  canTear() {
    const sheet = this.sheet, s = this.stick;
    const pref = this.settings.tear || 'sometimes';
    if (!sheet || !sheet.tearable || pref === 'never' || this.mode !== 'chill' || s.layer !== 'back') return false;
    if (sheet.tears.length >= (sheet.maxTears || 3) || performance.now() - (this.lastSealed || 0) < 120000) return false;
    return pref !== 'stuck' || this.sheetAge() > 90;
  }
  tearWeight(mis) {
    if (!this.canTear()) return 0;
    const pref = { stuck: 6, sometimes: 3, often: 8 }[this.settings.tear || 'sometimes'] || 3;
    return pref * mis + (this.sheetAge() > 90 ? 6 : 0);
  }
  sheetAge() { return this.sheet ? (performance.now() - this.sheetSince) / 1000 : 0; }
  frontTime() { return this.frontSince ? (performance.now() - this.frontSince) / 1000 : 0; }
  // Paper scraps fall out of a fresh hole; each is an "orphan" ticket fsck can collect.
  dropScraps(x, y, tearId) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const sx = clamp(x + (Math.random() - 0.5) * 140, 10, this.w - 10);
      const r = this.ctx.desktop.tickets.file({ kind: 'orphan', x: sx, y: this.h - 4, label: 'paper scrap', layer: 'front', ttl: 240000 });
      this.scraps.push({ id: r.id || null, x: sx, y: this.h - 4, a: Math.random() * Math.PI, s: 6 + Math.random() * 5, tear: tearId });
    }
    this.lastSig = null;
  }
  onTicket(type, t) {
    if (t.kind === 'tear') {
      this.sheet = this.ctx.desktop.sheet?.() || this.sheet;
      this.rebuildPlatforms();
      if ((type === 'resolve' || type === 'expire') && this.myTears.delete(t.id)) {
        this.lastSealed = performance.now();
        if (type === 'resolve' && t.by !== this.ctx.id && Math.random() < 0.6) this.say(this.stick, pick(['Aww, my door!', 'Hey, I was using that!', 'Fine, fsck. FINE.']));
      }
      // window shoppers: an app behind the panel comments on a fresh hole
      if (type === 'open') {
        const app = pick(this.apps.filter((a) => a.alive));
        if (app && Math.random() < 0.7) this.after(1600, () => this.say(app, pick(['Someone opened a new tab in the WALL.', '$ ls ./hole → nothing. Classic.', 'Is that… daylight?', 'fsck is going to be so mad.'])));
      }
    }
    this.cleanup.onTicket(type, t);
    if (t.kind === 'orphan' && (type === 'resolve' || type === 'expire')) {
      const before = this.scraps.length;
      this.scraps = this.scraps.filter((s) => s.id !== t.id);
      if (this.scraps.length !== before) this.lastSig = null;
    }
    this.wake();
  }
  drawScraps(gx) {
    for (const p of this.scraps) {
      gx.save();
      gx.translate(p.x, p.y);
      gx.rotate(p.a);
      gx.fillStyle = 'rgba(240,236,228,0.95)';
      gx.strokeStyle = 'rgba(0,0,0,0.25)';
      gx.beginPath(); gx.moveTo(-p.s, 0); gx.lineTo(p.s * 0.6, -p.s * 0.5); gx.lineTo(p.s, p.s * 0.4); gx.closePath();
      gx.fill(); gx.stroke();
      gx.restore();
    }
  }
  widgetPlatforms() { return this.platforms.filter((p) => p.kind === 'widget' && p.x2 - p.x1 > 40); }
  platformUnderPoint(x, y) { return platformUnder(this.platforms, clamp(x, 1, this.w - 1), y, 0) || this.floor; }

  // ---------------------------------------------------------------- helpers used by actors
  after(ms, fn) {
    this.timers.push({ t: ms / 1000, fn });
  }

  sfx(name) { this.sound.play(name); }

  say(entity, text, opts = {}) {
    if (!text) return;
    if (!this.settings.talk && !opts.force && entity === this.stick && this.mode !== 'fight') return;
    const el = this.hit?.anchorFor(entity);
    const prev = this.bubbles.get(entity);
    try { prev?.close(); } catch { /* bubble already gone */ }
    const duration = opts.duration || clamp(1800 + text.length * 55, 2200, 6000);
    entity.sayUntil = performance.now() + duration;   // its hitbox (the bubble's anchor) keeps up meanwhile
    try {
      const b = this.ctx.say(text, { anchor: el || { x: entity.center.x, y: entity.center.y - 40 }, duration });
      this.bubbles.set(entity, b);
    } catch { /* host without bubbles */ }
    if (entity.saying !== undefined || entity instanceof AppActor) entity.saying = 0.6;
    this.sfx('blip');
  }

  addObject(o) {
    this.objects.push(o);
    // keep the world from filling up: fade out the oldest drawings
    const drawn = this.objects.filter((x) => x.kind === 'drawn' && !x.heldBy && x.life === Infinity);
    if (drawn.length > 24) drawn[0].life = 1;
    return o;
  }

  addXp(n) {
    const S = this.stats;
    S.xp += n;
    const need = 40 + S.level * 30;
    if (S.xp >= need) {
      S.xp -= need;
      S.level++;
      const h = this.stick.head;
      this.ctx.particles.burst({ x: h.x, y: h.y, preset: 'confetti', count: 40 });
      this.say(this.stick, `Level ${S.level}! ${S.level === 2 ? 'I learned to draw weapons and possess apps.' : S.level === 3 ? 'Fire weapons and fake errors unlocked.' : S.level === 4 ? 'Double energy blast!' : 'I feel stronger.'}`, { force: true });
      this.save();
    }
  }

  bond(kind, n) {
    this.stats.bonds[kind] = clamp((this.stats.bonds[kind] || 0) + n, -100, 100);
  }

  timeWarp(scale, secs) { this.timeScale = scale; this.warpT = secs; }

  // ---------------------------------------------------------------- apps & files
  pickAppKind(kind) {
    const present = new Set(this.apps.map((a) => a.kind));
    const real = (this.hostApps || []).map((a) => ({ a, k: archetypeFor(a) })).filter((x) => x.k);
    if (kind) {
      const r = real.find((x) => x.k === kind);
      return { kind, info: r ? { name: r.a.name, iconUrl: r.a.iconUrl } : {} };
    }
    const fresh = real.filter((x) => !present.has(x.k));
    if (fresh.length && chance(0.75)) {
      const r = pick(fresh);
      return { kind: r.k, info: { name: r.a.name, iconUrl: r.a.iconUrl } };
    }
    const k = pick(ARCHETYPES.filter((a) => !present.has(a))) || pick(ARCHETYPES);
    return this.pickAppKind(k);
  }

  // opts.temp: a short visit (cleanup Binny) that neither counts against the cap nor gets saved.
  // opts.noRetire: put a saved roster back without pushing anyone out.
  summonApp(kind = null, x = null, y = null, quiet = false, opts = {}) {
    this.wake();
    if (!opts.temp && !opts.noRetire && this.apps.filter((a) => !a.temp).length >= this.maxApps + (this.mode === 'fight' ? 2 : 0)) {
      // retire the oldest so the newcomer has room
      const old = this.apps.find((a) => a.possessed <= 0 && !a.temp);
      if (old) this.removeApp(old);
    }
    const pk = this.pickAppKind(kind);
    x = x ?? rand(80, this.w - 80);
    const top = Math.max(10, (y ?? this.h) - 260);
    const app = new AppActor(this, pk.kind, x, top, pk.info);
    app.vy = 200;
    app.temp = !!opts.temp;
    if (this.mode === 'fight' && this.exhibition) app.exhibit = true;   // goes home after the exhibition
    this.apps.push(app);
    if (!quiet) {
      this.fx.bolt(x + rand(-30, 30), 0, x, (y ?? this.h) - 10);
      this.sfx('zap');
      this.after(700, () => app.say(pick([`I'm alive?!`, `${app.name} reporting for duty!`, `Whoa, I have LEGS!`, `Hi! I'm ${app.L.nick}, ${app.L.title}.`])));
    }
    return app;
  }

  removeApp(app) {
    app.dead = true;
    const c = app.center;
    this.fx.burst(c.x, c.y, { count: 12, color: ['#fff', '#bde0fe'], speed: 160, life: 0.6, size: 3, gravity: 0 });
    this.apps = this.apps.filter((a) => a !== app);
  }

  restoreApps() {
    if (!this.settings.apps) return;
    const kinds = (this.stats.apps || []).slice(0, this.maxApps);
    if (!kinds.length) {
      this.after(rand(15000, 30000), () => { if (!this.apps.length && this.settings.apps) this.summonApp(null, null, null); });
      return;
    }
    kinds.forEach((k, i) => this.after(800 + i * 500, () => this.summonApp(k, rand(80, this.w - 80), null, true)));
  }

  nextFileItem() {
    const items = this.hostFiles && this.hostFiles.length ? this.hostFiles : FAKE_FILES;
    const present = new Set(this.objects.filter((o) => o.kind === 'file').map((o) => o.item.name));
    return items.find((i) => !present.has(i.name)) || null;
  }

  spawnFileCopy(x, plat) {
    const item = this.nextFileItem();
    if (!item) return null;
    const s = this.stick;
    plat = plat || platformUnder(this.platforms, s.x, s.y, 3) || this.floor;
    x = x ?? clamp(s.x + s.dir * rand(50, 110), plat.x1 + 26, plat.x2 - 26);
    const f = new FileCopy(item, x, plat.y - 24);
    if (this.mode !== 'fight') f.life = 90;
    this.addObject(f);
    this.fx.flash(0.12, '#dff');
    this.fx.burst(x, plat.y - 24, { count: 12, color: ['#bde0fe', '#ffffff'], speed: 140, life: 0.6, size: 3, gravity: 0 });
    return f;
  }

  // ---------------------------------------------------------------- user-facing actions
  feed() {
    this.wake();
    const s = this.stick;
    const x = clamp(s.x + rand(-140, 140), 30, this.w - 30);
    this.addObject(new Cookie(x, Math.max(10, s.y - 300)));
    this.sfx('pop');
  }

  ball() {
    this.wake();
    const s = this.stick;
    this.addObject(new Ball(clamp(s.x + rand(-160, 160), 30, this.w - 30), Math.max(10, s.y - 300), { vx: rand(-100, 100) }));
  }

  callHome() {
    this.wake();
    const pl = this.platforms.find((p) => p.mine);
    if (!pl) return;
    this.brain.act = null;
    this.stick.walkTo((pl.x1 + pl.x2) / 2, pl, true);
    this.say(this.stick, 'Coming home!');
  }

  pet() {
    this.wake();
    this.brain.onPet();
  }

  // opts.autopilot: the autopilot plays your side (an exhibition: no wins, losses or XP).
  // opts.level: fight at another level for testing (his stats keep their real level).
  startFight(opts = {}) {
    this.wake();
    if (this.mode !== 'chill') return; // also not while the last fight is still wrapping up
    this.brain.cancelChallenge();
    this.cleanup.cancel();
    this.mode = 'fight';
    if (!this.dormant) this.startLoop();
    const S = this.stats;
    this.exhibition = !!opts.autopilot || !!opts.level;
    // an exhibition leaves saved state alone: freeze the saved roster and put it back afterwards
    this.rosterLock = this.exhibition ? this.apps.filter((a) => !a.dead && !a.temp).map((a) => a.kind) : null;
    if (!this.exhibition) S.fights++;
    this.fightLevel = opts.level ? clamp(Math.round(+opts.level) || 1, 1, 9) : null;
    this.power = power(this.level);
    // a fresh fight: no ultimate charge, no cooldowns or threats left over from the last one
    Object.assign(this.brain, { ult: 0, beam: null, storm: false, threat: null, lastPtr: null, cursorVel: null, levT: 0,
      blastCd: 3, possessCd: 12, popupCd: 8, drawCd: 4, dodgeCd: 0, poundCd: this.t, teleCd: this.t, copyCd: this.t, levCd: this.t });
    this.report = { level: this.level, autopilot: !!opts.autopilot, winner: null, duration: null, dmgToStick: 0, dmgToDesk: 0, dmgBy: {}, deskBy: {}, moves: { stick: {}, player: {}, ally: {} } };
    for (const a of this.apps) a.applyTier(tierOf(a.kind, this.level));
    this.stick.maxHp = this.power.hp;
    this.stick.hp = this.stick.maxHp;
    this.stick.stance = 'guard';
    this.stick.sitting = false;
    this.stick.cancelAction();
    this.brain.act = null;
    if (this.stick.action?.name === 'sleep') this.stick.cancelAction();
    this.deskHp = 100;
    this.ink = this.maxInk;
    this.fightT = 0;
    this.hit.setInteractive(false);
    this.arena = new Arena(this, { autopilot: !!opts.autopilot });
    if (this.sheet) this.setFightFront(true);
    this.ctx.host.focus?.().catch(() => {});
    // the "snapshot": copies of desktop files appear so they can be smashed safely
    this.fx.flash(0.6, '#ffffff');
    this.sfx('crack');
    if (this.settings.files) {
      const pls = [this.floor, ...this.widgetPlatforms()];
      for (let i = 0; i < 6; i++) {
        const pl = i < 3 ? this.floor : pick(pls);
        const f = this.spawnFileCopy(rand(pl.x1 + 40, pl.x2 - 40), pl);
        if (!f) break;
      }
    }
    const allies = this.apps.filter((a) => a.alive).length;
    if (!opts.noAllies) for (let i = allies; i < 2; i++) this.after(600 + i * 700, () => this.mode === 'fight' && this.summonApp(null, rand(100, this.w - 100)));
    this.say(this.stick, line('fightStart'), { force: true });
  }

  endFight(winner) {
    if (this.mode !== 'fight') return;
    const S = this.stats;
    const s = this.stick;
    this.mode = 'ending';
    this.arena?.auto?.stop();   // nothing held or half-drawn during the result screen
    const r = this.report;
    if (r) Object.assign(r, { winner, duration: this.fightT, stickEnd: Math.max(0, s.hp), deskEnd: this.deskHp, leftAtEnd: this.leftovers(true).length });
    const ex = this.exhibition;
    if (winner === 'user') {
      if (!ex) { S.wins++; this.addXp(30); }
      s.hp = 0;
      s.knock(s.dir * -200, -500);
      s.st.stun = 3;
      this.sfx('win');
      this.ctx.particles.burst({ preset: 'confetti', x: this.w / 2, y: this.h / 3, count: 120 });
      this.after(1200, () => this.say(s, line('lose'), { force: true }));
      this.arena?.banner(ex && !this.arena.tookOver ? 'AUTOPILOT WINS' : 'YOU WIN', ex ? `${this.settings.name} gives up. Exhibition fight: not counted.` : `${this.settings.name} gives up. Wins: ${S.wins} · Losses: ${S.losses}`);
    } else if (winner === 'stick') {
      if (!ex) { S.losses++; this.addXp(20); }
      this.sfx('lose');
      s.cancelAction();
      s.play('cheer', 2.5);
      this.say(s, line('win'), { force: true });
      this.arena?.crash();
    } else {
      s.stance = null;
      this.say(s, pick(['Truce? Truce.', 'Fine, we\'ll finish this later.', 'Running away? Okay.']), { force: true });
    }
    if (!ex) {
      S.anger = 0;
      S.fun = clamp(S.fun + 30, 0, 100);
      this.save();
    }
    this.after(winner === 'truce' ? 300 : 4200, () => this.cleanupFight());
  }

  cleanupFight() {
    if (this.mode !== 'ending') return;   // Esc may have skipped the result screen already
    this.mode = 'chill';
    if (!this.dormant) this.startLoop();
    this.stick.stance = null;
    this.stick.aura = null;
    this.stick.alpha = 1;
    this.stick.hp = this.stick.maxHp;
    this.arena?.cancelInput();   // let go of him / drop a half-drawn stroke before the leftover snapshot
    this.stick.dropWeapon();
    this.brain.beam = null;
    this.sketches = [];
    this.timeScale = 1;
    this.fightLevel = null;
    this.power = power(this.stats.level);
    for (const a of this.apps) { a.applyTier(tierOf(a.kind, this.level)); a.scan = null; a.dashChain = 0; a.stormT = 0; }
    if (this.exhibition) this.endExhibition();
    // leftovers and up to 5 cracks become tickets: Binny (or fsck) cleans them up
    const keep = this.cleanup.start();
    this.restoreDesktop(true, keep);
    for (const a of this.apps) { a.possessed = 0; a.st.dance = 0; if (a.down > 0) a.down = 0.5; }
    this.objects = this.objects.filter((o) => o.kind !== 'popup');
    for (const o of this.objects) if (o.kind === 'file') o.life = 20;
    this.arena?.destroy();
    this.arena = null;
    this.setFightFront(false);
    this.hit.setInteractive(true);
    this.pointer = this.ctx.pointer?.() || this.pointer;
  }

  // After an exhibition, allies summoned for it go home and apps it retired come back.
  endExhibition() {
    const roster = this.rosterLock || [];
    this.rosterLock = null;
    this.exhibition = false;
    for (const a of this.apps.slice()) if (a.exhibit && !a.temp) this.removeApp(a);
    this.restoreRoster(roster);
  }

  // Make the live apps match a saved list of kinds (summoning the missing ones quietly).
  restoreRoster(kinds) {
    const want = kinds.slice();
    for (const a of this.apps.slice()) {
      if (a.temp) continue;
      const i = want.indexOf(a.kind);
      if (i >= 0) want.splice(i, 1); else this.removeApp(a);
    }
    for (const k of want) this.summonApp(k, rand(80, this.w - 80), null, true, { noRetire: true });
    this.save();
  }

  restoreDesktop(all = false, keepCracks = null) {
    this.fx.healCracks(keepCracks);
    this.deskHp = Math.min(100, this.deskHp + (all ? 100 : 15));
    for (const o of this.objects) if (o.kind === 'file' && o.broken) o.restore(this);
    if (all) this.projectiles = [];
  }

  // ---------------------------------------------------------------- combat rules
  cursorTarget() { return { x: this.pointer.x, y: this.pointer.y }; }

  hitCursor(dmg, x, y, melee = false, by = 'hit') {
    if (this.mode !== 'fight') return;
    const near = dist(this.pointer.x, this.pointer.y, x, y) < (melee ? 50 : 34);
    this.fx.crack(x, y, clamp(dmg / 10, 0.4, 1.6));
    this.fx.shake(near ? 9 : 4);
    this.sfx('crack');
    if (near) {
      this.hitDesk(dmg, x, y, true, by);
      this.fx.flash(0.25, '#ff2a2a');
    }
  }

  hitDesk(dmg, x, y, already = false, by = 'hit') {
    if (this.mode !== 'fight') return;
    dmg *= this.pace();
    this.deskHp = Math.max(this.koFloor(), this.deskHp - dmg);
    const r = this.report;
    if (r) { r.dmgToDesk += dmg; r.deskBy[by] = (r.deskBy[by] || 0) + dmg; }
    this.brain.onDealt?.(dmg);
    if (!already) { this.fx.crack(x, y, clamp(dmg / 10, 0.4, 1.4)); this.fx.shake(5); }
    this.fx.popText(x, y - 20, `-${Math.round(dmg)}`, '#ff6b6b', 16);
    if (this.deskHp < 40) this.fx.glitch(0.25);
    if (this.deskHp <= 0) this.endFight('stick');
  }

  // Pacing, so a fight is never over in seconds: he warms up over the first 45 s, and a desk
  // on its last legs (under 35) gets a comeback window where his hits land softer.
  // After 100 s it's overtime: both sides hit harder (×2 by 130 s) and the comeback windows close.
  pace() {
    const ramp = Math.min(1, 0.45 + this.fightT / 80);
    return ramp * (this.overtime() > 1 ? this.overtime() : this.deskHp < 35 ? this.comeback() : 1);
  }
  // The same for him: a soft opening, and a comeback window when he's under 30% hp.
  paceIn() {
    const ramp = Math.min(1, 0.45 + this.fightT / 80);
    return ramp * (this.overtime() > 1 ? this.overtime() : this.stick.hp < this.stick.maxHp * 0.3 ? this.comeback() : 1);
  }
  comeback() { return this.fightT < 60 ? 0.5 : 0.8; }   // stronger early, so nobody is crushed in seconds
  // Safety net under the pacing: no knockout in the first 45 s of a fight (hp stops at 1).
  koFloor() { return this.mode === 'fight' && this.fightT < 45 ? 1 : 0; }
  overtime() { return this.fightT > 100 ? 1 + (this.fightT - 100) / 30 : 1; }

  healDesk(n) { this.deskHp = Math.min(100, this.deskHp + n); }

  explode(x, y, power = 1, owner = 'user') {
    const R = 150 * power;
    this.fx.ring(x, y, R, 'rgba(255,200,120,0.9)', 0.5);
    this.fx.burst(x, y, { count: 30, color: ['#ffd166', '#ff8a1f', '#ef476f', '#fff'], speed: 520, life: 0.7, size: 4, gravity: 400 });
    this.fx.burst(x, y, { count: 10, color: 'rgba(90,90,90,0.6)', type: 'dust', speed: 160, life: 1.2, size: 14, gravity: -60 });
    this.fx.shake(14 * power);
    this.fx.flash(0.35, '#fff3d6');
    this.fx.crack(x, y, 1.2 * power);
    this.sfx('boom');
    if (owner === 'stick' && this.mode === 'fight') {
      const dp = dist(this.pointer.x, this.pointer.y, x, y);
      if (dp < R) this.hitDesk(18 * (1 - dp / R) + 4, x, y, true, 'explosion');
    }
    const s = this.stick;
    const sc = s.center;
    const ds = dist(sc.x, sc.y, x, y);
    if (ds < R) {
      const f = 1 - ds / R;
      const a = Math.atan2(sc.y - y, sc.x - x);
      if (this.mode === 'fight' && owner !== 'stick') s.hurt(22 * f + 5, Math.cos(a) * 1400 * f, Math.sin(a) * 1400 * f - 500, { force: true, by: 'explosion' });
      else s.knock(Math.cos(a) * 1200 * f, Math.sin(a) * 1200 * f - 400);
    }
    for (const o of this.objects) {
      if (!o.body || o.heldBy) continue;
      const d = dist(o.body.x, o.body.y, x, y);
      if (d > R) continue;
      const f = 1 - d / R;
      const a = Math.atan2(o.body.y - y, o.body.x - x);
      if (o.kind === 'file') { o.knock(Math.cos(a) * 900 * f, Math.sin(a) * 900 * f - 300); o.damage(this, f > 0.5 ? 3 : 1); }
      else o.body.push(Math.cos(a) * 900 * f * o.body.m, (Math.sin(a) * 900 * f - 300) * o.body.m, o.body.x + rand(-5, 5), o.body.y);
    }
    for (const app of this.apps) {
      const c = app.center;
      const d = dist(c.x, c.y, x, y);
      if (d > R) continue;
      const f = 1 - d / R;
      const a = Math.atan2(c.y - y, c.x - x);
      const friendly = owner === 'user' && app.possessed <= 0;
      app.hurt((friendly ? 6 : 25) * f, Math.cos(a) * 900 * f, Math.sin(a) * 900 * f - 300);
    }
  }

  onStickHurt(dmg, src = {}) {
    if (this.mode === 'fight') {
      const r = this.report;
      if (r) {
        r.dmgToStick += dmg;
        const by = src.app ? 'ally ' + src.app.kind : src.obj ? (typeof src.obj.item === 'string' ? src.obj.item : src.obj.kind) : src.by || 'other';
        r.dmgBy[by] = (r.dmgBy[by] || 0) + dmg;
      }
      this.brain.onTaken?.(dmg);
      if (this.stick.hp <= 0) this.endFight('user');
      else if (chance(0.3)) this.brain.say(line('hurt'));
    }
  }

  onRagImpact(dv) {
    const s = this.stick;
    this.fx.dust(s.x, s.y, 6);
    if (dv > 1400) this.fx.shake(4);
    if (this.mode === 'fight') s.hurt(clamp(dv / 110, 3, 22), 0, 0, { invuln: 0.35, by: 'impact' });
    else if (dv > 1500) { s.st.dizzy = 2; this.stats.anger = clamp(this.stats.anger + 4, 0, 100); }
  }

  onLand(vy) { this.brain.onLanded(vy > 1300); }

  combat(dt) {
    const s = this.stick;
    const fighting = this.mode === 'fight';
    // moving objects vs the stickman
    for (const o of this.objects) {
      if (!o.body || o.dead || o.heldBy === s || o.hitCd > 0 || o.noContact || o.spent) continue;
      // his own drawings, weapons and leftovers never hurt him (one you grab or deflect becomes yours)
      if (o.owner === 'stick' && !o.thrownAt) continue;
      if (this.t - (o.kickedAt ?? -9) < 2.5) continue;   // a file copy he just kicked can't fly back into him
      if (o.thrownAt) { o.thrownAt.t -= dt; if (o.thrownAt.t <= 0) o.thrownAt = null; }
      const b = o.body;
      const v = b.speed();
      if (o.thrownAt?.by === 'stick') {
        // his throws aim at your cursor and your apps
        if (fighting && dist(b.x, b.y, this.pointer.x, this.pointer.y) < 36 + (b.radius || 0) * 0.5) {
          o.hitCd = 0.5;
          this.hitCursor((o.kind === 'file' ? 10 : 8) * this.power.dmg, this.pointer.x, this.pointer.y, true, 'throw');
          if (o.kind === 'file') o.shatter(this);
          o.thrownAt = null;
          b.vx *= -0.3; b.vy = -200;
          continue;
        }
        for (const a of this.apps) {
          if (!a.alive || a.possessed > 0) continue;
          if (a.contains(b.x, b.y)) { a.hurt(8, b.vx * 0.5, b.vy * 0.5 - 200); o.hitCd = 0.5; o.thrownAt = null; break; }
        }
        if (o.kind === 'file' && b.ground && o.thrownAt === null) o.damage(this, 3);
        continue;
      }
      if (v < (o.kind === 'textblock' ? 120 : 330) || s.st.devoured > 0) continue;
      const sd = s.distTo(b.x, b.y);
      let hitD = sd;
      if (o.kind === 'drawn' || o.kind === 'textblock' || o.kind === 'popup') {
        hitD = Infinity;
        for (const p of b.worldPts()) hitD = Math.min(hitD, s.distTo(p.x, p.y));
      } else hitD = sd - (b.radius || 10);
      if (hitD > 10) continue;
      o.hitCd = 0.45;
      const mass = clamp(b.m / 6, 0.5, 3);
      let dmg = fighting ? clamp((v / 90) * mass * (o.dmgMul || 1), 4, 18) : 0;
      if (o.kind === 'textblock') dmg = Math.min(dmg, 7 * (o.dmgMul || 1));
      if (o.app) { dmg = o.hitDmg; o.spent = true; }   // an app's command block: hits once, credited to the app
      const kx = b.vx * 0.7, ky = b.vy * 0.5 - 250;
      if (fighting) s.hurt(dmg, kx, ky, o.app ? { obj: o, app: o.app } : { obj: o });
      else if (v > 600) { s.knock(kx, ky); this.stats.anger = clamp(this.stats.anger + 6, 0, 100); }
      if (o.kind === 'drawn') {
        if (o.material === 'fire') { s.st.burn = 3; s.burnBy = null; this.fx.embers(b.x, b.y, 12); if (fighting) s.hurt(4, 0, 0, { invuln: 0, by: 'fire' }); }
        if (o.material === 'ice') { s.st.frozen = 1.6; this.fx.frost(b.x, b.y, 14); }
        if (o.material === 'bouncy') { b.vx *= -0.8; b.vy = -Math.abs(b.vy) * 0.8; }
      }
      if (o.kind === 'textblock') this.fx.dust(b.x, b.y, 6);
    }

    // burning damage
    if (fighting && s.st.burn > 0) {
      s.hp = Math.max(this.koFloor(), s.hp - dt * 2.5);
      if (this.report) {
        const by = s.burnBy ? 'ally ' + s.burnBy.kind : 'burn';   // Tab Storm's fire counts as Foxy's
        this.report.dmgToStick += dt * 2.5;
        this.report.dmgBy[by] = (this.report.dmgBy[by] || 0) + dt * 2.5;
      }
    }
    if (fighting && s.hp <= 0 && this.mode === 'fight') this.endFight('user');

    // projectiles
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.owner === 'stick') {
        if (dist(p.x, p.y, this.pointer.x, this.pointer.y) < 24 + p.r) {
          p.dead = true;
          this.hitCursor(p.dmg, p.x, p.y, true, p.type);
          this.fx.sparks(p.x, p.y, '#ff8a1f', 14);
          continue;
        }
        for (const a of this.apps) {
          if (a.alive && a.possessed <= 0 && a.contains(p.x, p.y)) { p.dead = true; a.hurt(p.dmg, p.vx * 0.5, p.vy * 0.5); break; }
        }
        if (!p.dead && p.aim && (dist(p.x, p.y, p.aim.x, p.aim.y) < 16 || p.life < 0.05)) {
          // the shot hits the "screen" where you were
          p.dead = true;
          this.fx.sparks(p.x, p.y, '#ff8a1f', 12);
          this.hitCursor(p.dmg * 0.5, p.x, p.y, false, p.type);
        }
      } else if (s.st.devoured <= 0 && s.distTo(p.x, p.y) < p.r) {
        p.dead = true;
        s.hurt(p.dmg, p.vx * 0.4, p.vy * 0.4 - 150, p.src || { by: p.type });
      }
    }
  }

  onMessage(data) {
    this.wake();
    if (!data || typeof data !== 'object') return;
    if (data.cmd === 'fight') this.startFight({ autopilot: !!data.autopilot, level: data.level });
    else if (data.cmd === 'feed') this.feed();
    else if (data.cmd === 'summon') this.summonApp(data.kind || null);
    else if (data.cmd === 'trick' && this.mode === 'chill' && this.stick.onGround) {
      // e.g. widgetctl send desksprite '{"cmd":"trick","name":"skate"}'
      const fn = this.brain['act' + String(data.name || '').replace(/^./, (c) => c.toUpperCase())];
      if (typeof fn === 'function') { this.brain.act?.end?.(); this.brain.act = null; this.stick.cancelAction(); fn.call(this.brain); }
    }
    else if (data.cmd === 'pause') { this.paused = true; this.gx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    else if (data.cmd === 'resume') this.paused = false;
    else if (data.cmd === 'say' && data.text) this.say(this.stick, String(data.text).slice(0, 200), { force: true });
  }

  // ---------------------------------------------------------------- fight report & test helpers
  noteMove(side, name) {
    if (!this.report || this.mode !== 'fight') return;
    const m = this.report.moves[side];
    m[name] = (m[name] || 0) + 1;
  }

  // Fight leftovers: drawings, balls and text blocks that would otherwise stay on the desktop.
  leftovers(atEnd = false) {
    return this.objects.filter((o) => !o.dead && (o.cleanup || (atEnd && ['drawn', 'ball', 'textblock'].includes(o.kind) && (o.heldBy || o.life > 8))));
  }

  // window.__desksprite[id].fightReport(): stats of the current or last fight.
  fightReport() {
    const r = this.report;
    if (!r) return null;
    const r1 = (v) => Math.round(v * 10) / 10;
    const kinds = (m) => Object.keys(m).length;
    return {
      level: r.level, autopilot: r.autopilot, mode: this.mode, winner: r.winner,
      duration: r1(r.duration ?? this.fightT),
      damage: { toStick: r1(r.dmgToStick), toDesk: r1(r.dmgToDesk), bySource: Object.fromEntries(Object.entries(r.dmgBy).map(([k, v]) => [k, r1(v)])), deskBySource: Object.fromEntries(Object.entries(r.deskBy).map(([k, v]) => [k, r1(v)])) },
      end: { stickHp: Math.round(r.stickEnd ?? this.stick.hp), stickMaxHp: this.stick.maxHp, deskHp: Math.round(r.deskEnd ?? this.deskHp) },
      moves: r.moves,
      variety: { stick: kinds(r.moves.stick), player: kinds(r.moves.player), allies: kinds(r.moves.ally) },
      aboveBottom200: Math.round(((r.highT || 0) / Math.max(1, r.duration ?? this.fightT)) * 100) / 100,
      leftovers: { atEnd: r.leftAtEnd, now: this.leftovers().length, cracks: this.fx.cracks.filter((c) => !c.healing).length },
      cleanup: this.cleanup.summary(),
    };
  }

  // Test helper: run the game faster than real time, without painting. Resolves with the report.
  fastForward(secs, chunk = 900) {
    this.wake();
    return new Promise((done) => {
      let left = Math.round(secs * 60);
      const step = () => {
        this.ff = true;
        try { for (let i = Math.min(chunk, left); i > 0; i--, left--) this.frame(1 / 60); } finally { this.ff = false; }
        if (left > 0 && !this.ffStop) this.ctx.after(0, step);
        else { this.ffStop = false; this.lastSig = null; done(this.fightReport()); }
      };
      step();
    });
  }

  // Test helper: n autopilot fights at a level, each followed by 60 s of cleanup, in fast forward.
  // Results land in this.benchResults (also returned). His saved stats are restored afterwards
  // (the fast-forwarded chill time in between would otherwise feed and level him).
  async bench(level = 3, runs = 3) {
    const out = this.benchResults = [];
    const saved = JSON.parse(JSON.stringify(this.stats));
    const roster = this.apps.filter((a) => !a.dead && !a.temp).map((a) => a.kind);
    try { await this.benchRuns(level, runs, out); } finally {
      this.cleanup.cancel();
      Object.assign(this.stats, saved);
      this.restoreRoster(roster);   // also saves
      this.deskHp = 100;
    }
    return out;
  }

  async benchRuns(level, runs, out) {
    for (let i = 0; i < runs; i++) {
      if (this.mode !== 'chill') await this.fastForward(10);
      for (const a of this.apps.slice()) this.removeApp(a);   // same start every time: only the 2 starter allies
      this.startFight({ autopilot: true, level });
      for (let t = 0; t < 400 && this.mode === 'fight'; t += 5) await this.fastForward(5);
      const rep = this.fightReport();
      for (let t = 0; t < 70 && this.mode !== 'chill'; t += 1) await this.fastForward(1);
      await this.fastForward(60);
      out.push({ winner: rep.winner, duration: rep.duration, damage: rep.damage, end: rep.end, variety: rep.variety, moves: rep.moves, aboveBottom200: rep.aboveBottom200, leftoversAtEnd: rep.leftovers.atEnd, leftoversAfter60s: this.leftovers().length, cracksAfter60s: this.fx.cracks.filter((c) => !c.healing).length });
    }
  }

  // Test helper: how hard one app hits. An exhibition at `level` with the autopilot off and
  // only that app on the field, 250 px from him; desk and his hp are pinned so nobody loses.
  // He doesn't possess it (with a single app that would measure possession, not the app).
  // Resolves with the app's credited damage to him, its hp lost and how often it went down.
  async duel(kind, level = 3, secs = 40) {
    if (this.mode !== 'chill') return null;
    this.startFight({ autopilot: true, level, noAllies: true });
    this.arena.auto.stop();
    this.arena.auto = null;
    for (const a of this.apps.slice()) this.removeApp(a);
    const s = this.stick;
    const app = this.summonApp(kind, clamp(s.x + 250, 60, this.w - 60), null, true);
    let hpLost = 0, downs = 0, wasDown = false, lastHp = app.hp;
    for (let t = 0; t < secs && this.mode === 'fight'; t += 0.5) {
      this.brain.possessCd = 99;
      await this.fastForward(0.5);
      this.deskHp = 100;
      s.hp = s.maxHp;
      if (app.hp < lastHp) hpLost += lastHp - app.hp;
      lastHp = app.hp;
      if (app.down > 0 && !wasDown) downs++;
      wasDown = app.down > 0;
    }
    const dealt = this.report.dmgBy['ally ' + kind] || 0, tier = app.tier;
    this.endFight('truce');
    await this.fastForward(2);
    return { kind, tier, level, dealt: Math.round(dealt), hpLost: Math.round(hpLost), maxHp: app.maxHp, downs };
  }

  // duel() for several apps × trials; results (with medians) land in this.duelResults.
  async duels(kinds, level = 3, trials = 3) {
    const roster = this.apps.filter((a) => !a.dead && !a.temp).map((a) => a.kind);
    const saved = JSON.parse(JSON.stringify(this.stats));   // the chill time in between would feed and level him
    const out = this.duelResults = [];
    try {
      for (const k of kinds) {
        const runs = [];
        for (let i = 0; i < trials; i++) runs.push(await this.duel(k, level));
        const med = (f) => runs.map(f).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
        out.push({ kind: k, tier: runs[0]?.tier, dealt: runs.map((r) => r.dealt), median: med((r) => r.dealt), hpLost: med((r) => r.hpLost), maxHp: runs[0]?.maxHp, downs: runs.reduce((n, r) => n + r.downs, 0) });
      }
    } finally {
      Object.assign(this.stats, saved);
      this.restoreRoster(roster);   // also saves
    }
    return out;
  }

  // ---------------------------------------------------------------- loop
  frame(rawDt) {
    if (this.hidden || this.paused || this.dormant) return;
    const dt = Math.min(rawDt, 1 / 20);
    // physics runs in 1/60 s substeps, so the 30 Hz chill loop throws and ragdolls exactly like 60 Hz
    const n = Math.max(1, Math.round(dt * 60));
    for (let i = 0; i < n; i++) {
      if (this.step(dt / n)) {   // the first-fight help holds the fight: only the HUD runs
        this.hit.sync();
        if (!this.ff) this.render();
        return;
      }
    }
    this.paint(dt);
  }

  // One simulation step. Returns true while the fight is held.
  step(dt) {
    if (this.warpT > 0) { this.warpT -= dt; if (this.warpT <= 0) this.timeScale = 1; }
    const sdt = dt * this.timeScale;
    this.t += sdt;

    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const tm of due) { try { tm.fn(); } catch (e) { this.ctx.log('timer error', String(e?.stack || e)); } }

    if (this.mode === 'fight' && this.arena?.hold) {
      this.arena.update(dt);
      this.fx.update(dt);   // effects keep fading (the start flash), the fight itself waits
      return true;
    }
    this.rebuildPlatforms();
    if (this.mode === 'fight') {
      const sc = this.stick.center;
      const ranked = this.apps.filter((a) => a.alive && a.possessed <= 0)
        .sort((a, b) => dist(a.center.x, a.center.y, sc.x, sc.y) - dist(b.center.x, b.center.y, sc.x, sc.y));
      this.engaged = new Set(ranked.slice(0, 2));
    }
    this.brain.update(sdt);
    this.stick.update(sdt);
    for (const a of this.apps) { a.saying = Math.max(0, (a.saying || 0) - sdt); a.update(sdt); a.postUpdate(sdt); }
    for (const o of this.objects) {
      o.update(sdt, this);
      if (o.life !== undefined && o.life !== Infinity && o.kind === 'file' && !o.broken) {
        o.life -= sdt;
        if (o.life <= 0) { o.dead = true; this.fx.burst(o.body.x, o.body.y, { count: 8, color: '#bde0fe', speed: 100, life: 0.5, size: 3, gravity: 0 }); }
      }
    }
    for (const p of this.projectiles) p.update(sdt, this);
    this.combat(sdt);
    this.objects = this.objects.filter((o) => !o.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.apps = this.apps.filter((a) => !a.dead);
    // a sketch lives only as long as the draw action that makes it (a hit can interrupt it)
    this.sketches = this.sketches.filter((k) => !k.done && (!k.action || this.stick.action === k.action));
    this.fx.update(sdt);
    if (this.mode === 'fight') {
      if (this.fightT <= 100 && this.fightT + dt > 100) this.arena?.toast('⏱ OVERTIME: every hit counts double soon!', 2600);
      this.fightT += dt;
      // how much of the fight he spends above the bottom 200 px (DS-12)
      if (this.report && this.stick.top < this.h - 200) this.report.highT = (this.report.highT || 0) + dt;
      this.ink = Math.min(this.maxInk, this.ink + dt * 9);
    }
    this.arena?.update(dt);
    this.cleanup.update(dt);
    return false;
  }

  paint(dt) {
    // the game layer is a full-screen canvas: repaint less often when little is going on
    this.renderAcc = (this.renderAcc || 0) + dt;
    const calm = this.mode === 'chill' && !this.hit.drag && this.fx.parts.length < 20;
    if (!calm) this.hit.sync();
    // nobody at the computer for 30 s: half the repaint rate (the next pointer move restores it)
    const away = performance.now() - (this.lastMove || 0) > 30000;
    const fps = !calm ? 60 : this.stick.action?.name === 'sleep' ? 10 : (this.calmFps || CALM_FPS) / (away ? 2 : 1);
    if (this.renderAcc >= 1 / fps - 0.002 && !this.ff) {
      this.renderAcc = 0;
      // every repaint makes the host recomposite the whole transparent screen, so skip
      // frames where nothing visible moved (he's standing still, sitting, asleep…)
      const sig = calm ? this.signature() : null;
      if (!sig || sig !== this.lastSig) {
        this.lastSig = sig;
        if (calm) this.hit.sync(true);   // DOM writes ride along with a repaint, lazily
        this.render();
      }
    }
    if (this.canDoze()) this.doze();
  }

  signature() {
    const r = (v) => Math.round(v / 2); // 2px: ignore sub-pixel breathing
    const J = this.stick.J;
    let sig = J ? ['head', 'hip', 'h1', 'h2', 'f1', 'f2', 'k1', 'k2'].map((k) => r(J[k][0]) + ',' + r(J[k][1])).join(';') : 'x';
    for (const a of this.apps) {
      const c = a.center;
      sig += `|${r(c.x)},${r(c.y)},${a.goal || a.mode !== 'ground' || a.st.dance > 0 ? Math.round(a.t * 30) : 0},${a.down > 0}`;
    }
    for (const o of this.objects) {
      if (!o.body) continue;
      sig += `|${r(o.body.x)},${r(o.body.y)},${Math.round(o.body.a * 20)}`;
      if (o.material === 'fire' || o.material === 'ice' || o.kind === 'bomb') sig += Math.round(this.t * 30);
      if (o.life !== undefined && o.life < 1) sig += Math.round(o.life * 20);
    }
    // anything animated by the effects layer forces a repaint
    const fx = this.fx;
    if (fx.parts.length || fx.bolts.length || fx.beams.length || fx.rings.length || fx.texts.length || fx.shakeAmp || fx.flashA || fx.glitchT ||
        this.projectiles.length || this.sketches.length || fx.cracks.some((c) => c.healing)) sig += '|fx' + Math.round(this.t * 60);
    return sig + '|' + fx.cracks.length + '|' + this.stick.layer + this.scraps.length;
  }

  render() {
    const gx = this.fightFront ? this.gxFront : this.gx;
    const { w, h } = this.size;
    gx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    gx.clearRect(0, 0, w, h);
    const [ox, oy] = this.fx.shakeOffset();
    gx.save();
    gx.translate(ox, oy);
    this.fx.drawBack(gx);
    if (this.mode === 'fight' || this.mode === 'ending') this.arena?.drawBack(gx);
    for (const o of this.objects) if (o.kind === 'file') o.draw(gx, this);
    for (const o of this.objects) if (o.kind !== 'file' && o.kind !== 'popup') o.draw(gx, this);
    for (const a of this.apps) a.draw(gx);
    for (const k of this.sketches) {
      const n = Math.max(2, Math.ceil(k.pts.length * k.k));
      drawInk(gx, k.pts.slice(0, n), k.material);
    }
    const front = this.stick.layer === 'front' && !this.fightFront;
    if (this.fightFront) this.drawScraps(gx);
    if (!front) { this.brain.act?.draw?.(gx); this.stick.draw(gx); }
    if (this.dormant && this.stick.J && !front) {
      const [hx, hy] = this.stick.J.head;
      gx.save();
      gx.fillStyle = 'rgba(255,255,255,0.85)';
      gx.font = 'bold 11px system-ui, sans-serif'; gx.fillText('z', hx + 10, hy - 12);
      gx.font = 'bold 14px system-ui, sans-serif'; gx.fillText('z', hx + 17, hy - 24);
      gx.font = 'bold 17px system-ui, sans-serif'; gx.fillText('Z', hx + 26, hy - 39);
      gx.restore();
    }
    if (this.stick.weapon && !front) this.stick.weapon.draw(gx);
    for (const p of this.projectiles) p.draw(gx);
    this.brain.drawFx?.(gx);
    this.fx.drawFront(gx);
    for (const o of this.objects) if (o.kind === 'popup') o.draw(gx, this);
    this.arena?.drawFront(gx);
    gx.restore();
    this.fx.drawScreen(gx, w, h);
    if (!this.fightFront) this.renderFront(front, ox, oy);
  }

  // The front canvas holds him while he's in front of a sheet, plus fallen paper scraps.
  renderFront(front, ox, oy) {
    const gx = this.gxFront;
    if (!gx) return;
    const used = front || this.scraps.length > 0;
    if (!used && !this.frontDirty) return;
    const { w, h } = this.size;
    gx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    gx.clearRect(0, 0, w, h);
    this.frontDirty = used;
    if (!used) return;
    gx.save();
    gx.translate(ox, oy);
    this.drawScraps(gx);
    if (front) {
      this.brain.act?.draw?.(gx);
      this.stick.draw(gx);
      if (this.stick.weapon) this.stick.weapon.draw(gx);
    }
    gx.restore();
  }
}

export { Projectile, TAU };
