// Layers: when a widget goes full screen (the "sheet"), he lives behind it. Sometimes he tears
// the sheet like paper to come through to the front, sits in the hole, and later goes back.
// The host cuts the hole (a "tear" ticket) and enforces the rules; fsck repairs it.
import { clamp, rand, pick, chance } from '../util.js';

// A seeded noisy lens: paper rips along the fiber, so it is taller than wide, with a few spikes.
function tearShape(w, h, seed) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const n = 24, pts = [];
  const spikes = new Set([Math.floor(rnd() * n), Math.floor(rnd() * n), Math.floor(rnd() * n)]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = (spikes.has(i) ? 1.22 : 1) * (0.84 + rnd() * 0.3);
    pts.push([Math.cos(a) * (w / 2) * r, Math.sin(a) * (h / 2) * r]);
  }
  return pts;
}
const placed = (shape, cx, cy, sx, sy) => shape.map(([x, y]) => [Math.round(cx + x * sx), Math.round(cy + y * sy)]);

const layers = {
  actTearIn() {
    const g = this.g, s = this.s, T = g.ctx.desktop.tickets;
    const H = 90 * (g.settings.scale || 1);
    const w0 = Math.min(190, H * 0.8), h0 = Math.min(260, H * 1.25);
    const cx = clamp(s.x, 110, g.w - 110);
    const cy = clamp(s.y - h0 / 2 - 6, 70 + h0 / 2, g.h - 76 - h0 / 2);
    if (g.pointer.x >= 0 && Math.hypot(g.pointer.x - cx, g.pointer.y - cy) < 260) return this.actWander();
    const shape = tearShape(w0, h0, Math.floor(rand(1, 2e9)));
    // puncture, slit, open, full: four clip updates in total
    const stages = [[0.9, 0.12, 0.14], [1.3, 0.2, 0.62], [1.9, 0.62, 0.82], [2.6, 1, 1]];
    let k = 0, id = null;
    s.stop();
    s.faceTo(cx);
    this.say(pick(['Hello? Anyone out there?', 'Who put a wall here?', 'Hold on, coming through.', 'This panel is in my way.']));
    this.start('tearIn', (dt, a) => {
      if (k < stages.length && a.t >= stages[k][0]) {
        const pts = placed(shape, cx, cy, stages[k][1], stages[k][2]);
        if (k === 0) {
          const r = T.file({ kind: 'tear', points: pts, label: `torn by ${g.settings.name}` });
          if (r.rejected) { if (r.rejected !== 'busy') this.say(pick(['Hm. Reinforced.', 'Not here, then.'])); return true; }
          id = r.id;
          g.myTears.add(id);
        } else T.update(id, { points: pts });
        g.sfx('whoosh');
        if (++k === stages.length) {
          g.dropScraps(cx, cy + h0 / 2, id);
          T.update(id, { busy: true });      // nobody repairs a hole someone is climbing through
        }
      }
      if (k === stages.length && !a.climbed && a.t > 3.1) {
        a.climbed = true;
        g.setStickLayer('front');
        const p = g.platformByKey('t:' + id) || g.floor;
        Object.assign(s, { x: clamp(cx, p.x1 + 4, p.x2 - 4), y: p.y, platKey: p.key, plat: p, platX1: p.x1, mode: 'ground' });
        this.say(pick(['Knock knock.', 'Coming through!', 'Ta-da. New door.', 'Peekaboo.']));
      }
      if (a.climbed && a.t > 4) { T.update(id, { busy: false }); return true; }
      return false;
    }, { max: 9 });
  },

  // Window seat: sit on the bottom edge of a hole, legs dangling over the panel.
  actSitInHole() {
    const g = this.g, s = this.s;
    const ledge = pick(g.ledgePlatforms());
    if (!ledge) return this.actWander();
    if (s.platKey !== ledge.key) {
      Object.assign(s, { x: (ledge.x1 + ledge.x2) / 2, y: ledge.y, platKey: ledge.key, plat: ledge, platX1: ledge.x1, mode: 'ground' });
    }
    s.stop();
    const dur = rand(6, 10);
    s.play('sit', dur, { hold: true });
    if (chance(0.6)) this.say(pick(['Nice view from here.', 'Window seat!', 'So this is what you do all day.', 'Don\'t mind me.']));
    this.start('windowSeat', (dt, a) => a.t > dur, { max: 12 });
  },

  // Go back behind the sheet: through a hole if there is one, otherwise with a quick poof.
  actReturnBack() {
    const g = this.g, s = this.s;
    const ledge = g.ledgePlatforms()[0];
    if (ledge) Object.assign(s, { x: (ledge.x1 + ledge.x2) / 2, y: ledge.y, platKey: ledge.key, plat: ledge, platX1: ledge.x1, mode: 'ground' });
    this.say(pick(['Back to my side.', 'Okay, okay, I\'m going.', 'See you behind the scenes.']));
    this.start('returnBack', (dt, a) => {
      if (a.t > 0.8 && !a.went) {
        a.went = true;
        g.fx.ring(s.x, s.y - 40, 50, 'rgba(255,138,31,0.8)');
        g.setStickLayer('back');
      }
      return a.t > 1.2;
    }, { max: 3 });
  },
};

export function installLayers(Brain) {
  Object.assign(Brain.prototype, layers);
}
