// The widget's own little glass card: stats, mood and the buttons to care for him.
const ACTS = {
  idle: 'chilling', wander: 'exploring your desktop', sit: 'sitting on a widget', sleep: 'sleeping 💤',
  eat: 'eating a cookie', ball: 'playing ball', chat: 'chatting with an app', doodle: 'drawing something',
  pushup: 'working out', dance: 'dancing', flip: 'showing off', parkour: 'doing parkour',
  summon: 'bringing an app to life', files: 'playing with file copies', prank: 'up to something…',
  tip: 'bullying an app', follow: 'chasing your cursor', complain: 'complaining', grab: 'grabbing a weapon',
};

export class Nest {
  constructor(ctx, game) {
    this.ctx = ctx;
    this.g = game;
    ctx.root.innerHTML = `
      <div class="nest">
        <div class="nest-head">
          <span class="nest-mood">🙂</span>
          <b class="nest-name"></b>
          <span class="nest-lv"></span>
          <span class="nest-rec ws-muted"></span>
        </div>
        <div class="nest-bars">
          <label title="Energy">⚡<i><u class="b-energy"></u></i></label>
          <label title="Fun">🎈<i><u class="b-fun"></u></i></label>
          <label title="Food">🍪<i><u class="b-food"></u></i></label>
        </div>
        <div class="nest-status ws-muted"></div>
        <div class="nest-btns">
          <button class="ws-btn" data-a="feed" title="Drop a cookie">🍪</button>
          <button class="ws-btn" data-a="pet" title="Pet him">✋</button>
          <button class="ws-btn" data-a="ball" title="Throw a ball">⚽</button>
          <button class="ws-btn" data-a="app" title="Bring one of your apps to life">📦</button>
          <button class="ws-btn primary" data-a="fight" title="Start a fight (Animator vs Animation!)">⚔️ Fight</button>
        </div>
      </div>`;
    this.$ = (s) => ctx.root.querySelector(s);
    ctx.root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'feed') game.feed();
      else if (a === 'pet') game.pet();
      else if (a === 'ball') game.ball();
      else if (a === 'app') game.summonApp();
      else if (a === 'fight') game.startFight();
    });
    ctx.every(400, () => this.update());
    this.update();
  }

  update() {
    const g = this.g, S = g.stats, s = g.stick;
    this.text('.nest-name', g.settings.name);
    this.text('.nest-lv', `Lv ${S.level}`);
    this.text('.nest-rec', `W ${S.wins} · L ${S.losses}`);
    for (const k of ['energy', 'fun', 'food']) {
      const u = this.$('.b-' + k);
      const w = Math.round(S[k]) + '%';
      if (u.style.width !== w) u.style.width = w;
      if (u.classList.contains('low') !== S[k] < 25) u.classList.toggle('low', S[k] < 25);
    }
    let mood = '🙂';
    const avg = (S.energy + S.fun + S.food) / 3;
    if (g.mode === 'fight') mood = '⚔️';
    else if (g.challenge) mood = '😤';
    else if (s.action?.name === 'sleep') mood = '😴';
    else if (S.anger > 55) mood = '😠';
    else if (S.food < 20) mood = '😋';
    else if (S.energy < 20) mood = '🥱';
    else if (avg > 75) mood = '😄';
    else if (avg < 35) mood = '😕';
    this.text('.nest-mood', mood);
    let st;
    const c = g.cleanup;
    if (g.mode === 'chill' && c.active && c.jobs.length) {
      const text = `Binny is cleaning up 🧹 · ${c.jobs.length} left`;
      this.text('.nest-status', text);
      this.setDisabled(false);
      return;
    }
    if (g.mode === 'fight') st = `fighting${g.arena?.auto ? ' the autopilot' : ''}! HP ${Math.round(s.hp)}/${s.maxHp}`;
    else if (g.challenge) st = 'wants to fight — click him!';
    else if (s.ragdolled) st = 'flying around';
    else st = ACTS[g.brain.act?.name] || 'chilling';
    this.text('.nest-status', `${g.settings.name} is ${st}`);
    this.setDisabled(g.mode !== 'chill');
  }

  // Write to the DOM only when the value changed: every write makes the host recomposite the
  // whole screen, and this runs every 400 ms.
  text(sel, v) {
    const n = this.$(sel);
    if (n.textContent !== v) n.textContent = v;
  }
  setDisabled(on) {
    const b = this.$('[data-a="fight"]');
    if (b.disabled !== on) b.disabled = on;
  }
}
