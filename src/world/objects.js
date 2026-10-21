// Things that exist in the game world besides characters.
import { Body, rectShape, polyArea } from './physics.js';
import { simplify, polyLength, rand, pick, TAU, nextId, clamp } from '../util.js';
import { artImage, urlImage, fileKind } from '../actors/art.js';

export const MATERIALS = {
  ink:    { color: '#1b1b1f', glow: null,      label: 'Ink',    restitution: 0.25, density: 1 },
  fire:   { color: '#ff3b1f', glow: '#ff8a1f', label: 'Fire',   restitution: 0.2,  density: 0.9 },
  ice:    { color: '#3aa0ff', glow: '#bde0fe', label: 'Ice',    restitution: 0.1,  density: 1.3 },
  bouncy: { color: '#1fbf5a', glow: null,      label: 'Bouncy', restitution: 0.85, density: 0.7 },
};

class Thing {
  constructor(kind) { this.id = nextId(kind); this.kind = kind; this.dead = false; this.grabbable = true; this.hitCd = 0; }
  update(dt, g) {
    this.hitCd = Math.max(0, this.hitCd - dt);
    if (this.body) this.lastImpact = this.body.step(dt, g.world);
  }
  contains(x, y, pad = 6) { return this.body ? this.body.distTo(x, y) < pad : false; }
}

// ----------------------------------------------------------------- drawn strokes
export class Drawn extends Thing {
  // pts in world coordinates (raw pencil samples)
  constructor(raw, material = 'ink', owner = 'user') {
    super('drawn');
    this.material = material;
    this.owner = owner;
    let pts = simplify(raw, 2.2);
    const L = polyLength(pts);
    const first = pts[0], last = pts[pts.length - 1];
    const closed = pts.length > 3 && Math.hypot(first.x - last.x, first.y - last.y) < Math.max(18, L * 0.12);
    if (closed) pts = pts.slice(0, -1);
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    const local = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    const shape = { type: 'poly', pts: local, closed, area: closed ? polyArea(local) : 0 };
    const M = MATERIALS[material];
    this.body = new Body(shape, cx, cy, { restitution: M.restitution, density: M.density, friction: material === 'ice' ? 0.05 : 0.5 });
    this.length = L;
    this.closed = closed;
    // A long, fairly straight open stroke is a "stick": a weapon someone can wield.
    const ends = Math.hypot(first.x - last.x, first.y - last.y);
    this.isStick = !closed && L > 45 && L < 360 && ends > L * 0.6;
    this.life = Infinity;
    this.heldBy = null;
  }

  update(dt, g) {
    if (this.heldBy) { this.hitCd = Math.max(0, this.hitCd - dt); return; }
    super.update(dt, g);
    const M = MATERIALS[this.material];
    if (this.material === 'fire' && Math.random() < 0.35) {
      const p = pick(this.body.worldPts());
      g.fx.embers(p.x, p.y, 1);
    } else if (this.material === 'ice' && Math.random() < 0.12) {
      const p = pick(this.body.worldPts());
      g.fx.frost(p.x, p.y, 1);
    }
    if (this.life !== Infinity) { this.life -= dt; if (this.life <= 0) this.dead = true; }
    if (this.body.y > g.h + 400) this.dead = true;
    void M;
  }

  // A point on the stroke used as the grip (end closest to x,y), in local coordinates.
  gripLocal(x, y) {
    const pts = this.body.worldPts();
    const a = pts[0], b = pts[pts.length - 1];
    const s = this.body.shape.pts;
    return Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y)
      ? { grip: s[0], tip: s[s.length - 1] } : { grip: s[s.length - 1], tip: s[0] };
  }

  draw(gx) {
    const M = MATERIALS[this.material];
    const pts = this.body.worldPts();
    gx.save();
    gx.lineCap = 'round'; gx.lineJoin = 'round';
    if (this.life < 1) gx.globalAlpha = Math.max(0, this.life);
    if (M.glow) { gx.shadowColor = M.glow; gx.shadowBlur = 12; }
    gx.strokeStyle = M.color;
    gx.lineWidth = 5;
    gx.beginPath();
    pts.forEach((p, i) => (i ? gx.lineTo(p.x, p.y) : gx.moveTo(p.x, p.y)));
    if (this.closed) {
      gx.closePath();
      gx.fillStyle = M.color + '33';
      gx.fill();
    }
    gx.stroke();
    if (this.material === 'bouncy') {
      gx.shadowBlur = 0;
      gx.strokeStyle = '#b7ffcf'; gx.lineWidth = 1.5; gx.stroke();
    }
    gx.restore();
  }
}

// Draw a raw polyline (for strokes being drawn, before they become objects).
export function drawInk(gx, pts, material, alpha = 1) {
  if (pts.length < 2) return;
  const M = MATERIALS[material];
  gx.save();
  gx.globalAlpha = alpha;
  gx.lineCap = 'round'; gx.lineJoin = 'round';
  if (M.glow) { gx.shadowColor = M.glow; gx.shadowBlur = 10; }
  gx.strokeStyle = M.color; gx.lineWidth = 5;
  gx.beginPath();
  pts.forEach((p, i) => (i ? gx.lineTo(p.x, p.y) : gx.moveTo(p.x, p.y)));
  gx.stroke();
  gx.restore();
}

// Procedural shapes the stickman can "draw" himself.
export function shapePoints(kind, x, y, dir = 1, s = 1) {
  const P = [];
  if (kind === 'sword') {
    const L = 70 * s;
    for (let i = 0; i <= 10; i++) P.push({ x: x + dir * (i / 10) * L, y: y - (i / 10) * L * 0.9 + Math.sin(i) * 0.6 });
  } else if (kind === 'staff') {
    const L = 110 * s;
    for (let i = 0; i <= 12; i++) P.push({ x: x + dir * (i / 12) * L * 0.25, y: y - (i / 12) * L });
  } else if (kind === 'ball') {
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU; P.push({ x: x + Math.cos(a) * 14 * s, y: y + Math.sin(a) * 14 * s }); }
  } else if (kind === 'heart') {
    for (let i = 0; i <= 28; i++) {
      const t = (i / 28) * TAU;
      P.push({ x: x + 1.3 * s * 16 * Math.sin(t) ** 3, y: y - 1.3 * s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) });
    }
  } else if (kind === 'star') {
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU, r = (i % 2 ? 11 : 26) * s;
      P.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
  } else if (kind === 'house') {
    const w = 34 * s, h = 26 * s;
    P.push({ x: x - w, y }, { x: x - w, y: y - h }, { x, y: y - h * 2 }, { x: x + w, y: y - h }, { x: x + w, y }, { x: x - w, y });
  } else if (kind === 'box') {
    const w = 24 * s;
    P.push({ x: x - w, y: y - w }, { x: x + w, y: y - w }, { x: x + w, y: y + w }, { x: x - w, y: y + w }, { x: x - w, y: y - w });
  } else if (kind === 'spear') {
    const L = 120 * s;
    for (let i = 0; i <= 12; i++) P.push({ x: x + dir * (i / 12) * L, y: y - (i / 12) * L * 0.15 });
  }
  return P;
}

// ----------------------------------------------------------------- desktop file copy
export class FileCopy extends Thing {
  constructor(item, x, y) {
    super('file');
    this.item = item;
    this.label = item.name.length > 16 ? item.name.slice(0, 14) + '…' : item.name;
    this.img = item.iconUrl ? urlImage(item.iconUrl) : artImage(fileKind(item));
    this.fallback = artImage(fileKind(item));
    this.home = { x, y };
    this.body = new Body(rectShape(48, 48), x, y, { static: true, restitution: 0.3 });
    this.hp = 3;
    this.broken = false;
    this.respawn = 0;
    this.appear = 0;
  }

  get solid() { return !this.broken && this.body.static; }

  knock(vx, vy) {
    if (this.broken) return;
    this.body.static = false;
    this.body.sleep = 0;
    this.body.vx += vx; this.body.vy += vy; this.body.w += rand(-6, 6);
  }

  shatter(g) {
    if (this.broken) return;
    this.broken = true;
    const { x, y } = this.body;
    g.fx.shards(x, y, ['#e8eef7', '#c8d6ea', '#9fb3cf', '#ffffff'], 18, 380);
    g.fx.burst(x, y, { count: 8, color: ['#9aa6b8', '#5d6b80'], type: 'debris', speed: 300, life: 1.6, size: 6, gravity: 1300 });
    g.fx.popText(x, y - 30, 'copy destroyed (file is fine)', '#cfe8ff', 12);
    g.sfx('crack');
    this.respawn = 9 + rand(4);
  }

  restore(g) {
    this.broken = false;
    this.hp = 3;
    this.body = new Body(rectShape(48, 48), this.home.x, this.home.y, { static: true, restitution: 0.3 });
    this.appear = 0;
    g.fx.burst(this.home.x, this.home.y, { count: 10, color: ['#bde0fe', '#fff'], type: 'spark', speed: 120, life: 0.6, size: 3, gravity: 0 });
  }

  damage(g, n = 1) {
    this.hp -= n;
    if (this.hp <= 0) this.shatter(g);
    else g.fx.sparks(this.body.x, this.body.y, '#cfe8ff', 6);
  }

  update(dt, g) {
    this.appear = Math.min(1, this.appear + dt * 2);
    if (this.broken) {
      this.respawn -= dt;
      if (this.respawn <= 0 && g.mode !== 'fight') this.restore(g);
      return;
    }
    const v = this.body.speed();
    super.update(dt, g);
    if (this.lastImpact > 700 && v > 700) this.damage(g, 1);
    if (this.body.y > g.h + 200) this.shatter(g);
  }

  contains(x, y) {
    if (this.broken) return false;
    return Math.abs(x - this.body.x) < 30 && Math.abs(y - this.body.y) < 36;
  }

  draw(gx, g) {
    if (this.broken) return;
    const b = this.body;
    gx.save();
    gx.translate(b.x, b.y);
    gx.rotate(b.a);
    gx.globalAlpha = this.appear;
    const img = this.img.complete && this.img.naturalWidth ? this.img : this.fallback;
    if (img.complete && img.naturalWidth) gx.drawImage(img, -24, -24, 48, 48);
    gx.font = '600 11px system-ui, sans-serif';
    gx.textAlign = 'center';
    gx.lineWidth = 3; gx.strokeStyle = 'rgba(0,0,0,0.6)';
    gx.strokeText(this.label, 0, 38);
    gx.fillStyle = '#fff';
    gx.fillText(this.label, 0, 38);
    if (g.mode === 'fight' || this.hp < 3) {
      gx.font = '700 9px system-ui, sans-serif';
      gx.fillStyle = 'rgba(160,210,255,0.95)';
      gx.fillText('⧉ copy', 0, -28);
    }
    if (this.hp < 3) {
      gx.strokeStyle = 'rgba(255,255,255,0.85)'; gx.lineWidth = 1;
      gx.beginPath();
      gx.moveTo(-12, -20); gx.lineTo(-2, -4); gx.lineTo(-8, 8);
      if (this.hp < 2) { gx.moveTo(10, -18); gx.lineTo(3, -2); gx.lineTo(14, 14); }
      gx.stroke();
    }
    gx.restore();
  }
}

// ----------------------------------------------------------------- simple props
export class Ball extends Thing {
  constructor(x, y, opts = {}) {
    super('ball');
    this.r = opts.r || 12;
    this.color = opts.color || '#ff4d6d';
    this.body = new Body({ type: 'circle', r: this.r }, x, y, { restitution: 0.75, vx: opts.vx || 0, vy: opts.vy || 0 });
    this.life = opts.life ?? 60;
  }
  update(dt, g) {
    super.update(dt, g);
    this.life -= dt;
    if (this.life <= 0 || this.body.y > g.h + 300) this.dead = true;
  }
  draw(gx) {
    const b = this.body;
    gx.save(); gx.translate(b.x, b.y); gx.rotate(b.a);
    if (this.life < 1) gx.globalAlpha = this.life;
    gx.fillStyle = this.color;
    gx.beginPath(); gx.arc(0, 0, this.r, 0, TAU); gx.fill();
    gx.strokeStyle = '#fff'; gx.lineWidth = 2.5;
    gx.beginPath(); gx.arc(0, 0, this.r * 0.62, -0.6, 1.4); gx.stroke();
    gx.restore();
  }
}

export class Cookie extends Thing {
  constructor(x, y) {
    super('cookie');
    this.body = new Body({ type: 'circle', r: 9 }, x, y, { restitution: 0.3, vy: 50 });
    this.life = 40;
    this.bites = 0;
  }
  update(dt, g) { super.update(dt, g); this.life -= dt; if (this.life <= 0) this.dead = true; }
  draw(gx) {
    const b = this.body;
    gx.save(); gx.translate(b.x, b.y); gx.rotate(b.a);
    gx.fillStyle = '#d4a056';
    gx.beginPath(); gx.arc(0, 0, 9, 0, TAU); gx.fill();
    if (this.bites) { gx.globalCompositeOperation = 'destination-out'; gx.beginPath(); gx.arc(8, -4, 5 + this.bites * 2, 0, TAU); gx.fill(); gx.globalCompositeOperation = 'source-over'; }
    gx.fillStyle = '#5b3a1a';
    for (const [x, y] of [[-3, -3], [3, 1], [-1, 4], [4, -4]]) { gx.beginPath(); gx.arc(x, y, 1.4, 0, TAU); gx.fill(); }
    gx.restore();
  }
}

export class Bomb extends Thing {
  constructor(x, y, owner = 'user', fuse = 1.8) {
    super('bomb');
    this.owner = owner;
    this.body = new Body({ type: 'circle', r: 11 }, x, y, { restitution: 0.35, density: 2 });
    this.fuse = fuse;
  }
  update(dt, g) {
    super.update(dt, g);
    this.fuse -= dt;
    if (Math.random() < 0.6) g.fx.sparks(this.body.x + 6, this.body.y - 14, '#ffd166', 1);
    if (this.fuse <= 0) { this.dead = true; g.explode(this.body.x, this.body.y, 1, this.owner); }
  }
  draw(gx) {
    const b = this.body;
    gx.save(); gx.translate(b.x, b.y); gx.rotate(b.a);
    const blink = this.fuse < 0.6 && Math.floor(this.fuse * 12) % 2;
    gx.fillStyle = blink ? '#ff3b3b' : '#222';
    gx.beginPath(); gx.arc(0, 0, 11, 0, TAU); gx.fill();
    gx.fillStyle = '#555'; gx.fillRect(-3, -15, 6, 5);
    gx.strokeStyle = '#a77b4f'; gx.lineWidth = 2;
    gx.beginPath(); gx.moveTo(0, -15); gx.quadraticCurveTo(5, -20, 6, -14); gx.stroke();
    gx.fillStyle = 'rgba(255,255,255,0.5)'; gx.beginPath(); gx.arc(-4, -4, 3, 0, TAU); gx.fill();
    gx.restore();
  }
}

// Heavy falling command text from the terminal.
export class TextBlock extends Thing {
  constructor(x, y, text, owner = 'ally') {
    super('textblock');
    this.text = text;
    this.owner = owner;
    this.wpx = Math.max(60, text.length * 8.4 + 16);
    this.body = new Body(rectShape(this.wpx, 24), x, y, { restitution: 0.15, density: 2.2, vy: 200 });
    this.life = 12;
  }
  update(dt, g) { super.update(dt, g); this.life -= dt; if (this.life <= 0 || this.body.y > g.h + 300) this.dead = true; }
  draw(gx) {
    const b = this.body;
    gx.save(); gx.translate(b.x, b.y); gx.rotate(b.a);
    if (this.life < 1) gx.globalAlpha = this.life;
    gx.fillStyle = '#10141c'; gx.strokeStyle = '#7CFF8A'; gx.lineWidth = 1.5;
    gx.beginPath(); gx.roundRect(-this.wpx / 2, -12, this.wpx, 24, 4); gx.fill(); gx.stroke();
    gx.fillStyle = '#7CFF8A'; gx.font = '600 13px ui-monospace, monospace'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
    gx.fillText(this.text, 0, 1);
    gx.restore();
  }
}

// Fake error dialogs the stickman throws at you. They are only drawings with an OK button.
export class Popup extends Thing {
  constructor(x, y, title, text) {
    super('popup');
    this.title = title; this.text = text;
    this.pw = 250; this.ph = 104;
    this.body = new Body(rectShape(this.pw, this.ph), x, y, { restitution: 0.2, density: 0.6 });
    this.body.gravityScale = 0;
    this.life = 14;
    this.t = 0;
  }
  update(dt, g) {
    this.t += dt;
    super.update(dt, g);
    this.life -= dt;
    if (this.life <= 0 || this.body.y > g.h + 300) this.dead = true;
  }
  okRect() {
    return { x: this.body.x + this.pw / 2 - 70, y: this.body.y + this.ph / 2 - 30, w: 58, h: 22 };
  }
  hitOk(x, y) {
    if (Math.abs(this.body.a) > 0.3) return false;
    const r = this.okRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  contains(x, y) {
    const b = this.body;
    const c = Math.cos(-b.a), s = Math.sin(-b.a);
    const lx = (x - b.x) * c - (y - b.y) * s, ly = (x - b.x) * s + (y - b.y) * c;
    return Math.abs(lx) < this.pw / 2 && Math.abs(ly) < this.ph / 2;
  }
  draw(gx) {
    const b = this.body, w = this.pw, h = this.ph;
    const pop = clamp(this.t * 6, 0, 1);
    gx.save(); gx.translate(b.x, b.y); gx.rotate(b.a); gx.scale(pop, pop);
    if (this.life < 1) gx.globalAlpha = this.life;
    gx.shadowColor = 'rgba(0,0,0,0.35)'; gx.shadowBlur = 18; gx.shadowOffsetY = 6;
    gx.fillStyle = '#f2f2f5';
    gx.beginPath(); gx.roundRect(-w / 2, -h / 2, w, h, 8); gx.fill();
    gx.shadowColor = 'transparent';
    gx.fillStyle = '#d6303b';
    gx.beginPath(); gx.roundRect(-w / 2, -h / 2, w, 24, [8, 8, 0, 0]); gx.fill();
    gx.fillStyle = '#fff'; gx.font = '700 12px system-ui, sans-serif'; gx.textBaseline = 'middle';
    gx.fillText(this.title, -w / 2 + 10, -h / 2 + 12);
    gx.fillText('✕', w / 2 - 18, -h / 2 + 12);
    gx.fillStyle = '#d6303b'; gx.font = '900 22px system-ui'; gx.fillText('⚠', -w / 2 + 12, -6);
    gx.fillStyle = '#222'; gx.font = '500 12px system-ui, sans-serif';
    wrap(gx, this.text, -w / 2 + 44, -12, w - 56, 15);
    const r = { x: w / 2 - 70, y: h / 2 - 30 };
    gx.fillStyle = '#e1e1e8'; gx.strokeStyle = '#999';
    gx.beginPath(); gx.roundRect(r.x, r.y, 58, 22, 5); gx.fill(); gx.stroke();
    gx.fillStyle = '#222'; gx.textAlign = 'center'; gx.font = '600 12px system-ui';
    gx.fillText('OK', r.x + 29, r.y + 11);
    gx.restore();
  }
}

function wrap(gx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let lineS = '';
  for (const w of words) {
    const t = lineS ? lineS + ' ' + w : w;
    if (gx.measureText(t).width > maxW && lineS) { gx.fillText(lineS, x, y); lineS = w; y += lh; }
    else lineS = t;
  }
  gx.fillText(lineS, x, y);
}

// ----------------------------------------------------------------- projectiles (no Body)
// owner: 'stick' (hurts you and your apps) or 'ally' (hurts the stickman)
export class Projectile {
  constructor(x, y, vx, vy, opts = {}) {
    this.id = nextId('p');
    this.kind = 'proj';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.owner = opts.owner || 'stick';
    this.type = opts.type || 'blast';
    this.dmg = opts.dmg ?? 8;
    this.r = opts.r ?? 9;
    this.gravity = opts.gravity ?? 0;
    this.life = opts.life ?? 3;
    this.text = opts.text || '';
    this.color = opts.color || '#ff8a1f';
    this.dead = false;
    this.t = 0;
    this.target = opts.target || null; // homing target {x,y} getter
    this.aim = opts.aim || null;       // where a stick shot "hits the screen"
  }
  update(dt, g) {
    this.t += dt;
    this.life -= dt;
    if (this.target && this.t < 1.2) {
      const tp = this.target();
      if (tp) {
        const a = Math.atan2(tp.y - this.y, tp.x - this.x);
        const s = Math.hypot(this.vx, this.vy);
        const cur = Math.atan2(this.vy, this.vx);
        let d = a - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
        const na = cur + clamp(d, -3 * dt, 3 * dt);
        this.vx = Math.cos(na) * s; this.vy = Math.sin(na) * s;
      }
    }
    this.vy += this.gravity * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.type === 'blast' && Math.random() < 0.7) g.fx.embers(this.x, this.y, 1);
    if (this.life <= 0 || this.x < -50 || this.x > g.w + 50 || this.y > g.h + 50 || this.y < -200) this.dead = true;
  }
  draw(gx) {
    gx.save();
    if (this.type === 'blast') {
      const grad = gx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 2);
      grad.addColorStop(0, '#fff'); grad.addColorStop(0.35, this.color); grad.addColorStop(1, 'rgba(255,120,0,0)');
      gx.fillStyle = grad;
      gx.beginPath(); gx.arc(this.x, this.y, this.r * 2, 0, TAU); gx.fill();
    } else if (this.type === 'text') {
      gx.font = `900 ${this.r * 2}px system-ui, sans-serif`;
      gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.lineWidth = 3; gx.strokeStyle = 'rgba(0,0,0,0.6)';
      gx.translate(this.x, this.y); gx.rotate(this.t * 6);
      gx.strokeText(this.text, 0, 0);
      gx.fillStyle = this.color; gx.fillText(this.text, 0, 0);
    } else if (this.type === 'beam') {
      gx.strokeStyle = this.color; gx.lineWidth = 4; gx.shadowColor = this.color; gx.shadowBlur = 10;
      gx.beginPath(); gx.moveTo(this.x, this.y); gx.lineTo(this.x - this.vx * 0.04, this.y - this.vy * 0.04); gx.stroke();
    } else {
      gx.fillStyle = this.color;
      gx.beginPath(); gx.arc(this.x, this.y, this.r, 0, TAU); gx.fill();
    }
    gx.restore();
  }
}
