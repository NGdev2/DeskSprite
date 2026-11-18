// Fight mode: a full-screen interactive layer with an Animator-style toolbox.
// Tools: Hand (grab & throw), Pencil (draw weapons: ink, fire, ice, bouncy),
// Eraser, Bomb and Lightning, plus buttons that summon your apps as allies.
// Every tool only paints on the game layer. Nothing on your computer is touched.
// The HUD always shows a ❓ Help button, a key legend and the shapes you can draw.
// With the autopilot on, it plays your side and you watch (click anywhere to take over).
import { Drawn, Bomb, MATERIALS, drawInk } from '../world/objects.js';
import { classify, makeItem, ITEMS } from '../world/sketch.js';
import { artImage } from '../actors/art.js';
import { APPS, TIERS, tierOf } from '../actors/lore.js';
import { Autopilot } from './autopilot.js';
import { clamp, rand, pick, dist, TAU } from '../util.js';

const TOOLS = [
  { id: 'hand', icon: '✋', label: 'Hand', tip: 'Grab and throw anything' },
  { id: 'pencil', icon: '✏️', label: 'Pencil', tip: 'Draw weapons, walls and boxes' },
  { id: 'eraser', icon: '🧽', label: 'Eraser', tip: 'Erase drawings and the stickman' },
  { id: 'bomb', icon: '💣', label: 'Bomb', tip: 'Drop a bomb' },
  { id: 'zap', icon: '⚡', label: 'Lightning', tip: 'Strike! Also frees possessed apps' },
];
const ALLIES = ['antivirus', 'terminal', 'browser', 'trash', 'folder', 'paint', 'settings', 'clock', 'code', 'game', 'music', 'calculator', 'mail', 'chat'];
const TIER_ORDER = { boss: 0, strong: 1, normal: 2, weak: 3 };
const INK_KEYS = { ink: 'Q', fire: 'W', ice: 'E', bouncy: 'R' };

export class Arena {
  constructor(game, opts = {}) {
    this.g = game;
    this.allies = ALLIES.slice().sort((a, b) => TIER_ORDER[tierOf(a, game.level)] - TIER_ORDER[tierOf(b, game.level)]);
    this.tool = 'pencil';
    this.material = 'ink';
    this.stroke = null;
    this.drag = null;
    this.cd = { bomb: 0, zap: 0, summon: 0, restore: 0 };
    this.eraserOn = false;
    const ctx = game.ctx;
    this.el = ctx.overlay.create({ interactive: true, className: 'ds-arena', layer: 'front' });   // fights happen in front of everything
    this.el.style.width = game.w + 'px';
    this.el.style.height = game.h + 'px';
    this.el.innerHTML = this.html();
    this.$ = (s) => this.el.querySelector(s);
    this.bind();
    this.setTool('pencil');
    // Esc ends the fight and nothing else (it would also collapse a full-screen widget)
    this.releaseKeys = ctx.keys?.capture?.(['Escape']);
    this.auto = opts.autopilot ? new Autopilot(this) : null;
    this.el.classList.toggle('ds-auto-on', !!this.auto);
    if (this.auto) this.toast('🤖 Autopilot is playing your side. Sit back and watch, or click anywhere to take over. Esc ends the fight.', 6000);
    else {
      this.toast('📸 Snapshot taken. You\'re fighting on a copy of your desktop: nothing real can break. ❓ Help shows the controls.', 5200);
      if (!game.ctx.storage.get('sawHelp', false)) {
        // first fight: the help opens right away and he waits until you close it
        game.ctx.storage.set('sawHelp', true);
        this.toggleHelp(true);
        this.setHold(true);
      }
    }
  }

  html() {
    const g = this.g;
    const tools = TOOLS.map((t, i) => `<button class="ds-tool" data-tool="${t.id}" title="${t.tip} (${i + 1})"><span>${t.icon}</span><small>${i + 1}</small></button>`).join('');
    const mats = Object.entries(MATERIALS).map(([k, m]) => `<button class="ds-mat" data-mat="${k}" title="${m.label} ink (${INK_KEYS[k]})" style="--c:${m.color}"><small>${INK_KEYS[k]}</small></button>`).join('');
    const allies = this.allies.map((k) => {
      const tier = tierOf(k, g.level), T = TIERS[tier], A = APPS[k];
      const sig = A.sig ? ` · signature: ${A.sig}` : '';
      return `<button class="ds-ally ds-t-${tier}" data-ally="${k}" title="Summon ${A.nick}: ${A.title} · ${T.label}${sig}"><img src="${artImage(k).src}" alt=""><em style="--tc:${T.color}">${T.badge}</em></button>`;
    }).join('');
    const shapes = Object.entries(ITEMS).map(([k, it]) => `<span class="ds-shape" data-item="${k}" title="${it.how} → ${it.name}: ${it.tip}"><svg viewBox="0 0 64 44"><path d="${it.path}"/></svg><b>${it.emoji}</b></span>`).join('');
    const tierKey = ['boss', 'strong', 'normal', 'weak'].map((t) => `<span style="color:${TIERS[t].color}">${TIERS[t].badge} ${TIERS[t].label}</span>`).join(' · ');
    return `
      <div class="ds-hud ds-top">
        <div class="ds-bar ds-you"><b>YOU · desktop</b><i><u></u></i></div>
        <div class="ds-vs">VS</div>
        <div class="ds-bar ds-him"><b>${esc(g.settings.name)} · Lv ${g.level}</b><i><u></u></i>${g.level >= 2 ? '<s class="ds-ult" title="Ultimate: charges as he fights"><u></u></s>' : ''}</div>
        <button class="ds-help-btn" data-act="help" title="How to fight (? or H)">❓ Help</button>
      </div>
      <div class="ds-hud ds-auto" title="The autopilot plays your side. Click anywhere in the arena to take over.">🤖 AUTOPILOT <small>click to take over</small></div>
      <div class="ds-hud ds-tools">
        ${tools}
        <div class="ds-mats">${mats}</div>
        <div class="ds-ink" title="Ink (refills over time)"><u></u></div>
        <button class="ds-tool ds-book-btn" data-act="book" title="Sketchbook: shapes that become weapons (B)"><span>📖</span><small>B</small></button>
      </div>
      <div class="ds-hud ds-book">
        <h3>📖 Sketchbook <small>draw roughly. Close is good enough</small></h3>
        <div class="ds-book-grid">${Object.entries(ITEMS).map(([k, it]) => `
          <div class="ds-card" data-item="${k}">
            <svg viewBox="0 0 64 44"><path d="${it.path}"/></svg>
            <b>${it.emoji} ${it.name}</b><i>${it.how}</i><span>${it.tip}</span>
          </div>`).join('')}</div>
        <p>Inks combine: a 🔥 fire spear burns him, an ❄️ ice crate freezes him. Anything else you draw is a physical object.</p>
      </div>
      <div class="ds-hud ds-help">
        <h3>❓ How to fight <button class="ds-x" data-act="help" title="Close (? or H)">✕</button></h3>
        <p class="ds-goal">Drain his <b class="o">orange bar</b> before he drains your <b class="b">blue bar</b>. He attacks your <b>cursor</b>: keep it moving!</p>
        <div class="ds-help-cols">
          <div>
            <h4>Tools</h4>
            <ul>
              <li><kbd>1</kbd> ✋ Hand: grab him (or anything) and throw</li>
              <li><kbd>2</kbd> ✏️ Pencil: draw a weapon (uses ink)</li>
              <li><kbd>3</kbd> 🧽 Eraser: rub him out</li>
              <li><kbd>4</kbd> 💣 Bomb: click to drop one</li>
              <li><kbd>5</kbd> ⚡ Lightning: click to strike, frees possessed apps</li>
            </ul>
            <h4>Inks</h4>
            <ul class="ds-inks">${Object.entries(MATERIALS).map(([k, m]) => `<li><kbd>${INK_KEYS[k]}</kbd><i style="background:${m.color}"></i>${m.label}</li>`).join('')}</ul>
            <h4>Buttons</h4>
            <ul>
              <li>App icons (top): summon an ally. ${tierKey}</li>
              <li>🩹 Repair: fix cracks · 🏳️ Truce or <kbd>Esc</kbd>: end the fight</li>
              <li><kbd>B</kbd> sketchbook · <kbd>?</kbd> this help</li>
            </ul>
          </div>
          <div>
            <h4>What to draw (with the ✏️ pencil)</h4>
            <div class="ds-help-shapes">${Object.entries(ITEMS).map(([k, it]) => `<div><svg viewBox="0 0 64 44"><path d="${it.path}"/></svg><span><b>${it.emoji} ${it.name}</b><i>${it.how}</i></span></div>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="ds-hud ds-bottom">
        <div class="ds-allies">${allies}</div>
        <button class="ds-btn" data-act="restore" title="Repair the cracks and bring back file copies">🩹 Repair</button>
        <button class="ds-btn" data-act="end" title="End the fight (Esc)">🏳️ Truce</button>
      </div>
      <div class="ds-hud ds-legend">
        <div class="ds-shapes" title="Draw these with the pencil">${shapes}</div>
        <div class="ds-keys"><span><kbd>1</kbd>–<kbd>5</kbd> tools</span><span><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> inks</span><span><kbd>B</kbd> sketchbook</span><span><kbd>?</kbd> help</span><span><kbd>Esc</kbd> truce</span></div>
      </div>
      <div class="ds-toast"></div>
      <div class="ds-hold">⏸ The fight starts when you close the help</div>
      <div class="ds-ultban"></div>
      <div class="ds-banner"><h1></h1><p></p></div>`;
  }

  bind() {
    const el = this.el;
    el.addEventListener('contextmenu', (e) => e.stopPropagation(), true);
    el.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        e.preventDefault();
        if (btn.dataset.tool) this.setTool(btn.dataset.tool);
        else if (btn.dataset.mat) { this.material = btn.dataset.mat; this.setTool('pencil'); }
        else if (btn.dataset.ally) this.summon(btn.dataset.ally);
        else if (btn.dataset.act === 'restore') this.restore();
        else if (btn.dataset.act === 'book') this.toggleBook();
        else if (btn.dataset.act === 'help') this.toggleHelp();
        else if (btn.dataset.act === 'end') this.g.endFight('truce');
        return;
      }
      if (e.target.closest('.ds-hud') || e.button !== 0) return;
      e.preventDefault();
      if (this.hold) this.toggleHelp(false);   // clicking into the arena starts the fight too
      if (this.auto) this.takeOver();
      try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
      this.down(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.auto) return;   // the autopilot owns the cursor
      this.g.pointer = { x: e.clientX, y: e.clientY };
      this.move(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', (e) => this.up(e.clientX, e.clientY));
    el.addEventListener('pointercancel', (e) => this.up(e.clientX, e.clientY));
  }

  destroy() {
    this.cancelInput();
    this.releaseKeys?.();
    this.el.remove();
  }

  // Drop whatever input is in progress without side effects: a half-drawn stroke vanishes
  // (no object), a held thing is let go with no throw, the eraser stops.
  cancelInput() {
    this.stroke = null;
    this.eraserOn = false;
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'stick' || d?.kind === 'app') d.o.release(0, 0);
    else if (d?.o.body) d.o.body.held = null;
  }

  takeOver() {
    this.auto.stop();
    this.auto = null;
    this.tookOver = true;
    this.el.classList.remove('ds-auto-on');
    this.toast('You took over. Good luck!');
  }

  toggleBook(on) {
    const b = this.$('.ds-book');
    const show = on ?? !b.classList.contains('show');
    b.classList.toggle('show', show);
    if (show) this.toggleHelp(false);   // also starts a first fight held by the help
  }

  toggleHelp(on) {
    const h = this.$('.ds-help');
    const show = on ?? !h.classList.contains('show');
    h.classList.toggle('show', show);
    if (show) this.$('.ds-book').classList.remove('show');
    else if (this.hold) { this.setHold(false); this.toast('FIGHT!', 1200); }
  }

  setHold(on) {
    this.hold = on;
    this.el.classList.toggle('ds-held', on);
  }

  flashUlt(title) {
    const b = this.$('.ds-ultban');
    b.textContent = '★ ' + title + ' ★';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.ultT);
    this.ultT = setTimeout(() => b.classList.remove('show'), 1600);
  }

  setTool(id) {
    this.tool = id;
    for (const b of this.el.querySelectorAll('.ds-tool')) b.classList.toggle('on', b.dataset.tool === id);
    for (const b of this.el.querySelectorAll('.ds-mat')) b.classList.toggle('on', b.dataset.mat === this.material);
    this.el.dataset.tool = id;
  }

  key(k) {
    if (k.type !== 'keydown' || k.inInput) return;
    if (k.key === 'Escape' && this.g.mode === 'ending') return this.g.cleanupFight();   // skip the result screen
    if (this.g.mode !== 'fight') return;
    if (k.key === 'Escape') return this.g.endFight('truce');
    if (k.key === 'b' || k.key === 'B') return this.toggleBook();
    if (k.key === '?' || k.key === 'h' || k.key === 'H' || k.key === 'F1') return this.toggleHelp();
    if (this.auto) return;   // watching: the other keys would fight the autopilot
    const n = parseInt(k.key, 10);
    if (n >= 1 && n <= TOOLS.length) this.setTool(TOOLS[n - 1].id);
    const mk = { q: 'ink', w: 'fire', e: 'ice', r: 'bouncy' }[k.key?.toLowerCase()];
    if (mk) { this.material = mk; this.setTool('pencil'); }
  }

  toast(text, ms = 2600) {
    const t = this.$('.ds-toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  banner(title, sub) {
    const b = this.$('.ds-banner');
    b.querySelector('h1').textContent = title;
    b.querySelector('p').textContent = sub;
    b.classList.add('show');
  }

  crash() {
    const c = document.createElement('div');
    c.className = 'ds-crash';
    c.innerHTML = `<div><div class="ds-crash-face">:(</div>
      <h2>Your desktop ran into a stickman and needs to restart.</h2>
      <p>Just kidding. This is only a drawing: no files, apps or settings were touched.</p>
      <p class="ds-crash-p">Restoring the illusion… <span>0</span>%</p>
      <p class="ds-crash-small">Stop code: STICKMAN_TOO_STRONG · Wins ${this.g.stats.wins} · Losses ${this.g.stats.losses}</p></div>`;
    this.el.append(c);
    let p = 0;
    const span = c.querySelector('span');
    const iv = setInterval(() => { p = Math.min(100, p + Math.round(rand(4, 14))); span.textContent = p; if (p >= 100) clearInterval(iv); }, 250);
  }

  // ---------------------------------------------------------------- tools
  pickAt(x, y) {
    const g = this.g;
    for (let i = g.objects.length - 1; i >= 0; i--) {
      const o = g.objects[i];
      if (o.kind === 'popup' && o.contains(x, y)) return { o, kind: 'popup' };
    }
    if (g.stick.distTo(x, y) < 14 && g.stick.st.devoured <= 0) return { o: g.stick, kind: 'stick' };
    for (const a of g.apps) if (a.contains(x, y)) return { o: a, kind: 'app' };
    for (let i = g.objects.length - 1; i >= 0; i--) {
      const o = g.objects[i];
      if (o.kind === 'popup' || o.dead) continue;
      if (o.heldBy && o.heldBy === g.stick) { if (o.contains(x, y, 10)) return { o, kind: 'stolen' }; continue; }
      if (o.contains(x, y, 10)) return { o, kind: 'obj' };
    }
    return null;
  }

  down(x, y) {
    const g = this.g;
    this.downAt = { x, y, t: performance.now() };
    // fake error dialogs block everything until you hit OK (or drag them away)
    for (let i = g.objects.length - 1; i >= 0; i--) {
      const o = g.objects[i];
      if (o.kind !== 'popup' || !o.contains(x, y)) continue;
      if (o.hitOk(x, y)) { o.dead = true; g.sfx('pop'); g.fx.burst(x, y, { count: 6, color: '#fff', speed: 100, life: 0.4, size: 3, gravity: 0 }); return; }
      if (this.tool === 'hand' || this.tool === 'eraser') break;
      this.toast('A fake error is in the way. Click OK, or drag it off with the Hand.');
      return;
    }
    switch (this.tool) {
      case 'hand': {
        const hit = this.pickAt(x, y);
        if (!hit) return;
        this.drag = { ...hit, hist: [] };
        g.noteMove('player', hit.kind === 'stick' ? 'grab him' : 'grab');
        if (hit.kind === 'stick') hit.o.grab(x, y);
        else if (hit.kind === 'app') hit.o.grab(x, y);
        else if (hit.kind === 'stolen') {
          g.stick.dropWeapon();
          hit.o.owner = 'user';
          hit.o.body.held = { x, y, ox: x - hit.o.body.x, oy: y - hit.o.body.y };
          g.brain.say(pick(['Hey! Give that back!', 'My sword!']), true);
        } else {
          const b = hit.o.body;
          if (hit.o.owner === 'stick') hit.o.owner = 'user';   // you grabbed it: now it's your weapon
          if (hit.o.kind === 'file') hit.o.knock(0, 0);
          b.static = false;
          b.held = { x, y, ox: x - b.x, oy: y - b.y };
        }
        break;
      }
      case 'pencil':
        if (g.ink < 3) { this.toast('Out of ink! Wait a second, or let Brushy (Paint) refill it.'); return; }
        this.stroke = { pts: [{ x, y }], material: this.material };
        break;
      case 'eraser': this.eraserOn = true; this.erase(x, y, 0.016); g.noteMove('player', 'eraser'); break;
      case 'bomb':
        if (this.cd.bomb > 0) return;
        this.cd.bomb = 1.1;
        g.addObject(new Bomb(x, y, 'user'));
        g.noteMove('player', 'bomb');
        break;
      case 'zap':
        if (this.cd.zap > 0) return;
        this.cd.zap = 1.6;
        this.zap(x, y);
        g.noteMove('player', 'lightning');
        break;
    }
  }

  move(x, y) {
    const g = this.g;
    const d = this.drag;
    if (d) {
      d.hist.push({ x, y, t: performance.now() });
      while (d.hist.length > 2 && performance.now() - d.hist[0].t > 90) d.hist.shift();
      if (d.kind === 'stick' || d.kind === 'app') d.o.dragTo(x, y);
      else if (d.o.body?.held) { d.o.body.held.x = x; d.o.body.held.y = y; }
    }
    if (this.stroke) {
      const last = this.stroke.pts[this.stroke.pts.length - 1];
      const L = Math.hypot(x - last.x, y - last.y);
      if (L > 3) {
        if (g.ink <= 0) return this.finishStroke();
        g.ink = Math.max(0, g.ink - L * 0.09);
        this.stroke.pts.push({ x, y });
        if (Math.random() < 0.15) g.sfx('draw');
      }
    }
  }

  // vel: the autopilot passes its throw velocity instead of a measured one
  up(x, y, vel = null) {
    const g = this.g;
    this.eraserOn = false;
    if (this.stroke) this.finishStroke();
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    let vx = 0, vy = 0;
    if (vel) ({ vx, vy } = vel);
    else if (d.hist.length >= 2) {
      const a = d.hist[0], b = d.hist[d.hist.length - 1];
      const dt = Math.max(0.016, (b.t - a.t) / 1000);
      vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt;
    }
    const quick = performance.now() - this.downAt.t < 220 && dist(x, y, this.downAt.x, this.downAt.y) < 6;
    if (d.kind === 'stick') {
      d.o.release(vx, vy);
      if (quick) d.o.hurt(4, rand(-200, 200), -300, { by: 'poke' });
      else if (Math.hypot(vx, vy) > 1100) g.brain.say(pick(['AAAAH!', 'Put me DOWN!', 'Cheater!']), true);
      d.o.thrownBy = 'user';
      this.thrownStick = 1.2;
    } else if (d.kind === 'app') d.o.release(vx, vy);
    else if (d.o.body) {
      const b = d.o.body;
      b.held = null;
      b.vx = clamp(vx, -2600, 2600); b.vy = clamp(vy, -2600, 2600);
      b.w = rand(-6, 6);
    }
  }

  finishStroke() {
    const g = this.g;
    const st = this.stroke;
    this.stroke = null;
    if (!st || st.pts.length < 2) return;
    let L = 0;
    for (let i = 1; i < st.pts.length; i++) L += Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].y - st.pts[i - 1].y);
    if (L < 12) return;
    const obj = new Drawn(st.pts, st.material, 'user');
    const rec = classify(st.pts, g.stick);
    g.addObject(obj);
    g.noteMove('player', rec ? 'draw ' + rec.kind : 'draw');
    if (rec) {
      const it = ITEMS[rec.kind];
      makeItem(g, obj, rec.kind, rec.info, 'user');
      g.fx.popText(obj.body.x, obj.body.y - 30, `${it.emoji} ${it.name.toUpperCase()}!`, '#fff3b0', 18);
      g.fx.burst(obj.body.x, obj.body.y, { count: 10, color: ['#fff3b0', '#ffd166'], speed: 160, life: 0.5, size: 3, gravity: 0 });
      g.sfx('pop');
      this.highlight(rec.kind);
      g.brain.onUserItem?.(rec.kind);
    } else if (obj.isStick && Math.random() < 0.3) this.toast('A stick! Grab it with the Hand and swing it… but he can steal it too.');
  }

  highlight(kind) {
    for (const c of this.el.querySelectorAll(`[data-item="${kind}"]`)) {
      c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit');
    }
  }

  erase(x, y, dt) {
    const g = this.g;
    const R = 18;
    for (const o of g.objects) {
      if (o.kind === 'drawn' && !o.dead && o.body.distTo(x, y) < R) {
        if (o.heldBy) o.heldBy.dropWeapon();
        o.dead = true;
        g.fx.burst(o.body.x, o.body.y, { count: 8, color: '#ddd', type: 'dust', speed: 60, life: 0.5, size: 5, gravity: -20 });
      }
      if (o.kind === 'popup' && o.contains(x, y)) o.dead = true;
    }
    const s = g.stick;
    if (s.distTo(x, y) < R && s.st.devoured <= 0) {
      s.glitch = 1;
      this.eraseAcc = (this.eraseAcc || 0) + dt * 22;
      if (this.eraseAcc > 3) { s.hurt(this.eraseAcc, 0, 0, { force: true, invuln: 0, by: 'eraser' }); this.eraseAcc = 0; }
      g.fx.burst(x, y, { count: 2, color: g.settings.color, type: 'debris', speed: 80, life: 0.4, size: 3, gravity: 300 });
      if (Math.random() < dt * 0.8) g.brain.say(pick(['Stop erasing me!', 'My leg! Where\'s my leg?!', 'I\'m fading!']), true);
    }
  }

  zap(x, y) {
    const g = this.g;
    g.fx.bolt(x + rand(-60, 60), 0, x, y);
    g.fx.ring(x, y, 70, 'rgba(180,220,255,0.9)', 0.35);
    g.fx.sparks(x, y, '#cde8ff', 16);
    g.sfx('zap');
    const s = g.stick;
    if (s.distTo(x, y) < 45 && s.st.devoured <= 0) {
      s.hurt(16, rand(-300, 300), -500, { force: true, by: 'zap' });
      s.st.stun = 0.8;
      s.glitch = 1;
    }
    for (const a of g.apps) {
      if (dist(a.center.x, a.center.y, x, y) > 60) continue;
      if (a.possessed > 0) { a.possessed = 0; a.say(pick(['Thanks! I was possessed!', 'Ouch… but I\'m free!'])); a.hurt(4, 0, -300); }
      else a.hurt(3, 0, -200);
    }
    for (const o of g.objects) {
      if (o.kind === 'file' && !o.broken && dist(o.body.x, o.body.y, x, y) < 50) o.damage(g, 1);
      if (o.kind === 'drawn' && o.heldBy && o.body.distTo(x, y) < 40) o.heldBy.dropWeapon(0, -300);
    }
  }

  summon(kind) {
    const g = this.g;
    if (this.cd.summon > 0) { this.toast(`Summon is recharging (${Math.ceil(this.cd.summon)}s)`); return; }
    this.cd.summon = 5;
    const a = g.summonApp(kind, clamp(g.pointer.x > 0 ? g.pointer.x : g.w / 2, 60, g.w - 60));
    g.noteMove('player', 'summon ' + kind);
    const T = TIERS[a.tier];
    this.toast(`${a.name} joins the fight. ${APPS[kind].title} · ${T.badge} ${T.label}${a.L.sig ? ' · signature: ' + a.L.sig : ''}.`);
  }

  restore() {
    const g = this.g;
    if (this.cd.restore > 0) { this.toast(`Repair is recharging (${Math.ceil(this.cd.restore)}s)`); return; }
    this.cd.restore = 18;
    g.restoreDesktop(false);
    g.noteMove('player', 'repair');
    g.fx.flash(0.2, '#d6f5ff');
    this.toast('Cracks repaired. File copies rebuilt.');
  }

  update(dt) {
    const g = this.g;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.auto?.update(dt);
    if (this.eraserOn) this.erase(g.pointer.x, g.pointer.y, dt);
    if (this.drag && (this.drag.kind === 'stick' || this.drag.kind === 'app')) this.drag.o.dragTo(g.pointer.x, g.pointer.y);
    if (g.ff) return;   // fast-forward (tests): skip the DOM
    const s = g.stick;
    this.setStyle('.ds-you u', 'width', Math.round(clamp(g.deskHp, 0, 100)) + '%');
    this.setStyle('.ds-him > i u', 'width', Math.round(clamp((s.hp / s.maxHp) * 100, 0, 100)) + '%');
    this.setStyle('.ds-ult u', 'width', Math.round(g.brain.ult) + '%');
    this.setStyle('.ds-ink u', 'height', Math.round((g.ink / g.maxInk) * 100) + '%');
    for (const b of this.el.querySelectorAll('.ds-tool')) {
      const id = b.dataset.tool;
      b.classList.toggle('cool', (id === 'bomb' && this.cd.bomb > 0) || (id === 'zap' && this.cd.zap > 0));
    }
    this.el.classList.toggle('ds-cool-summon', this.cd.summon > 0);
    this.el.classList.toggle('ds-ult-full', g.brain.ult >= 100);
  }

  // DOM writes only when the value changed (every write recomposites the whole screen)
  setStyle(sel, prop, v) {
    const n = this.$(sel);
    if (n && n.style[prop] !== v) n.style[prop] = v;
  }

  drawBack(gx) {
    // a faint red vignette so it's obvious you're in a fight
    const g = this.g;
    const grad = gx.createRadialGradient(g.w / 2, g.h / 2, Math.min(g.w, g.h) * 0.35, g.w / 2, g.h / 2, Math.max(g.w, g.h) * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(120,0,20,${0.12 + (1 - g.deskHp / 100) * 0.25})`);
    gx.fillStyle = grad;
    gx.fillRect(0, 0, g.w, g.h);
  }

  drawFront(gx) {
    const g = this.g;
    if (this.stroke) drawInk(gx, this.stroke.pts, this.stroke.material);
    if (this.auto) this.auto.draw2d(gx);
    const p = g.pointer;
    gx.save();
    gx.lineWidth = 1.5;
    if (this.tool === 'eraser') {
      gx.strokeStyle = 'rgba(255,255,255,0.9)';
      gx.setLineDash([4, 3]);
      gx.beginPath(); gx.arc(p.x, p.y, 18, 0, TAU); gx.stroke();
    } else if (this.tool === 'zap' || this.tool === 'bomb') {
      const ready = this.cd[this.tool] <= 0;
      gx.strokeStyle = ready ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.35)';
      gx.beginPath(); gx.arc(p.x, p.y, 14, 0, TAU);
      gx.moveTo(p.x - 20, p.y); gx.lineTo(p.x - 8, p.y); gx.moveTo(p.x + 8, p.y); gx.lineTo(p.x + 20, p.y);
      gx.moveTo(p.x, p.y - 20); gx.lineTo(p.x, p.y - 8); gx.moveTo(p.x, p.y + 8); gx.lineTo(p.x, p.y + 20);
      gx.stroke();
    } else if (this.tool === 'pencil') {
      gx.fillStyle = MATERIALS[this.material].color;
      gx.beginPath(); gx.arc(p.x, p.y, 3.5, 0, TAU); gx.fill();
    }
    gx.restore();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
