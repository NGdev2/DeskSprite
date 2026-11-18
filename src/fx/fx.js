// Canvas effects that live in the game layer: physical particles, glass cracks, lightning,
// beams, shockwaves, screen shake and glitch bars. All of it is paint. Nothing real breaks.
import { rand, pick, TAU, clamp, nextId } from '../util.js';

const MAX_CRACKS = 8;

export class FX {
  constructor(game) {
    this.g = game;
    this.parts = [];
    this.cracks = [];
    this.bolts = [];
    this.beams = [];
    this.rings = [];
    this.texts = [];
    this.shakeAmp = 0;
    this.flashA = 0;
    this.flashColor = '#fff';
    this.glitchT = 0;
  }

  burst(x, y, opts = {}) {
    const n = opts.count ?? 12;
    for (let i = 0; i < n; i++) {
      const a = (opts.angle ?? -Math.PI / 2) + rand(-1, 1) * (opts.spread ?? Math.PI);
      const s = rand(0.3, 1) * (opts.speed ?? 300);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.6, 1) * (opts.life ?? 0.8), max: opts.life ?? 0.8,
        size: rand(0.6, 1.2) * (opts.size ?? 3), color: Array.isArray(opts.color) ? pick(opts.color) : (opts.color || '#fff'),
        type: opts.type || 'spark', g: opts.gravity ?? 900, rot: rand(TAU), vr: rand(-10, 10),
        text: opts.text, bounce: opts.bounce ?? 0.3, drag: opts.drag ?? 0.2,
      });
    }
  }

  sparks(x, y, color = '#ffd36e', n = 10) { this.burst(x, y, { count: n, color, speed: 380, life: 0.4, size: 2.2, gravity: 600 }); }
  dust(x, y, n = 8) { this.burst(x, y, { count: n, color: 'rgba(220,220,230,0.7)', type: 'dust', speed: 120, life: 0.7, size: 6, gravity: -40, spread: 1.2 }); }
  shards(x, y, color = '#cfe8ff', n = 14, speed = 420) {
    this.burst(x, y, { count: n, color, type: 'shard', speed, life: 1.6, size: 7, gravity: 1300, bounce: 0.35 });
  }
  embers(x, y, n = 3) { this.burst(x, y, { count: n, color: ['#ffb703', '#fb5607', '#ff006e'], type: 'ember', speed: 70, life: 0.7, size: 4, gravity: -260, spread: 0.8 }); }
  frost(x, y, n = 3) { this.burst(x, y, { count: n, color: ['#bde0fe', '#e0fbfc', '#a2d2ff'], type: 'spark', speed: 60, life: 0.8, size: 3, gravity: 60 }); }
  notes(x, y, n = 1) { this.burst(x, y, { count: n, color: ['#c77dff', '#ff99c8', '#a0c4ff'], type: 'text', text: pick(['♪', '♫', '♬']), speed: 60, life: 1.6, size: 16, gravity: -50, spread: 0.7 }); }
  zzz(x, y) { this.burst(x, y, { count: 1, color: 'rgba(255,255,255,0.85)', type: 'text', text: 'z', speed: 30, life: 2.2, size: 13, gravity: -25, angle: -1.2, spread: 0.3 }); }
  stars(x, y) { this.burst(x, y, { count: 5, color: '#ffe066', type: 'text', text: '★', speed: 90, life: 0.9, size: 12, gravity: 0 }); }
  sweat(x, y) { this.burst(x, y, { count: 1, color: '#8ecae6', type: 'drop', speed: 100, life: 0.7, size: 3, gravity: 900, angle: -1.9, spread: 0.4 }); }

  popText(x, y, text, color = '#fff', size = 18) {
    this.texts.push({ x, y, text, color, size, life: 1.1, max: 1.1, vy: -60 });
  }

  // A radial "broken glass" crack at x,y. Returns it; its id lets a repair ticket heal just this one.
  crack(x, y, power = 1) {
    const lines = [];
    const n = Math.round(6 + power * 5);
    const R = 40 + power * 90;
    for (let i = 0; i < n; i++) {
      let a = (i / n) * TAU + rand(-0.25, 0.25);
      let px = x, py = y;
      const len = R * rand(0.5, 1.2);
      const steps = 4 + Math.floor(rand(4));
      for (let s = 0; s < steps; s++) {
        a += rand(-0.35, 0.35);
        const l = (len / steps) * rand(0.6, 1.4);
        const nx = px + Math.cos(a) * l, ny = py + Math.sin(a) * l;
        lines.push([px, py, nx, ny, 1 - s / steps]);
        if (Math.random() < 0.3) {
          const b = a + rand(-1.2, 1.2), bl = l * rand(0.4, 0.9);
          lines.push([nx, ny, nx + Math.cos(b) * bl, ny + Math.sin(b) * bl, 0.5 - s / steps / 2]);
        }
        px = nx; py = ny;
      }
    }
    // concentric ring fragments
    const rings = [];
    for (let k = 1; k <= 2; k++) {
      const rr = R * 0.25 * k;
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.5) continue;
        const a1 = (i / n) * TAU, a2 = ((i + 1) / n) * TAU;
        rings.push([x + Math.cos(a1) * rr, y + Math.sin(a1) * rr, x + Math.cos(a2) * rr, y + Math.sin(a2) * rr, 0.6]);
      }
    }
    const c = { id: nextId('crack'), x, y, lines: lines.concat(rings), a: 1, healing: false, R };
    this.cracks.push(c);
    // keep the screen readable: past 8 cracks the oldest fades away
    const open = this.cracks.filter((k) => !k.healing && !k.ticket);
    for (let i = 0; i < open.length - MAX_CRACKS; i++) { open[i].healing = true; open[i].fast = true; }
    if (this.cracks.length > 40) this.cracks.shift();
    return c;
  }

  // Heal every crack, except the ids in `keep` (those wait for a repair ticket).
  healCracks(keep = null) { for (const c of this.cracks) if (!keep?.has(c.id)) c.healing = true; }
  healCrack(id) {
    const c = this.cracks.find((k) => k.id === id);
    if (c) c.healing = true;
    return !!c;
  }

  bolt(x1, y1, x2, y2, color = '#cde8ff') {
    const pts = [[x1, y1]];
    const n = 14;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([x1 + (x2 - x1) * t + rand(-22, 22), y1 + (y2 - y1) * t + rand(-8, 8)]);
    }
    pts.push([x2, y2]);
    this.bolts.push({ pts, life: 0.35, max: 0.35, color });
    this.flash(0.35, '#e8f4ff');
  }

  beam(x1, y1, x2, y2, color = '#5ff09a', life = 0.25, width = 5) {
    this.beams.push({ x1, y1, x2, y2, color, life, max: life, width });
  }

  ring(x, y, r = 120, color = 'rgba(255,255,255,0.8)', life = 0.45) {
    this.rings.push({ x, y, r, color, life, max: life });
  }

  shake(a) { this.shakeAmp = Math.max(this.shakeAmp, a); }
  flash(a = 0.5, color = '#fff') { this.flashA = Math.max(this.flashA, a); this.flashColor = color; }
  glitch(t = 0.4) { this.glitchT = Math.max(this.glitchT, t); }

  update(dt) {
    const plats = this.g.platforms;
    const W = this.g.w;
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt;
      const py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if ((p.type === 'shard' || p.type === 'debris') && p.vy > 0) {
        for (const pl of plats) {
          if (p.x >= pl.x1 && p.x <= pl.x2 && py <= pl.y && p.y >= pl.y) {
            p.y = pl.y; p.vy *= -p.bounce; p.vx *= 0.6; p.vr *= 0.5;
            break;
          }
        }
      }
      if (p.x < 0 || p.x > W) p.vx *= -0.5;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    for (const c of this.cracks) if (c.healing) c.a -= dt * (c.fast ? 6 : 1.5);
    this.cracks = this.cracks.filter((c) => c.a > 0);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= 1 - 2 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shakeAmp *= Math.exp(-dt * 9);
    if (this.shakeAmp < 0.3) this.shakeAmp = 0;
    this.flashA = Math.max(0, this.flashA - dt * 2.5);
    this.glitchT = Math.max(0, this.glitchT - dt);
  }

  shakeOffset() {
    if (!this.shakeAmp) return [0, 0];
    return [rand(-1, 1) * this.shakeAmp, rand(-1, 1) * this.shakeAmp];
  }

  // Cracks go under everything else (they're "on the screen glass" behind the action).
  drawBack(g) {
    g.save();
    g.lineCap = 'round';
    for (const c of this.cracks) {
      const a = clamp(c.a, 0, 1);
      g.strokeStyle = `rgba(0,0,0,${0.35 * a})`;
      g.lineWidth = 3;
      g.beginPath();
      for (const [x1, y1, x2, y2] of c.lines) { g.moveTo(x1 + 1, y1 + 1); g.lineTo(x2 + 1, y2 + 1); }
      g.stroke();
      for (const [x1, y1, x2, y2, w] of c.lines) {
        g.strokeStyle = `rgba(255,255,255,${(0.55 + 0.4 * w) * a})`;
        g.lineWidth = 0.8 + w * 1.4;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.R * 0.35);
      grad.addColorStop(0, `rgba(255,255,255,${0.35 * a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(c.x, c.y, c.R * 0.35, 0, TAU); g.fill();
    }
    g.restore();
  }

  drawFront(g) {
    g.save();
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      g.strokeStyle = r.color;
      g.globalAlpha = 1 - k;
      g.lineWidth = 6 * (1 - k) + 1;
      g.beginPath(); g.arc(r.x, r.y, r.r * k, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    for (const b of this.beams) {
      const k = b.life / b.max;
      g.strokeStyle = b.color;
      g.globalAlpha = k;
      g.lineWidth = b.width * (0.5 + k);
      g.shadowColor = b.color; g.shadowBlur = 16;
      g.beginPath(); g.moveTo(b.x1, b.y1); g.lineTo(b.x2, b.y2); g.stroke();
    }
    g.shadowBlur = 0;
    for (const b of this.bolts) {
      const k = b.life / b.max;
      g.globalAlpha = k;
      for (const [w, c] of [[9, 'rgba(120,180,255,0.35)'], [3.5, b.color], [1.2, '#fff']]) {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        b.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    for (const p of this.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      g.globalAlpha = p.type === 'shard' || p.type === 'debris' ? Math.min(1, k * 3) : k;
      g.fillStyle = p.color;
      if (p.type === 'text') {
        g.font = `bold ${p.size}px system-ui, sans-serif`;
        g.fillText(p.text, p.x, p.y);
      } else if (p.type === 'shard') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.beginPath(); g.moveTo(-p.size, -p.size * 0.4); g.lineTo(p.size * 0.8, -p.size * 0.7); g.lineTo(p.size * 0.3, p.size * 0.8); g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.stroke();
        g.restore();
      } else if (p.type === 'debris') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        g.restore();
      } else if (p.type === 'dust') {
        g.beginPath(); g.arc(p.x, p.y, p.size * (1.5 - k), 0, TAU); g.fill();
      } else {
        g.beginPath(); g.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
    for (const t of this.texts) {
      const k = t.life / t.max;
      g.globalAlpha = Math.min(1, k * 2);
      g.font = `900 ${t.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeText(t.text, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.text, t.x, t.y);
    }
    g.textAlign = 'start';
    g.globalAlpha = 1;
    g.restore();
  }

  // Full-screen overlays drawn last (no shake).
  drawScreen(g, w, h) {
    if (this.glitchT > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const y = rand(h), bh = rand(3, 26);
        g.fillStyle = pick(['rgba(255,0,80,0.12)', 'rgba(0,255,220,0.12)', 'rgba(255,255,255,0.08)']);
        g.fillRect(rand(-40, 40), y, w, bh);
      }
      g.restore();
    }
    if (this.flashA > 0) {
      g.save();
      g.globalAlpha = this.flashA * 0.6;
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  }
}
