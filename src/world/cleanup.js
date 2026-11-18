// After a fight: Binny (the trash bin) walks to every leftover and eats it. If Binny isn't
// around, one is called in for the job and leaves afterwards. Every leftover is also an
// "orphan" ticket, so fsck (WidgetSystem's repair daemon) may collect it instead: whoever
// claims it first takes it. Up to 5 cracks stay on screen as "crack" tickets for fsck.
// Leftovers are only drawings on the game layer; nothing real is ever deleted.
import { ITEMS } from './sketch.js';
import { clamp, pick, dist } from '../util.js';

const KINDS = ['drawn', 'ball', 'textblock'];
const DEADLINE = 48;      // seconds: after this Binny vacuums whatever is left
const STUCK = 5;          // seconds without getting closer before Binny uses the long-range suction
const MAX_CRACKS = 5;
const MAX_TICKETS = 10;   // beyond this Binny still eats them, just without a ticket (keeps fsck's log sane)

const LINES = {
  arrive: ['Cleaning service! Leave the mess to me.', 'Who made this mess? …Don\'t answer.', 'Ooh, leftovers!', 'Did someone order a cleanup?'],
  eat: ['Nom. Recycled.', 'Crunchy ink!', 'Tastes like victory.', 'Mmm, fresh doodle.', 'One more for the bin!', '*munch munch*'],
  beaten: ['Hey fsck, that was MY snack!', 'fsck got there first. Show-off.', 'Fine, fsck, you take that one.'],
  suck: ['Long-range suction!', 'Come to Binny…', 'Too high? Not for my vacuum.'],
  done: ['All clean! ✨', 'Spotless. You\'re welcome.', '*burp* Desktop tidy.'],
  leave: ['Call me if you need me!', 'Off to the recycle bin.', 'My work here is done.'],
};

export class Cleanup {
  constructor(game) {
    this.g = game;
    this.jobs = [];          // {o, id, other, label}
    this.cracks = new Map(); // ticket id -> crack id
    this.binny = null;
    this.temp = false;       // Binny was called in just for this and leaves afterwards
    this.active = false;
    this.t = 0;
    this.stats = null;
  }

  get T() { return this.g.ctx.desktop.tickets; }

  // Returns the crack ids to keep on screen (the rest heal right away).
  start() {
    const g = this.g;
    this.cancel();
    this.t = 0;
    this.stats = { leftovers: 0, binny: 0, fsck: 0, fsckCracks: 0, sucked: 0, cracks: 0, done: null };
    this.suckSaid = false;
    for (const o of g.objects) {
      if (o.dead || !KINDS.includes(o.kind) || o.heldBy || o.life <= 8 || (o.body.static && o.life !== Infinity)) continue;
      // freeze it as a plain physical object: no more homing, it falls and stays put
      o.life = Infinity;
      o.ai = null;
      o.extraDraw = null;
      o.thrownAt = null;
      o.body.static = false;
      o.body.gravityScale = 1;
      const label = this.label(o);
      const r = this.jobs.length < MAX_TICKETS ? this.file({ kind: 'orphan', x: o.body.x, y: o.body.y, label, layer: 'back', ttl: 90000 }) : null;
      const job = { o, id: r?.id || null, other: null, label, x: o.body.x, y: o.body.y };
      o.cleanup = job;
      this.jobs.push(job);
    }
    this.stats.leftovers = this.jobs.length;

    const keep = new Set();
    const big = g.fx.cracks.filter((c) => !c.healing).sort((a, b) => b.R - a.R).slice(0, MAX_CRACKS);
    for (const c of big) {
      const r = this.file({ kind: 'crack', x: c.x, y: c.y, r: clamp(c.R * 0.4, 18, 60), label: 'screen crack', layer: 'back', ttl: 55000 });
      if (!r?.id) continue;
      keep.add(c.id);
      c.ticket = r.id;   // waits for its ticket, never faded by the crack cap
      this.cracks.set(r.id, c.id);
    }
    this.stats.cracks = keep.size;
    this.active = this.jobs.length > 0 || this.cracks.size > 0;
    if (this.jobs.length) g.after(1800, () => this.callBinny());
    return keep;
  }

  file(spec) {
    try { const r = this.T.file(spec); return r && !r.rejected ? r : null; } catch { return null; }
  }

  label(o) {
    if (o.kind === 'ball') return 'ball';
    if (o.kind === 'textblock') return `"${o.text.slice(0, 24)}" block`;
    if (o.item && ITEMS[o.item]) return `${ITEMS[o.item].name.toLowerCase()} drawing`;
    return o.owner === 'stick' ? 'stickman doodle' : 'ink drawing';
  }

  callBinny() {
    const g = this.g;
    if (!this.active || g.mode !== 'chill' || !this.jobs.length) return;
    let b = g.apps.find((a) => a.kind === 'trash' && !a.dead && a.possessed <= 0);
    this.temp = !b;
    if (!b) {
      // walk in on the floor from the screen edge nearest the mess
      const first = this.jobs[0].o.body;
      const x = first.x < g.w / 2 ? 26 : g.w - 26;
      b = g.summonApp('trash', x, g.h, true, { temp: true });   // outside the app cap, never saved
      Object.assign(b, { x, y: g.floor.y, vy: 0, mode: 'ground', platKey: g.floor.key, spawnT: 1 });
    }
    this.binny = b;
    b.down = 0;
    b.goal = null;
    g.after(700, () => this.say(pick(LINES.arrive)));
    g.after(2600, () => { if (this.active && this.jobs.length > 1) g.say(g.stick, pick(['Binny is cleaning up. Thanks, Binny!', 'Good, someone else tidies up.', 'I was going to clean that. Eventually.'])); });
  }

  say(text) { if (this.binny && !this.binny.dead) this.g.say(this.binny, text); }

  cancel() {
    for (const j of this.jobs) { this.resolve(j); if (j.o) j.o.cleanup = null; }
    for (const id of this.cracks.keys()) this.resolve({ id });
    this.jobs = [];
    this.cracks.clear();
    if (this.binny) this.binny.job = null;
    if (this.temp && this.binny && !this.binny.dead) this.g.removeApp(this.binny);
    if (this.leaver && !this.leaver.dead) this.g.removeApp(this.leaver);
    this.leaver = null;
    this.leaving = false;
    this.binny = null;
    this.temp = false;
    this.active = false;
  }

  resolve(job, info = {}) {
    const id = job.id;
    if (!id) return;
    job.id = null;    // first, so our own (synchronous) resolve event is ignored
    try { this.T.resolve(id, info); } catch { /* already closed */ }
  }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    this.t += dt;
    // leftovers that vanished some other way (erased, fell off screen) close their ticket
    for (const j of this.jobs) if (j.o.dead) this.resolve(j);
    this.jobs = this.jobs.filter((j) => !j.o.dead);

    // keep each ticket where its leftover actually came to rest, so fsck walks to the right spot
    if ((this.syncT = (this.syncT || 0) - dt) <= 0) {
      this.syncT = 1;
      for (const j of this.jobs) {
        const b = j.o.body;
        if (j.id && !j.other && b.sleep > 0.3 && dist(b.x, b.y, j.x, j.y) > 24) {
          j.x = b.x; j.y = b.y;
          try { this.T.update(j.id, { x: b.x, y: b.y }); } catch { /* closed */ }
        }
      }
    }

    const b = this.binny;
    if (b && (b.dead || g.mode !== 'chill')) { this.binny = null; }
    if (this.binny && this.jobs.length) this.work(dt);
    if (this.t > DEADLINE && this.jobs.length) for (const j of this.jobs.slice()) this.suck(j);

    if (!this.jobs.length && this.stats.done === null) {
      this.stats.done = Math.round(this.t * 10) / 10;
      if (this.binny) this.finish();
    }
    if (!this.jobs.length && !this.cracks.size && !this.leaving) this.active = false;
  }

  work(dt) {
    const g = this.g, b = this.binny;
    let j = b.job;
    if (j && (j.o.dead || j.other)) { b.job = null; j = null; }
    if (!j) {
      // nearest leftover nobody else has claimed
      const free = this.jobs.filter((x) => !x.other).sort((p, q) => dist(p.o.body.x, p.o.body.y, b.x, b.y) - dist(q.o.body.x, q.o.body.y, b.x, b.y));
      for (const cand of free) {
        if (!cand.id || this.claim(cand)) { j = cand; break; }
      }
      if (!j) return;
      b.job = j;
      b.jobT = 0;
      b.jobBest = Infinity;
      b.stuckT = 0;
      j.keep = 0;
    }
    b.jobT += dt;
    const d = dist(j.o.body.x, j.o.body.y, b.x, b.y);
    if (d < b.jobBest - 20) { b.jobBest = d; b.stuckT = 0; } else b.stuckT = (b.stuckT || 0) + dt;
    // a claim is released after 20 s without progress: report a little progress now and then
    if (j.id && (j.keep -= dt) <= 0) {
      j.keep = 6;
      try { this.T.progress(j.id, Math.min(0.9, 0.1 + b.jobT / 20)); } catch { /* closed */ }
    }
    if (b.stuckT > STUCK || b.jobT > 25) this.suck(j);
  }

  claim(job) {
    try { if (this.T.claim(job.id)) return true; } catch { /* closed */ }
    job.other = 'someone';
    return false;
  }

  // Binny arrived: chomp.
  eat(b, job) {
    const g = this.g, o = job.o;
    o.dead = true;
    b.job = null;
    b.squash = 1;
    b.st.full = 1.2;
    g.fx.burst(o.body.x, o.body.y, { count: 8, color: ['#888', '#bbb', '#ddd'], type: 'debris', speed: 140, life: 0.6, size: 4, gravity: 900 });
    g.sfx('eat');
    this.resolve(job, { x: b.x, y: b.y - 30 });
    this.drop(job);
    this.stats.binny++;
    if (Math.random() < 0.6) this.say(pick(LINES.eat));
  }

  // Too high or stuck: pull it in from a distance (or, past the deadline, everything at once).
  suck(job) {
    const g = this.g, o = job.o, b = this.binny;
    if (o.dead) return;
    if (b && !b.dead) {
      const c = b.center;
      g.fx.beam(c.x, c.y - 10, o.body.x, o.body.y, 'rgba(180,190,210,0.9)', 0.4, 6);
      if (b.job === job) b.job = null;
      if (!this.suckSaid) { this.suckSaid = true; this.say(pick(LINES.suck)); }
    }
    g.fx.burst(o.body.x, o.body.y, { count: 10, color: ['#888', '#bbb'], type: 'dust', speed: 120, life: 0.5, size: 6, gravity: 0 });
    o.dead = true;
    this.resolve(job, b ? { x: b.x, y: b.y - 30 } : {});   // as the filer, even if fsck claimed it
    this.drop(job);
    this.stats.sucked++;
  }

  drop(job) { this.jobs = this.jobs.filter((x) => x !== job); }

  finish() {
    const g = this.g, b = this.binny;
    this.say(pick(LINES.done));
    if (!this.temp) { this.binny = null; return; }
    // a Binny called in for the job walks off the nearest screen edge
    this.leaving = true;
    this.leaver = b;
    const gone = () => {
      if (this.leaver !== b) return;
      g.apps = g.apps.filter((a) => a !== b);
      b.dead = true;
      this.leaver = null; this.leaving = false; this.leaveT = 0;
    };
    g.after(2200, () => {
      if (this.leaver !== b) return;
      if (b.dead || g.mode !== 'chill') return gone();
      g.say(b, pick(LINES.leave));
      const edge = b.x < g.w / 2 ? 4 : g.w - 4;
      b.walkTo(edge, g.floor);
      const check = () => {
        if (this.leaver !== b) return;
        if (b.dead || g.mode !== 'chill') return gone();
        if (Math.abs(b.x - edge) < 30 || (this.leaveT = (this.leaveT || 0) + 0.5) > 20) return gone();
        if (!b.goal) b.walkTo(edge, g.floor);
        g.after(500, check);
      };
      g.after(500, check);
    });
    this.binny = null;
    this.temp = false;
  }

  onTicket(type, t) {
    if (t.kind === 'crack' && this.cracks.has(t.id) && (type === 'resolve' || type === 'expire')) {
      this.g.fx.healCrack(this.cracks.get(t.id));
      this.cracks.delete(t.id);
      if (type === 'resolve' && t.by !== this.g.ctx.id) this.stats.fsckCracks++;
      return;
    }
    if (t.kind !== 'orphan') return;
    const job = this.jobs.find((j) => j.id === t.id);
    if (!job) return;
    if (type === 'claim' && t.claimedBy !== this.g.ctx.id) {
      job.other = t.claimedBy;
      if (this.binny?.job === job) { this.binny.job = null; if (Math.random() < 0.7) this.say(pick(LINES.beaten)); }
    } else if (type === 'release') job.other = null;
    else if (type === 'resolve' || type === 'expire') {
      // fsck collected it (or it timed out): it disappears with a poof
      job.id = null;
      const o = job.o;
      if (!o.dead) {
        o.dead = true;
        this.g.fx.burst(o.body.x, o.body.y, { count: 10, color: ['#7fd4ff', '#ffffff'], type: 'spark', speed: 120, life: 0.5, size: 3, gravity: 0 });
        if (type === 'resolve') this.stats.fsck++;
      }
      this.drop(job);
    }
  }

  summary() {
    if (!this.stats) return null;
    return { ...this.stats, active: this.active, left: this.jobs.length, cracksOpen: this.cracks.size, binny: this.stats.binny, elapsed: Math.round(this.t * 10) / 10 };
  }
}
