# DeskSprite ticket tracker

A Jira-style workflow for the DeskSprite dev team: **developer**, **QA tester** and **code reviewer**
agents, coordinated by the WidgetSystem session (the PM).

**Statuses:** `Open` → `In Progress` → `In Review` (developer done) → `Ready for QA` (reviewer approved)
→ `Accepted` (QA verified) or `Reopened` (back to the developer, with the reason).

**Rules:**
- Only QA sets `Accepted`.
- Only the reviewer moves `In Review` → `Ready for QA`. Otherwise the reviewer sets `Changes requested`.
- Every change of status adds a line to the ticket's **History**: `date · role · status · note`.
- QA files new tickets as `DS-<n>` with type, severity, steps or observation, and acceptance criteria.

---

## DS-1 · Autopilot / spectator fights (no player needed)
- **Type:** Feature · **Severity:** High · **Status:** Accepted · **Reporter:** user (via PM)
- **Description:** The user wants to watch fights without playing, and QA needs to test fights
  without a human. Add an autopilot for the player's side:
  - It draws weapons with sensible ink use.
  - It uses the arena tools (pencil shapes, eraser, bomb, lightning, repair) the way a decent
    human player would, with a little randomness.
  - It summons allies.
- Start it with `widgetctl send desksprite '{"cmd":"fight","autopilot":true}'` and a menu item
  "Watch a fight (autopilot)".
- Expose a debug summary at `window.__desksprite[id].fightReport()`: duration, damage both
  ways, moves used, level, winner, leftover objects.
- **Acceptance:**
  - A fight with autopilot runs to the end with no input.
  - It lasts 45–150 s at levels 1–5.
  - It is varied to watch (several different moves from both sides).
  - `fightReport()` returns the stats.
- **Dev notes:**
  - New `src/ui/autopilot.js` (class `Autopilot`). It steers a virtual cursor (drawn as a 🤖 arrow) and calls the
    same `Arena` methods a player triggers (`down/move/up`, `summon`, `restore`), so every tool goes through the
    real code paths. It draws 10 sketch shapes (spear, rocket, shuriken, lightning, bow, boomerang, wave, tornado,
    shield, cage/crate; verified 300/300 recognized by `classify()`), only when it has the ink, and 12% of strokes
    are sloppy on purpose. It drops bombs and lightning with some aiming error, erases or zaps his stolen weapon,
    slams him with the hand, clicks OK on fake errors, frees possessed apps, repairs when the desktop is low, and
    summons allies (Brushy when ink/desk is low, otherwise weighted by tier). It reacts to his shots and his final
    beam after 0.16–0.38 s, and decides every 2.4–3.8 s.
  - Start: menu item "Watch a fight (autopilot)" (`main.js`) or `widgetctl send desksprite '{"cmd":"fight","autopilot":true}'`
    (optional `"level": N` fights at another level without touching his stats). HUD shows "🤖 AUTOPILOT"; clicking
    anywhere in the arena takes over. Autopilot (and level-override) fights are exhibitions: no W/L/XP.
  - `window.__desksprite[id].fightReport()`: level, autopilot, mode, winner, duration, damage both ways
    (`toStick`, `toDesk`, plus `bySource` / `deskBySource`), end hp, `moves` per side (stick / player / ally),
    `variety` (distinct moves per side), `leftovers` (`atEnd`, `now`, open cracks) and the cleanup summary.
  - Test helpers on the same object: `fastForward(secs)` (no painting) and `bench(level, runs)` → `benchResults`
    (fast-forwarded autopilot fights, each followed by 60 s of cleanup; his saved stats are restored afterwards).
  - Files: `src/ui/autopilot.js` (new), `src/ui/arena.js`, `src/game.js`, `main.js`, `style.css`.
  - Verify: send the command above, watch; or in eval `G.bench(3, 3).then(r => window.R = r)` then read `R`.
    Typical variety per fight: 11–19 distinct stick moves, 6–13 player moves, 4–8 ally abilities.
- **Review:**
  - `node --check` passes on every changed file. No file, shell or app access added. No new `shadowBlur` or canvas
    filters. The design is good: going through the real `Arena` methods means the autopilot exercises the same
    code paths as a player.
  - **Bug (blocker): he stays pinned in mid-air after the fight.** If the fight ends while `throwHim` holds him
    (`arena.drag.kind === 'stick'`), `Autopilot.update` stops at `mode !== 'fight'` (`src/ui/autopilot.js:66`), and
    `stop()` (`autopilot.js:62`) only finishes a stroke. Nobody calls `release()`, so `rag.pin` is never cleared,
    and `startGetup` needs `!rag.pin` (`src/stickman/stickman.js:196`). Reproduced in an isolated instance:
    `A.task = A.throwHim()`, step until held, `endFight('truce')`. 13 s after the cleanup he is still
    `mode: 'ragdoll'` with `pin` set, hanging where the virtual cursor was.
  - **Bug: a stroke in progress becomes a permanent leftover.** `cleanupFight` calls `this.cleanup.start()`
    (`src/game.js:592`) before `this.arena?.destroy()` (`game.js:597`), and `destroy()` → `auto.stop()` → `a.up()`
    → `finishStroke()` adds a new `Drawn` (life ∞) after the cleanup snapshot. That drawing has no ticket and Binny
    never collects it. If it is recognized, `makeItem` launches a real weapon in chill mode. Reproduced: one
    `{life: Infinity, cleanup: false}` drawing left after the fight.
  - **Bug: aborting a task leaves the tool engaged.** The beam dodge sets `this.task = null` from a timer
    (`autopilot.js:138`). If a stroke, eraser or throw started in the meantime, `arena.stroke`, `eraserOn` or
    `drag` stays on. A stuck eraser keeps rubbing at the virtual cursor, and a stuck drag carries him around, until
    the next `a.up()`.
  - **Stats rule broken:** exhibition fights still run `S.anger = 0; S.fun += 30; this.save()` (`game.js:572-574`).
    Verified: anger 50 → 0 and fun 20 → 50 in shared storage after an autopilot truce. The allies the autopilot
    summons are also saved into `stats.apps` by `save()` (`game.js:199`) and stay after the fight.
  - **`bench()` doesn't restore everything:** `Object.assign(this.stats, saved)` is followed by `this.save()`
    (`game.js:855`), and `save()` rebuilds `stats.apps` from the live `this.apps`. Benched fights summon and retire
    apps (`game.js:414`). Verified: roster `[folder, clock, music, mail]` → `[music, mail, settings]` after
    `bench(3, 2)`, both live and saved. W/L/XP/level/needs were restored correctly.
  - Minor:
    - `fastForward` uses a raw `setTimeout(step, 0)` (`game.js:842`), which isn't cancelled on unmount. Use
      `this.ctx.after(0, step)`.
    - After "click to take over", the fight is still an exhibition, but the banner says "AUTOPILOT WINS" even when
      the human played and won.
    - Style is consistent with the codebase and readable.
  - **Required changes:**
    1. Make `Autopilot.stop()` abort cleanly. Drop an open stroke without creating an object (`a.stroke = null`),
       release a drag (`a.up(x, y, {vx: 0, vy: 0})` or `drag.o.release(0, 0)`), and clear `eraserOn`. Call it
       whenever a task is cancelled, the beam-dodge timer included.
    2. Stop the autopilot when the fight ends (in `endFight`, or the first time `update` sees `mode !== 'fight'`),
       so nothing is held or half-drawn during the result screen. Also release any arena drag in `cleanupFight`
       before `cleanup.start()`; that covers a human holding him too.
    3. Exhibitions must not change saved stats: skip the anger and fun changes and the `save()` in `endFight` when
       `this.exhibition` is set. Restore the pre-fight app roster afterwards, or don't persist allies the autopilot
       summoned.
    4. `bench()`: save `this.apps.map(a => a.kind)` (and `deskHp`) before the runs and restore them afterwards, so
       the saved and live roster are unchanged.
- **Dev notes (round 2):**
  - `Autopilot.stop()` now aborts cleanly through the new `Arena.cancelInput()`. That drops a half-drawn stroke
    without creating an object, lets go of anything held with no throw (`release(0, 0)`, so `rag.pin` is cleared),
    and turns the eraser off. It runs:
    - in `endFight`;
    - in `update` the first time it sees `mode !== 'fight'`;
    - when the beam-dodge timer cancels a task (only if this autopilot is still the arena's).
  - `cleanupFight` calls `arena.cancelInput()` before the leftover snapshot (which covers a human holding him
    too), and `Arena.destroy()` uses it as well, so a stroke can no longer turn into an untracked drawing.
  - Exhibitions leave saved state alone:
    - no anger/fun change and no `save()` in `endFight`;
    - `save()` writes the pre-fight roster while one runs (`rosterLock`);
    - in `cleanupFight`, `endExhibition()` sends home the apps summoned during it (`app.exhibit`) and brings back
      any it retired (`restoreRoster`).
  - `bench()` now also restores the app roster (live and saved) and the desk hp, and cancels any running cleanup.
  - Minor: `fastForward` uses `ctx.after(0, step)`. After "click to take over", a human win shows "YOU WIN"
    (still marked as an exhibition).
  - Verified in an isolated instance:
    - autopilot holding him at `endFight('truce')`: pin false right after the end, `ground` 12 s later;
    - a stroke in progress at fight end: no new object, 0 untracked drawings;
    - roster `[folder, clock, music, mail]` unchanged live and saved after an exhibition that summoned Guardian,
      and after `bench(3, 2)`;
    - anger/fun not reset (only normal chill drift);
    - W/L/fights/XP/level unchanged.
- **Review (round 2):**
  - All 4 required items are fixed. Re-checked in an isolated instance (port 47871):
    1. **Clean abort:** `Autopilot.stop()` now goes through `Arena.cancelInput()` (`src/ui/autopilot.js:63`,
       `src/ui/arena.js:172-179`). `cancelInput` mirrors `up()` without the throw. The beam-dodge timer is guarded
       and uses `stop()` (`autopilot.js:142`).
    2. **Fight end:** `stop()` runs in `endFight` (`src/game.js:555`) and in `update` once the fight is over
       (`autopilot.js:70`). `cleanupFight` calls `cancelInput` before the snapshot. Results:
       - autopilot holding him at `endFight('truce')` → pin false right away, `ground` 12 s later;
       - a human hand holding him at the end → pin false, `ground`;
       - a stroke in progress at the end → 0 drawings, 0 untracked.
    3. **Exhibitions:** roster `[folder, clock]` with anger 50 and fun 20. The autopilot summoned 2 allies, which
       were marked `exhibit`, and the saved roster stayed `[folder, clock]` during the fight (`rosterLock`). After
       a truce the live and saved rosters were both `[folder, clock]`, anger was 49.9 (chill drift only), fun 20,
       and fights/wins/XP unchanged.
    4. **`bench()`:** a 6-app roster survived `bench(2, 1)`, live and saved.
  - Minor items done: `fastForward` uses `ctx.after`; the banner after a take-over says "YOU WIN".
  - **Regression (new, small):** `restoreRoster()` (`game.js:625-634`) re-summons missing kinds through
    `summonApp(k, …, true)`. In chill, that retires the oldest app once there are 4 non-temp apps
    (`game.js:416-419`). A normal fight can leave up to 6 apps, so a larger roster comes back wrong.
    - Reproduced: `want = [folder, clock, music, mail, chat, code]`, then removing `music` and `mail` and calling
      `restoreRoster(want)` → `[chat, code, music, mail]`, saved the same way. `folder` and `clock` were lost.
    - Real path: an exhibition with 5–6 apps where ≥3 are "not responding". The autopilot summons (allies < 4),
      which retires one at the fight cap, and `endExhibition` → `restoreRoster` then retires another. `bench()`
      uses the same path.
    - This is rare, but it breaks the "exhibitions leave the roster alone" guarantee this round adds.
  - **Required change:**
    1. Have `restoreRoster` summon without retiring, e.g. a `noRetire` option on `summonApp` (like `temp`, which
       already skips the cap but is also excluded from saving). Then the restored list matches `kinds` exactly,
       whatever its size.
- **Dev notes (round 3):**
  - `summonApp` takes a `noRetire` option, and `restoreRoster()` uses it. Putting a saved roster back (after an
    exhibition, after `bench()`) no longer retires apps through the 4-app cap.
  - Verified in an isolated instance with the 6-app roster `[folder, clock, chat, code, music, mail]`. All six
    came back, live and saved, in three cases:
    - after removing 2 and calling `restoreRoster`;
    - after `bench(3, 1)`;
    - after an exhibition that summoned Guardian and Bash (which retired two of them during the fight).
- **Review (round 3):**
  - Fixed. `summonApp` skips retiring when `opts.noRetire` is set (`src/game.js:417`), and `restoreRoster` passes it
    (`game.js:633`). Apps restored this way are not `temp`, so they are saved as they should be. `node --check` passes.
  - Re-checked in an isolated instance (port 47871) with a 6-app roster:
    - my round-2 reproduction (remove 2, `restoreRoster(want)`) → all 6 back, live and saved;
    - the real path: an exhibition with 3 apps "not responding" and an autopilot summon that retired one at the
      fight cap → after the truce, the 6 originals were back and the summoned ally was gone, live and saved;
    - `bench(3, 1)` → roster unchanged, live and saved; every other stat unchanged.
  - No code review findings remain on DS-1.
  - Status stays **Reopened**, not Ready for QA: QA reopened DS-1 for the 45–150 s duration criterion (see QA
    below and DS-9), and round 3 doesn't address it. The balance fix goes through review again once it's in.
- **QA:**
  - Setup: isolated instance (port 47861) with fsck and two clocks. Real-time fights at L1, L3 and L5 ran on the
    round-1 code (23:22–23:31). The benches and a second real-time L3 fight ran on the round-2 code (from 23:39).
    Round 3 was not re-tested. Evidence is in
    `scratchpad/qa/`:
    `L1a_*`, `L3a_*`, `L5a_*` (snapshots every 6 s plus traces), `L3b_*` (per-second trace, a snapshot every 5 s),
    and `bench_L1..L5.json` (round 2).
  - **Runs to the end with no input:** pass. Every fight finished: 5 in real time and 112 in benches (two rounds
    of 56).
  - **`fightReport()`:** pass. It returns every field, and the `cleanup` summary updates live.
  - **Varied to watch:** pass.
    - Distinct moves per fight in the round-2 bench: stick 7–19, player 5–14, allies 3–7.
    - Real time: L1 9/9/5, L3 16/13/3, L5 18/11/4, L3 (round 2) 14/7/2.
    - Per-second trace: the longest stretch without a hit on either side was 3 s.
    - Readable moments: the "★ INK STORM ★" banner, "TORNADO!" labels, damage numbers, fake error dialogs the
      autopilot clicks away, the Final Form beam, and the "Your desktop ran into a stickman" blue screen when he
      wins.
  - **Lasts 45–150 s at levels 1–5:** fail.
    - Round-2 bench: 5 of 56 fights ended under 45 s (L3 35.3 s; L4 28.1 s and one more; L5 34.4 s and one
      more). Round 1: 10 of 56, including L3 at 27.5 s and 28.4 s.
    - Real time (round 2, L3): he won in 41.5 s. The desk fell 100 → 84 in the first second and to 62 by 7 s.
      The autopilot had a single ally (Cog) until 38 s.
    - Causes seen:
      - Autopilot fights skip the 2 starter allies that a human fight gets (`startFight`: `if (!opts.autopilot)`),
        so the player's side starts thin.
      - The stomps come from an opening burst plus an Ink Storm as soon as the ultimate unlocks at 25 s. In the
        27.5 s fight: 67 spike and 32 blast damage to the desk.
  - **Verdict: Reopened.** To pass: a bench of L1×10, L3×20 and L5×10, plus real-time fights, with no fight under
    45 s. Possible fixes: give autopilot fights the same 2 starter allies, soften his first ~10 s, or delay the
    first ultimate. Balance across levels is tracked in DS-9.
- **Dev notes (round 4, QA reopen: duration and starter allies):**
  - Autopilot fights get the same 2 starter allies as a human fight (`startFight`; `opts.noAllies` is only for
    the duel test helper).
  - Pacing, so no fight is decided in seconds and none drags past ~145 s (`src/game.js`, `pace` / `paceIn`):
    - **Opening:** both sides ramp from 45% to full damage over the first ~44 s.
    - **Ultimates:** none before 50 s.
    - **Comeback window:** at desk < 35 hp, or his hp < 30%, hits on that side count ×0.5 before 60 s and ×0.8
      after.
    - **Overtime:** from 100 s every hit grows (×2 at 130 s) and the comeback windows close; a toast announces it.
    - **Safety net:** no knockout before 45 s (hp stops at 1). It rarely triggers, because the pacing above
      already keeps fights longer.
  - Also: brain cooldowns reset at every fight start. Possessed apps' damage on the cursor uses the tier only,
    not the ally calibration factor.
  - Measured (fast-forward bench, every fight from the same start: no roster, the 2 random starter allies,
    100 fights per level on the final code):

    | level | wins | duration (min–max) | under 45 s |
    |---|---|---|---|
    | 1 | 19% | 75–143 s | 0 |
    | 2 | 24% | 53–120 s | 0 |
    | 3 | 44% | 66–129 s | 0 |
    | 4 | 52% | 64–126 s | 0 |
    | 5 | 70% | 52–138 s | 0 |

    Over all ~1,500 bench fights since the pacing went in, none was under 45 s.
  - Real-time L3 autopilot fight: see History.
  - Verify: `G.bench(L, 50)` per level → `benchResults` (each has `duration`, `winner`, `aboveBottom200`).
- **Review (round 4):**
  - Starter allies: autopilot fights now get the 2 starter allies. The summon timer checks `mode === 'fight'`, so
    a quick truce doesn't spawn them into chill. In an exhibition they are marked `exhibit` and go home afterwards
    (round-2 roster logic, still intact). `noAllies` can only be set by the debug helpers, not by `onMessage`.
  - Pacing (`src/game.js` `pace` / `paceIn` / `koFloor` / `overtime`): applied once on each side, desk damage in
    `hitDesk` and his damage in `Stickman.hurt`. The KO floor covers every hp write, burn included (I grepped
    every `hp =` and `deskHp =`). The overtime toast fires once at 100 s.
  - Re-checked: `bench(3, 10)` in an isolated instance (port 47871) gave durations of 79–118 s, so none under
    45 s. Variety was stick 16–22, player 10–15, allies 3–4; 0 leftovers 60 s after every fight. Wins 6/10 (n=10,
    within the noise the developer reports).
  - Watch for QA: a fight that ends while he levitates leaves him floating in chill (DS-12, required fix there).
    Autopilot fights hit it too.
  - No findings on DS-1. Verdict: Ready for QA.
- **QA (round 2):**
  - Setup: isolated instance (port 47862) with fsck, two clocks, sysmon and Mochi. The code did not change while
    I tested (no `[reload]` lines in the log). Evidence is in `scratchpad/qa2/`.
  - Bench: 1,000 autopilot fights, 2 × 100 per level (`bench_L*_a/b.json`).
    - Under 45 s: 0 of 1,000. The shortest were L5 46.0 s and L3 50.6 s.
    - Over 150 s: 1 of 1,000 (L1, 153.3 s). Medians were L1 117 s, L2 87 s, L3 94 s, L4 95 s, L5 92 s.
    - Every fight ran to the end with no input. 0 leftovers 60 s after every fight.
    - Distinct moves per fight: stick 8–23, player 7–18, allies 1–7.
  - Real-time fights, traced every second with a snapshot every 5 s:

    | level | result | duration | longest stretch with no hit | variety (stick/player/ally) |
    |---|---|---|---|---|
    | 3 (`L3_*`) | he won with 26/300 hp left | 119.2 s | 8 s | 20/14/2 |
    | 5 (`L5_*`) | he won with 78/310 hp left | 107.6 s | 6 s | 20/11/4 |
    | 1 (`L1_*`) | autopilot won, desk 72 left | 122.9 s | 6 s | 13/12/4 |

  - Starter allies: every autopilot fight now opens with 2 allies. In an exhibition they are marked `exhibit` and
    go home afterwards; the roster `[trash]` came back as `[trash]`.
  - As a viewer: L3 and L5 are good to watch with nobody playing. Both went down to the last few hp, he uses the
    whole screen now (levitating, perching on widgets), and the ★ INK STORM ★ / ★ FINAL FORM ★ banners and fake
    dialogs give readable beats. L1 is long and low-stakes; filed as DS-16.
  - **Verdict: Accepted.** 0 of 1,000 fights under 45 s; the single 153 s L1 fight is noise-level and is tracked
    in DS-16.
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Changes requested · he stays pinned if the fight ends mid-throw; a stroke at fight end leaves an uncleaned drawing; exhibitions change anger, fun and apps; bench doesn't restore apps
  - 2026-11-17 · developer · In Review · review round 1 fixed, see Dev notes (round 2)
  - 2026-11-17 · reviewer · Changes requested · round 2: all 4 items verified fixed; one new regression: restoreRoster retires roster members when the roster is above the chill cap of 4
  - 2026-11-17 · QA · Reopened · 6 of 58 round-2 fights end under 45 s (min 28.1 s; real-time L3 41.5 s); autopilot fights skip the 2 starter allies; everything else passes
  - 2026-11-17 · developer · In Review · restoreRoster no longer retires apps (noRetire), verified with 6 apps
  - 2026-11-17 · QA · Reopened · round 3 fixes only restoreRoster; the 45–150 s criterion is still open (see QA); round 3 still needs review
  - 2026-11-17 · reviewer · Reopened (unchanged) · round 3: noRetire verified (6-app restoreRoster, exhibition retire path, bench); no review findings left; still open on QA's duration criterion
  - 2026-11-18 · developer · In Review · QA reopen fixed: starter allies, pacing (ramp, comeback, overtime, no KO before 45 s); 0 of 500 final bench fights under 45 s
  - 2026-11-18 · developer · In Review · real-time L3 autopilot fight: 104.9 s, autopilot won with the desk at 2 hp; variety 18/12/3; 37% of the time above the bottom 200 px
  - 2026-11-18 · reviewer · Ready for QA · round 4: starter allies and pacing reviewed; bench 79–118 s, none under 45 s
  - 2026-11-18 · QA · Accepted · 1,000 bench fights: 0 under 45 s, 1 at 153 s (L1); real-time L1/L3/L5 108–123 s, close and readable

## DS-2 · Stickman feels weak at level 3; level scaling
- **Type:** Balance · **Severity:** High · **Status:** Accepted · **Reporter:** user
- **Description:** "My stickman is just lvl 3 but he seems weak." Make each level noticeably stronger:
  - hp / armor
  - damage
  - move frequency and variety
  - the level-gated moves land more
  - smarter dodging
  - bigger "ultimate" moments at higher levels

  He should win roughly 35–50% of autopilot fights at his current level, never trivially.
- **Acceptance:** QA runs at least 3 autopilot fights at levels 1, 3 and 5. The win rates and
  durations are logged in the ticket. Level 3 is clearly stronger than level 1.
- **Dev notes:**
  - `power(level)` in `src/stickman/brain.js` is the level table (stored as `game.power` for the fight):

    | level | hp | armor | damage | dodge chance | reaction | decisions/s | ultimate |
    |---|---|---|---|---|---|---|---|
    | 1 | 265 | 0 | ×1.00 | 40% | 0.26 s | ×1.00 | none |
    | 2 | 268 | 7% | ×1.25 | 50% | 0.22 s | ×1.16 | Overcharge (3 homing blasts) |
    | 3 | 272 | 17% | ×1.60 | 63% | 0.18 s | ×1.32 | Ink Storm (7 fire spikes from the sky) |
    | 4 | 282 | 21% | ×1.62 | 70% | 0.14 s | ×1.48 | Ink Storm (10) + quake |
    | 5 | 295 | 24% | ×1.65 | 76% | 0.10 s | ×1.64 | Final Form: a beam that tracks your cursor at a limited turn rate |

  - Also per level: reach on punches/slashes/flying kicks, faster get-up, ground-pound radius, teleport speed;
    shots lead your cursor (better each level), 2 homing blasts from level 3, faster blast cooldown; from level 3
    he breaks cages/ice early and notices a lightning/bomb cursor hovering over him; from level 4 he cancels
    attacks to dodge and can catch a thrown spear. Dodging is now "see once, decide once, react after a delay"
    (it used to re-roll every frame), lit bombs get a fresh look every 0.5 s. Ultimate bar under his hp (charges
    with time, damage dealt and taken; not before 25 s).
  - Fairness fixes found while tuning: rockets and waves no longer deal contact damage on top of their explosion /
    sweep; drawn-object hits capped at 18 (was 32), spear ×1.35 (was ×1.6), arrows 4, user explosions 22·f+5;
    🩹 Repair heals 15 (was 25) with an 18 s cooldown; at most 2 apps engage him at once (was 3).
  - Files: `src/stickman/brain.js`, `src/stickman/tricks.js`, `src/stickman/stickman.js`, `src/game.js`,
    `src/world/objects.js`, `src/world/sketch.js`, `src/ui/arena.js`.
  - Dev bench (autopilot, fast-forwarded, final numbers):
    - L1: 0/10 wins, 48–75 s (he deals 18–52 desk damage first)
    - L3: 6/13 wins ≈ 46%, 52–111 s
    - L5: 6/10 wins, 54–115 s
  - Verify: `G.bench(3, 5).then(r => window.R = r)` per level, or watch real-time autopilot fights.
- **Review:**
  - `power()` (`src/stickman/brain.js:28-43`) is a clear single table, and every damage path now goes through
    `this.dmg()` or `power.armor`. The dodge rewrite (see once, decide once, react after `P.react`) is a real fix for
    the per-frame re-roll. `spike` and the final beam are drawn as plain strokes: no `shadowBlur`, no filters. The
    ultimate DOM bar only writes when its value changes (`setStyle`). Bench in an isolated instance at L3: 2 fights,
    1 win each side, 116 s and 53 s, variety stick 17/14, player 12/11.
  - **Bug (hard rule: idle dormancy):** an interrupted `draw` action leaves its sketch behind forever.
    `drawShape` (`brain.js:330-345`) and `sketchProp` (`src/stickman/tricks.js:7-15`) only set `done` in
    `onDone`. A hit, a knock, `s.stop()` in `ultimate()`, or the new level-4 dodge cancel (`brain.js:758`,
    `s.cancelAction()`) replace the action, so `onDone` never runs. The sketch is never filtered out
    (`src/game.js:906`), so:
    - `canDoze()` is false forever (`game.js:163`);
    - the render signature adds `|fx<t>` every frame (`game.js:946`), so the full-screen canvas repaints at 24 fps
      in chill;
    - a half-drawn ink shape hangs in the air.
    Reproduced: after 3 autopilot fights, `G.sketches.length === 5` and he slept with `dormant: false`, with every
    other `canDoze` condition clear. The root cause predates this change, but fights now trigger it reliably.
  - Minor:
    - `segDistTo` (`brain.js:1059`) duplicates `segDist` from `util.js`.
    - `this.threat`, `lastPtr` and `cursorVel` carry over between fights. Reset them in `startFight`, as is
      already done for `ult` and `beam`.
    - If the overcharge or final-beam `charge` is interrupted, `s.aura` stays lit until the fight ends.
  - The balance numbers are for QA to judge against the acceptance criteria.
  - **Required changes:**
    1. Make sketches end with their action. Store the action from `s.play('draw', …)` on the sketch, and in
       `frame()` drop sketches where `k.done || this.stick.action !== k.action`. Also clear `this.sketches` in
       `cleanupFight`.
- **Dev notes (round 2):**
  - Each sketch now stores the action that draws it (`brain.drawShape`, `tricks.sketchProp`). `frame()` drops it
    once that action is done or replaced, and `cleanupFight` clears `sketches`.
  - Minor:
    - `segDistTo` now wraps `util.segDist`.
    - `threat`, `lastPtr`, `cursorVel` (and the new `storm` flag) are reset at `startFight`.
    - An interrupted blast/overcharge/final-beam charge no longer leaves his aura lit.
  - Verified: a star drawing interrupted by a knock leaves 0 sketches. After `bench(3, 2)`, `sketches` is 0, and
    a sleeping stickman went `dormant: true` within 8 s.
- **Review (round 2):**
  - Fixed. Sketches store their `draw` action (`src/stickman/brain.js:340`, `src/stickman/tricks.js:10`).
    `frame()` drops them when the action is done or replaced (`src/game.js:946`), and `cleanupFight` clears them.
  - Reproduced: a star `drawShape` knocked after 10 frames → `sketches` 1 → 0. Then, with the cleanup idle,
    he fell asleep and went `dormant: true` (`sketches 0, timers 0, cleanup.active false`). Idle dormancy works
    again, and the `|fx` repaint key no longer stays on.
  - Minor items done:
    - `segDistTo` wraps `util.segDist`.
    - Per-fight brain state is reset in `startFight`.
    - Interrupted charges no longer leave the aura on (`brain.js:556`). The only other aura user is meditate in
      chill, so this doesn't clobber anything; the ink storm is protected by `storm`, and the beam by `beam`.
  - No regressions found.
  - Verdict: Ready for QA.
- **QA:**
  - Real-time autopilot fights. Snapshots are in `…/scratchpad/qa/` (the full path is in DS-1).
    - L1 (`L1a_*`): the autopilot won in 51.3 s, with 82 desk hp left. A one-sided fight: 9 distinct stick moves.
    - L3 (`L3a_*`): the autopilot won in 90.2 s. He held at 2 hp for several seconds, and the desk ended at 11.
      A real fight, with Ink Storm 4×.
    - L3 on round 2 (`L3b_*`): he won in 41.5 s.
    - L5 (`L5a_*`): he won in 91.7 s with 67/295 hp left, Final Form beam 3×, ending on the blue screen.
  - Benches (autopilot, fast-forward; round 2 = code from 23:39, round 1 = before 23:33):

    | level | his wins, round 2 | his wins, round 1 | durations, round 2 (min · median · max) | desk hp left when the autopilot won (round 2) |
    |---|---|---|---|---|
    | 1 | 0/10 | 0/10 | 48.6 · 59.6 · 72.9 s | 40–88 (median 67) |
    | 2 | 0/8 | 0/8 | 46.4 · 60.6 · 73.4 s | 16–95 (median 60) |
    | 3 | 7/20 (35%) | 10/20 (50%) | 35.3 · 68.5 · 88.1 s | 17–96 (median 29) |
    | 4 | 6/8 (75%) | 7/8 | 28.1 · 63.2 · 69.3 s | 11, 24 |
    | 5 | 7/10 (70%) | 7/10 | 34.4 · 60.3 · 94.5 s | 15–89 |

  - Level 3 over both rounds: 17/40 = 42.5%, inside the 35–50% goal. Level 3 is clearly stronger than level 1:
    0% → 42.5% wins, and when the autopilot wins, the desk keeps a median 29 hp instead of 67. In real time the L3
    fights read as close and dangerous, not as a weak stickman. The ultimate moments are big and readable (Ink
    Storm banner, the tracking beam at L5).
  - Concerns, filed as DS-9 and not blocking here: L1 and L2 never win and look alike; L5 is no stronger than L4.
    Fights under 45 s are tracked in DS-1.
  - **Verdict: Accepted.** Every acceptance item is met: 3+ fights at L1, L3 and L5, win rates and durations
    logged, and L3 is clearly stronger than L1.
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Changes requested · interrupted draw sketches never clear: blocks dormancy and forces a repaint every frame after fights
  - 2026-11-17 · developer · In Review · review round 1 fixed, see Dev notes (round 2)
  - 2026-11-17 · reviewer · Ready for QA · round 2: interrupted sketches clear; dormancy verified live
  - 2026-11-17 · QA · Accepted · L3 wins 17/40 (42.5%), L1 0/20; 4 real-time fights plus 112 bench fights logged; level curve follow-up in DS-9
  - 2026-11-18 · QA · Accepted (unchanged) · regression check: L3 47.5% over 200 fights, L1 20%; L3 clearly stronger

## DS-3 · App characters need distinct power levels and abilities
- **Type:** Balance/Feature · **Severity:** Medium · **Status:** Accepted · **Reporter:** user
- **Description:** "Some usual programs should have different abilities. It is good some are very
  weak, but some should be stronger." Give the 14 archetypes clear tiers:
  - weak / normal / strong
  - 1–2 "boss" apps, e.g. Guardian the antivirus, or Bash the terminal at high level
  - hp, damage and speed per tier
  - at least 3 new or upgraded signature abilities that are fun to watch

  Show the tier on the fight HUD.
- **Acceptance:** documented tier table in the ticket; QA confirms strong apps feel strong and
  weak ones feel weak in fights.
- **Dev notes:**
  - `TIERS` and `tierOf(kind, level)` in `src/actors/lore.js`; `AppActor.applyTier()` scales hp, damage (`dmgMul`,
    used for all app damage to him), walk speed and ability cooldowns. Strong/boss apps shrug off small knocks;
    weak apps panic and run when he gets close, and stay "not responding" longer.

    | tier | hp | damage | speed | cooldowns | apps |
    |---|---|---|---|---|---|
    | 👑 boss | ×2.4 | ×1.8 | ×1.05 | ×0.7 | Guardian (antivirus); Bash (terminal) when he is level 4+ ("root") |
    | ★ strong | ×1.5 | ×1.4 | ×1.1 | ×0.8 | Foxy (browser), Bash (terminal), Binny (trash) |
    | ▪▪ normal | ×1 | ×1 | ×1 | ×1 | Folda, Brushy, Cog, Tick, Dev, Joy |
    | ▫ weak | ×0.65 | ×0.6 | ×0.85 | ×1.35 | Tune (music), Calc, Posty (mail), Ping (chat) |

  - New signature moves (every 3rd cast for strong/boss apps):
    - **Full System Scan** (Guardian): a green scanline sweeps the screen; when it crosses him he is quarantined
      and hurt.
    - **Fork Bomb** (Bash): a rain of falling processes; as root it opens with a heavy `sudo rm -rf /stickman`.
    - **Tab Storm** (Foxy): three fire dashes in a row that set him on fire.
    - **Recycle** (Binny): spits the junk it ate back at him.
    - Each works when possessed too (aimed at your cursor).
  - HUD: all 14 apps in the ally bar, sorted by tier, with a tier badge and tooltip (tier + signature); summon
    toast names the tier; in fights non-normal apps show a tier tag over their head.
  - Files: `src/actors/lore.js`, `src/actors/app.js`, `src/ui/arena.js`, `src/stickman/stickman.js`,
    `src/world/objects.js`, `style.css`.
  - Verify: summon Guardian / Calc in a fight and compare; `fightReport().moves.ally` lists `fullScan`,
    `forkBomb`, `tabStorm`, `recycle` when they fire.
- **Review:**
  - `TIERS` and `tierOf` (`src/actors/lore.js:107-118`) are clean. `applyTier` keeps the hp ratio when the tier
    changes (`src/actors/app.js:46-55`), and it is re-applied at fight start and at cleanup, so root Bash is a boss
    only while the level allows it. Splitting `useAbility` and `ability` to scale cooldowns and count casts is
    tidy. The HUD badges, tooltips and the tier key in the help panel render correctly (snapshot checked). The scan
    line and tier tags are plain fills: no blur.
  - **Bug:** Guardian's Full System Scan keeps running after the fight ends. `scanTick` (`app.js:531-549`) runs
    from `postUpdate` in any mode. In the non-hostile branch it sets `s.st.caged = 2.6`, `s.stop()` and
    `s.hurt(10, …, {force: true})` without checking `g.mode`. A scan cast just before the fight ends can cage and hurt
    him on the result screen, or in chill if Esc skips the result screen (`cleanupFight` doesn't clear `a.scan`).
  - Minor:
    - Tab Storm: `dashChain` is decremented before each chained dash, so the third dash never sets him on fire
      (`app.js` `checkContact`, `dashChain > 0`). The ticket says "three fire dashes … set him on fire".
    - The tier tag is drawn 3 px above the hp bar and slightly overlaps it on weak apps (cosmetic).
  - **Required changes:**
    1. In `scanTick`, only apply the hit while `g.mode === 'fight'`, and clear `a.scan` (and `dashChain`) for every
       app in `cleanupFight`.
- **Dev notes (round 2):**
  - `scanTick` clears the scan and does nothing outside `mode === 'fight'`. `cleanupFight` clears `scan`,
    `dashChain` and `stormT` on every app.
  - Minor:
    - Tab Storm sets a 3 s `stormT`, so all three dashes set him on fire.
    - The tier tag moved 3 px up, off the hp bar.
  - Verified: a scan in flight at `endFight` was gone right away, with no cage and no damage on the result screen.
- **Review (round 2):**
  - Fixed. `scanTick` returns early and clears the scan outside a fight (`src/actors/app.js:532-534`).
    `cleanupFight` clears `scan`, `dashChain` and `stormT` on every app (`src/game.js` `cleanupFight`).
  - Reproduced: Guardian with a scan in flight, then `endFight('truce')` and 2 s of frames. Result: `scan: null`,
    `caged: 0`, hp unchanged (268 → 268), `dashChain` and `stormT` 0.
  - Minor items done: `stormT` (3 s) means all three Tab Storm dashes burn, and the tier tag moved off the hp bar.
    No regressions found.
  - Verdict: Ready for QA.
- **QA:**
  - **HUD:** pass.
    - The ally bar is sorted by tier, with 👑 ★ ▪▪ ▫ badges, and the help panel has the tier key.
    - "★ STRONG" and "▫ WEAK" tags show over heads, and the summon toast names the tier ("Brave Web Browser joins
      the fight. Guardian of the Web · ★ Strong · signature: Tab Storm").
    - See `crop_hud.png` and `c_boss.png` in `…/scratchpad/qa/`.
  - **Signature moves seen in real time:** Fork Bomb (a rain of `kill -9 stick`, `sudo rm -rf /stickman` and
    `git revert stick` blocks), Guardian's QUARANTINED cage, and Tab Storm ("Ctrl+T!"). The `moves.ally` counters
    record `fullScan`, `forkBomb`, `tabStorm` and `recycle`.
  - **Strength, measured with a duel harness** (eval only, no code change):
    - An exhibition at L3 with the autopilot stopped and every app removed. One app is summoned 250 px from him.
      Desk hp is pinned at 100, then 40 s of fast-forward. 3 trials per app on the round-2 code.
    - The number is the app's own damage to him per 40 s. Bash's and Dev's text blocks count as theirs.

    | app | tier | damage per 40 s (3 trials) |
    |---|---|---|
    | Guardian | 👑 boss | 18 · 25 · 31 |
    | Foxy | ★ strong | 38 · 49 · 72 |
    | Bash | ★ strong | 12 · 13 · 15 |
    | Binny | ★ strong | 17 · 23 · 28 |
    | Cog | ▪▪ normal | 35 · 38 · 46 |
    | Joy | ▪▪ normal | 36 · 42 · 64 |
    | Dev | ▪▪ normal | 0 · 13 · 21 |
    | Calc | ▫ weak | 2 · 3 · 13 |
    | Posty | ▫ weak | 0 · 0 · 16 |
    | Ping | ▫ weak | 8 · 13 · 13 |
    | Tune | ▫ weak | 0 · 0 · 0 |

    At L5: Guardian 18 · 23 · 29, root Bash (boss) 12 · 39 · 40, Foxy 47 · 61 · 69. The round-1 code gave the same
    picture (Guardian 19–39, Foxy 90–142, Cog 33–49).
  - The weak apps feel weak, and Foxy feels strong: it is also the top ally damage source in every round-1 bench.
  - **Guardian (the boss), Bash and Binny don't feel strong.** They deal less than the normal Cog and Joy.
    Guardian ranks about 5th of the 14 apps, and root Bash at L5 is still below Foxy. The hp tiers hardly show:
    he mostly hunts the cursor, so in these duels he never downed a strong or boss app.
  - Reporting gap: ability damage isn't credited to the app. Bash and Dev show up as `textblock` in
    `fightReport().damage.bySource`, so the report can't show how strong an app is.
  - **Verdict: Reopened.** To pass:
    - with this duel (or a bench helper that does the same), the median damage per 40 s ranks boss > every strong
      app > every normal damage dealer > every weak app, at L3 and for root Bash at L5;
    - app ability damage is reported as `ally <kind>`;
    - optionally, he targets a boss now and then, so its extra hp shows.
- **Dev notes (round 4, QA reopen: tiers not felt, ability damage not credited):**
  - **Credit:** every app ability's damage is reported as `ally <kind>` in `fightReport().damage.bySource`. That
    covers command blocks (Bash/Dev), projectiles, scans, devour, contact and Tab Storm's burn.
  - **Damage model:**
    - every ability passes a normal-tier base per hit (`DMG` in `src/actors/app.js`);
    - the app's `dmgMul` = tier multiplier × the archetype's `pow` factor (`src/actors/lore.js`) scales it once;
    - app hits count 60% against him ("it's your fight").
    - `pow` evens out how efficient each ability is. A dash lands far more often than a falling block. It was
      calibrated with the new duel helper.
  - **Mechanics fixes found while measuring:**
    - a command block hits once (it used to hit again while sliding against him);
    - Guardian's quarantine fires every 6–8 s (was 9–12 s);
    - Binny lunges when he's out of swallowing range, and spits junk when he floats overhead;
    - Cog's roll leaps at a target overhead.
  - **Survivability:** boss and strong apps shrug off small knocks; weak apps flee and stay "not responding"
    longer. He now goes after a boss or strong app now and then (`huntApp`), so their extra hp shows.
  - **Duel helper:** `G.duels(kinds, level, trials)` → `duelResults`. An exhibition with the autopilot off,
    desk and his hp pinned, and only that app on the field, 40 s per trial. He doesn't possess it: with a single
    app that would measure possession, not the app.
  - Measured on the final code, median damage per 40 s at L3 (9 trials; hp lost is the median of 9):

    | app | tier | median dmg | trials | hp lost |
    |---|---|---|---|---|
    | Guardian | 👑 boss | 83 | 72–85 | 0 / 216 |
    | Foxy | ★ strong | 56 | 8–90 | 27 / 105 |
    | Binny | ★ strong | 53 | 24–74 | 28 / 165 |
    | Bash | ★ strong | 51 | 11–63 | 11 / 120 |
    | Dev | ▪▪ normal | 20 | 9–29 | 7 / 80 |
    | Joy | ▪▪ normal | 15 | 0–30 | 16 / 70 |
    | Cog | ▪▪ normal | 14 | 0–33 | 0 / 90 |
    | Posty | ▫ weak | 5 | 3–6 | 0 / 39 |
    | Ping | ▫ weak | 4 | 2–4 | 8 / 39 |
    | Calc | ▫ weak | 3 | 1–5 | 6 / 39 |
    | Tune, Folda, Brushy, Tick | utility | 0 | | |

    - At L5 (7 trials): root Bash (👑 boss) 74, Guardian 57, Binny 18, Foxy 15.
    - This duel run predates the last mechanics fixes (Binny's overhead spit and Cog's roll). The targeted
      re-runs after them gave Binny 45, Bash 44, Foxy 26–33 against Dev 17; Cog's roll fix then lifted Cog clear
      of the weak apps. The order stays boss > every strong > every normal damage dealer > every weak.
- **Review (round 4):**
  - Damage model: a normal-tier base per hit (`DMG`, `src/actors/app.js:11`) × `dmgMul` (tier × `pow`) × 0.6 in
    `Stickman.hurt`. It is applied once per hit, I found no double scaling.
    - Command blocks now carry `app` and `hitDmg` and are marked `spent` after their first hit, so a block can't
      hit twice.
    - Possessed apps use the tier only on the cursor (`6 * this.T.dmg`), so `pow` doesn't leak into the player's
      side.
  - Credit: blocks, projectiles (`src: {app}`), scan, devour, contact and Tab Storm's burn (`s.burnBy`) all report
    as `ally <kind>`. There are only two burn sources (fire drawings reset `burnBy`; Tab Storm sets it), so
    credit can't go stale.
  - Mechanics: the Binny lunge reuses the dash contact path, and the overhead spit needs `s.top < y - 120`. Cog's
    leap height is capped at 1150 px/s up. All fine.
  - Re-checked with `G.duels([...], 3, 3)`: medians were Guardian 72, Foxy 51, Binny 45, Bash 38, Cog 27, Calc 5,
    so boss > every strong > normal > weak. The roster was restored after the duels.
  - Minor:
    - `duels()` restores the roster but not stats or desk hp the way `bench()` does. In practice it only
      fast-forwards 2 s of chill per trial, so this is negligible.
  - Verdict: Ready for QA.
- **Dev notes (round 5, review nit):**
  - `duels()` now restores his stats as well as the roster: the fast-forwarded chill time between duels could
    feed or level him.
  - Verified: level, XP, W/L, fights, fun, energy, food and anger identical before and after
    `duels(['calculator','terminal'], 3, 2)`, live and saved.
- **Review (round 4, nit fix):** `duels()` now saves and restores `stats` next to the roster (`src/game.js`). It is
  read in place; no other change.
- **QA (round 2):**
  - Setup: isolated instance (port 47862) with fsck, two clocks, sysmon and Mochi. The code did not change while
    I tested (no `[reload]` lines in the log). Evidence is in `scratchpad/qa2/`.
  - Duels with `G.duels(kinds, level, trials)`. Damage per 40 s that the report credits to the app as `ally <kind>`.
    - L3, 9 trials (`duels_L3.json`):

      | app | tier | median | range |
      |---|---|---|---|
      | Guardian | 👑 boss | 80 | 53–85 |
      | Bash | ★ strong | 54 | 17–71 |
      | Binny | ★ strong | 48 | 9–77 |
      | Foxy | ★ strong | 37 | 22–66 |
      | Cog | ▪▪ normal | 19 | 4–29 |
      | Dev | ▪▪ normal | 14 | 5–29 |
      | Joy | ▪▪ normal | 11 | 3–20 |
      | Posty | ▫ weak | 4 | 3–6 |
      | Ping | ▫ weak | 4 | 2–5 |
      | Calc | ▫ weak | 3 | 0–4 |
      | Tune (weak); Folda, Brushy, Tick (normal) | utility | 0 | – |

    - L5, 7 trials (`duels_L5.json`): root Bash (👑) 68, Guardian 44, Binny 18, Foxy 17, Dev 11, Cog 9, Joy 6,
      Calc 3.
    - The order is boss > every strong > every normal damage dealer > every weak at L3, and root Bash is on top at
      L5.
  - In real fights: with Binny on the field in an L3 exhibition it lunged 7× and spat junk 4×, for 101 damage.
    The report credits app damage as `ally code`, `ally settings` and so on. The boss and strong tags show over
    heads.
  - Nit (helper only): `duel()` reads `app.maxHp` after the truce, when the tier has gone back to his chill level.
    So root Bash shows 120 hp in `duelResults`, while in the fight it had 192 (checked directly).
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Changes requested · Full System Scan can cage and hurt him after the fight ended
  - 2026-11-17 · developer · In Review · review round 1 fixed, see Dev notes (round 2)
  - 2026-11-17 · reviewer · Ready for QA · round 2: scan stops outside fights; reproduced clean
  - 2026-11-17 · QA · Reopened · boss Guardian (18–31 dmg/40 s) and strong Bash/Binny hit weaker than normal Cog/Joy; only Foxy feels strong; app ability damage not credited in fightReport
  - 2026-11-18 · developer · In Review · QA reopen fixed: ability damage credited as ally <kind>; tiers calibrated with G.duels(); boss > strong > normal > weak at L3, root Bash top at L5
  - 2026-11-18 · reviewer · Ready for QA · round 4: damage model and credit reviewed; duel order boss > strong > normal > weak reproduced
  - 2026-11-18 · developer · Ready for QA (unchanged) · review nit folded in: duels() restores stats too; verified
  - 2026-11-18 · reviewer · Ready for QA (unchanged) · nit fix checked (duels restores stats); status unchanged
  - 2026-11-18 · QA · Accepted · duels L3 (9 trials): boss 80 > strong 37–54 > normal 11–19 > weak 3–4; root Bash 68 tops L5; damage credited as ally <kind>

## DS-4 · Clean up after fights: Binny (trash) carries leftovers to the bin
- **Type:** Feature · **Severity:** High · **Status:** Accepted · **Reporter:** user
- **Description:** After a fight, drawn objects, file shards, balls and other leftovers stay on
  the desktop. The user wants "the bin (trash can) or someone who cleans" to come and put it
  all in the trash:
  - **Binny on screen:** it walks to each leftover and devours it (an existing ability), with a
    few funny lines.
  - **Binny missing:** spawn it for the cleanup, then let it leave.
  - **Ownership:** also file each leftover as an `orphan` ticket (WidgetSystem
    `ctx.desktop.tickets`). Whichever of Binny or **fsck** (the built-in repair daemon) gets there
    first takes it. Resolve the ticket when it's eaten.
  - **Cracks:** keep up to 5 cracks as `crack` tickets for fsck. This needs crack ids and
    `healCrack(id)` in `fx.js`.
- **Acceptance:** within about 60 s after a fight, no leftovers remain. QA watches it happen and
  it reads clearly ("Binny is cleaning up").
- **Dev notes:**
  - New `src/world/cleanup.js` (class `Cleanup`, started from `game.cleanupFight()`). Leftovers are drawings,
    balls and text blocks that would stay (his dropped weapon included); short-lived items vanish on their own.
    Each leftover is frozen as a plain object and filed as an `orphan` ticket (label like "spear drawing"); the
    ticket position follows the object when it comes to rest.
  - Binny: an existing Binny is used, otherwise one walks in from the nearest screen edge on the floor and walks
    off again when done. Binny claims a ticket before going (so fsck skips it), hurries (×2.6 speed), keeps the
    claim alive with `progress`, eats on arrival and resolves the ticket. If fsck claims one first, Binny drops it
    ("Hey fsck, that was MY snack!"); if fsck resolves one, the object disappears with a poof. Long-range suction
    if Binny makes no progress for 5 s, and everything left is vacuumed at 48 s. Lines on arrival, eating, being
    beaten by fsck, done and leaving; "🧹 cleaning up" over Binny; nest status "Binny is cleaning up 🧹 · N left";
    the stickman thanks Binny.
  - Cracks: `fx.crack()` now returns the crack with an `id`; `fx.healCracks(keep)` heals all but `keep`;
    `fx.healCrack(id)` heals one. The 5 largest cracks become `crack` tickets (ttl 55 s, so they heal within a
    minute even without fsck); resolve/expire heals that crack.
  - Starting a new fight cancels a running cleanup (its tickets are resolved, objects stay).
  - Files: `src/world/cleanup.js` (new), `src/fx/fx.js`, `src/game.js`, `src/actors/app.js`, `src/ui/nest.js`.
  - Verified live with fsck in an isolated instance: fsck sealed all 5 crack tickets and took some orphans,
    Binny ate the rest; a called-in Binny ate 3 leftovers in 5 s and left. In the bench, 0 leftovers remain 60 s
    after every fight.
  - Verify: watch a fight to the end (or `G.startFight({autopilot:true})` and `fastForward` to the end), then
    watch in real time; `fightReport().leftovers.now` and `.cleanup` show progress.
- **Review:**
  - The ticket flow is correct against the host (`WidgetSystem/shell/lib/sheet.js`):
    - Claims are synchronous and exclusive, so "first claim wins" between Binny and fsck holds.
    - `job.id = null` before resolving avoids handling our own synchronous resolve event.
    - `progress` every 6 s keeps the claim inside the 20 s timeout.
    - Position updates are throttled (1/s, only after the object comes to rest and moves more than 24 px).
    - Crack resolve and expire both heal the crack.
    - `cancel()` closes every ticket.
    - No runaway: at most one ticket per leftover (drawings are capped at 24 by `addObject`) plus 5 cracks per
      fight.
    - `cleanup.active` keeps the game awake only while work remains.
    - Only game-layer objects are touched.
    Live run with fsck: 3 leftovers and 5 cracks. Binny ate 2, 1 was sucked in, fsck sealed all 5 cracks, and
    everything was done 22 s after the fight. The called-in Binny walked off.
  - **Bug: calling in a Binny evicts one of the user's apps.** `callBinny` uses `g.summonApp('trash', …)`
    (`src/world/cleanup.js:94`), which retires the oldest app when `apps.length >= maxApps` (`src/game.js:412-416`).
    Verified: roster `[music, mail, settings, paint]` became `[mail, settings, paint, trash]`, and after Binny left,
    `music` was gone for good.
  - **Bug: the called-in Binny can stay permanently.**
    - `save()` (`game.js:199`, every 10 s and on unmount) writes it into `stats.apps`.
    - If a fight starts while it walks off, `check()` gives up (`cleanup.js:237`), and `cancel()` no longer knows
      about it (`binny` and `temp` were cleared in `finish()`). It then stays as a normal app.
  - **Race with fsck at the deadline:** `suck()` kills the object but skips the resolve when fsck has claimed it
    (`cleanup.js:218`). fsck still walks to the empty spot, "collects" it, and logs it in its lost list. The host
    lets the filer resolve a claimed ticket (`sheet.js:196`), and the dead-object loop in `update()` already does.
  - Leftovers this cleanup misses (fixes are on other tickets): the stroke finished after the snapshot (DS-1) and
    stuck half-drawn sketches (DS-2).
  - Minor:
    - `suckSaid` is never reset, so the suction line plays only in the first cleanup per session.
    - `stats.fsck` counts cracks and orphans together.
    - The `t.by === ctx.id` half of `mine` never matches on claim events (`by` is an object there). It is harmless,
      because `claimedBy` decides.
    - Consider capping orphan tickets at about 10 per fight and letting Binny eat the rest without a ticket, so
      fsck's lost log isn't flooded.
  - **Required changes:**
    1. Spawn the called-in Binny without going through the app cap: construct it directly or add a `noRetire`
       option. Mark it `temp`, and make `save()` skip temp apps.
    2. Keep a reference to a leaving Binny, and have `cancel()` and a fight start remove it (`g.removeApp`) instead
       of leaving it in `g.apps`.
    3. In `suck()`, always resolve as the filer, claimed or not, so fsck isn't sent to an object that is already
       gone.
- **Dev notes (round 2):**
  - The called-in Binny is spawned with `summonApp(..., {temp: true})`. It doesn't count against the app cap,
    can't retire anyone, and `save()` skips temp apps.
  - A Binny walking off is tracked as `cleanup.leaver`. `cancel()`, and so a fight start, removes it. The walk-off
    removes it in every exit path. The leave line is said by Binny itself (it used to be lost).
  - `suck()` always resolves the ticket as the filer, claimed or not.
  - Minor:
    - `suckSaid` resets per cleanup.
    - Cracks fsck sealed are counted separately (`fsckCracks`).
    - The claim handler only checks `claimedBy`.
    - At most 10 orphan tickets per fight; extra leftovers are still eaten, without a ticket.
  - Verified:
    - roster `[folder, clock, music, mail]` with no Binny → a temp Binny joined (`trash*`, not saved), ate all 4,
      left, and the roster was unchanged;
    - a fight started while it walked off → removed, roster unchanged;
    - `suck()` on a claimed job → ticket closed.
- **Review (round 2):**
  - All 3 required items are fixed. Re-checked in an isolated instance (port 47871) with fsck:
    1. **No eviction:** with roster `[folder, clock, music, mail]` and no Binny, a level-3 autopilot fight left 7
       leftovers. A temp Binny (`trash*`) joined without retiring anyone, and `save()` never wrote it. Binny ate
       5, 2 were sucked in, and fsck sealed all 5 cracks (`fsckCracks: 5`). Done 22 s after the fight; Binny walked
       off. Live and saved roster unchanged. (`src/world/cleanup.js:96`, `src/game.js:413-427`, `save()` at
       `game.js:200-202`.)
    2. **Leaver:** a fight started while the temp Binny was walking off → it was removed at once (`cleanup.js:115`,
       `leaver` at `:236`). `leaver` and `leaving` were reset, and the roster was unchanged after the fight. Every
       exit of the walk-off goes through `gone()`, which is guarded by `this.leaver !== b`, so a stale timer can't
       remove a newer Binny.
    3. **Deadline suction:** `suck()` now always resolves as the filer (`cleanup.js:223`), which the host allows for
       a claimed ticket (`sheet.js:196`). I checked this by code reading; I can't drive an fsck claim from eval.
  - Minor items done:
    - `suckSaid` resets per cleanup.
    - Cracks are counted in `fsckCracks`.
    - The claim handler only checks `claimedBy`.
    - At most 10 orphan tickets per fight (`cleanup.js:55`). Leftovers without a ticket are still picked by
      Binny (`!cand.id`) and by the deadline suction.
  - No regressions found. Ticket traffic is unchanged: no new `update`, `claim` or `progress` calls.
  - Verdict: Ready for QA.
- **QA:**
  - I watched 6 cleanups in real time, with fsck on screen. Snapshots are in `…/scratchpad/qa/`.

    | fight | leftovers + cracks | who cleaned | everything gone after |
    |---|---|---|---|
    | L3, round 1 (`L3a_t062–087`) | 4 + 5 | called-in Binny 3, suction 1, fsck 5 cracks | 12.6 s (cracks ~25 s) |
    | L1, round 1 (`L1a_*`) | 3 + 5 | Binny 2, suction 1, fsck 5 cracks | 15.2 s |
    | L5, round 1 (`L5a_t099+`) | 4 + 5 | Binny 2, suction 2, fsck 5 cracks | 20.8 s |
    | L3, round 2 (`L3b_*`) | 1 + 5 | Binny 1, fsck 5 cracks | 2.3 s (cracks ~22 s) |
    | fast-forwarded fight, cleanup in real time (round 2) | 6 + 0 | Binny 2, fsck 3, suction 1 | 15.4 s |
    | Binny already on screen (round 2, `binny_present_*`) | 3 + 0 | Binny 1, fsck 2 | 7.1 s |

    Within 25 s every time: 0 leftovers and 0 open cracks.
  - **It reads clearly** (`crop_L3a_t068.png`, `crop_L3a_t074.png`):
    - Binny walks in from the screen edge with "🧹 cleaning up" over its head;
    - the nest says "Binny is cleaning up 🧹 · 3 left";
    - "*munch*" and "*burp* Desktop tidy." appear;
    - fsck visibly tapes up the cracks;
    - the called-in Binny walks off, and the stickman sits and comments.
    The text is small, but you can tell what is happening.
  - **Roster:** on the round-1 code, the called-in Binny evicted Posty during the L1 fight, as the reviewer found.
    On round 2 the roster stayed `[trash]` → `[trash]` through an exhibition and its cleanup, and the temp Binny
    was not saved.
  - **Bench:** 0 leftovers 60 s after every one of the 112 bench fights. The bench still reports up to 5 open
    cracks after 60 s. Crack tickets expire on wall-clock time and fsck works in real time, so fast-forward can't
    show them closing. In real time they all closed. This is a bench limitation, not a cleanup bug.
  - **Verdict: Accepted.**
- **QA (round 2 regression):**
  - Real-time cleanups after fights on the round-2 code:
    - L3: 9 leftovers, Binny done in 10.4 s, 5 cracks sealed by fsck;
    - L5: 7 leftovers, done in 19.1 s;
    - L1: 6 leftovers, done in 14.1 s;
    - Binny already on screen: 5 leftovers in 19.9 s, fsck sealed 4 cracks, the roster came back as `[trash]`;
    - after back-to-back duels that cancelled several cleanups: 18 leftovers in 22.8 s.
  - In that last run fsck sealed none of the 5 crack tickets; they healed by ttl at 55 s, still inside the
    60 s window.
  - Binny's lunge (7×) and spit (4×) fired in a fight. 0 leftovers 60 s after all 1,000 bench fights.
  - Still Accepted.
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Changes requested · called-in Binny evicts a user app and can become permanent; deadline suction leaves fsck's ticket open
  - 2026-11-17 · developer · In Review · review round 1 fixed, see Dev notes (round 2)
  - 2026-11-17 · reviewer · Ready for QA · round 2: no eviction, temp Binny never saved, leaver removed on fight start, suction closes claimed tickets; verified live with fsck
  - 2026-11-17 · QA · Accepted · 6 real-time cleanups all clear within 25 s (Binny called in, Binny on screen, fsck sealing cracks); readable; 0 leftovers after 112 bench fights
  - 2026-11-18 · QA · Accepted (unchanged) · regression check: real-time cleanups 9 / 7 / 6 / 5 leftovers done in 10.4 / 19.1 / 14.1 / 19.9 s, 18 leftovers in 22.8 s; Binny on screen reused; roster restored; fsck sealed cracks

## DS-5 · Fight controls must be discoverable
- **Type:** UX · **Severity:** High · **Status:** Accepted · **Reporter:** user
- **Description:** "I saw the guide on the screen one time (first time) … another time I just didn't
  understand how to open it."
  - Add a permanent, visible **? Help** button in the fight HUD that opens the guide.
  - Show a compact key legend on the HUD: tools 1–5, inks Q/W/E/R, B = sketchbook, Esc = truce.
  - Make "what to draw" obvious: show the sketch shapes and what each becomes.
- **Acceptance:** a new user can find help within 5 s of a fight starting; QA confirms from
  snapshots.
- **Dev notes:**
  - Top bar: a permanent orange **❓ Help** button (also `?`, `H`, `F1`). The help panel explains the goal, tools
    1–5, inks Q/W/E/R, buttons, the tier key, and shows all 12 sketch shapes with what each becomes.
  - A compact legend under the ally bar is always visible: the 12 shapes with their weapon emoji (dimmed unless
    the pencil is active; the shape you just drew flashes) and the key line "1–5 tools · Q W E R inks ·
    B sketchbook · ? help · Esc truce". Ink buttons and the 📖 button show their keys.
  - The start toast points at ❓ Help; the help panel opens by itself in the first fight (storage `sawHelp`).
  - Files: `src/ui/arena.js`, `style.css`.
  - Verify: start a fight and take a snapshot after ~2 s: Help button, legend and shape strip are all on screen.
- **Review:**
  - Snapshot in an isolated instance 2.5 s into a fight:
    - the orange ❓ Help button is at the top right of the bar;
    - the legend shows the 12 shapes with emoji, plus "1–5 tools · Q W E R inks · B sketchbook · ? help · Esc
      truce";
    - the ink buttons show their keys;
    - the help panel lists the tools, inks, buttons, tier key and all shapes with "how to draw".
  - The help and sketchbook panels close each other. `highlight()` now flashes both the card and the legend chip
    (`src/ui/arena.js` `highlight`). Key handling ignores `inInput` events. CSS adds no infinite animations or
    filters (`style.css` +56 lines). The only transitions are opacity and transform on show and hide.
  - Nits (not blocking):
    - `flashUlt` and the first-fight auto-help use raw `setTimeout` (the existing pattern). Both are guarded or
      harmless after `destroy()`.
    - The help panel doesn't open by itself in autopilot fights, and `sawHelp` stays unset there. That seems
      right.
  - Verdict: Ready for QA.
- **QA:**
  - Autopilot fight, snapshot at 1.5 s (`crop_L1a_t001.png` in `…/scratchpad/qa/`): the orange **❓ Help** button
    is at the top right of the bar. The legend under the ally bar shows the 12 shapes with their weapon emoji and
    "1–5 tools · Q W E R inks · B sketchbook · ? help · Esc truce". The start toast explains the autopilot and Esc.
  - First human fight (`c_human.png`, snapshots at 2.5 s and 4.5 s): the help panel opened by itself at about
    1.2 s, and the toast points at ❓ Help.
  - The help panel (`crop_help2.png`) is clear. It covers the goal ("drain his orange bar… keep your cursor
    moving"), tools 1–5, inks, buttons, the tier key, and all 12 shapes with how to draw them and what each
    becomes.
  - So help is visible within 2 s of a fight starting, well inside 5 s.
  - Polish items, filed as DS-13 and not blocking:
    - the HUD is translucent over widgets;
    - the legend shapes are dim unless the pencil is selected, which is always the case in autopilot;
    - he keeps attacking while the first-fight help panel is open.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Ready for QA · Help button, legend and help panel verified in a snapshot; no blocking findings
  - 2026-11-17 · QA · Accepted · Help button, legend and shape strip on screen at 1.5 s; help panel auto-opens at ~1.2 s in the first human fight
  - 2026-11-18 · QA · Accepted (unchanged) · regression check: Help button, legend and auto-opened help (now holding the fight) on screen at 2.5 s

## DS-6 · Esc in the arena only ends the fight
- **Type:** Bug · **Severity:** Low · **Status:** Accepted · **Reporter:** PM
- **Description:** Use `ctx.keys.capture(['Escape'])` while the arena is open, so Esc doesn't also
  collapse a full-screen widget.
- **Acceptance:** with a full-screen widget open, Esc during a fight only ends the fight.
- **Dev notes:**
  - `Arena` calls `ctx.keys.capture(['Escape'])` when it opens and releases it in `destroy()`. Esc in a fight =
    truce; Esc on the result screen skips straight to the cleanup (`cleanupFight` is now idempotent).
    Key events typed into inputs are ignored.
  - Files: `src/ui/arena.js`, `src/game.js`.
  - Verified in an isolated instance with a widget expanded: Esc during the fight ended the fight and the widget
    stayed expanded; the next Esc (fight over, capture released) collapsed it.
- **Review:**
  - `ctx.keys.capture(['Escape'])` is taken in the `Arena` constructor and released in `destroy()`
    (`src/ui/arena.js:44`, `:164-168`). The only path that removes the arena is `cleanupFight` and
    `Game.destroy`, and both call `destroy()`, so the capture can't leak. This matches `WIDGET_API.md` §Keys.
  - Esc during `fight` → truce. Esc during `ending` → `cleanupFight()`. The pending 4.2 s timer is then a no-op,
    thanks to the new `mode !== 'ending'` guard (`src/game.js:579`). Esc still works while the autopilot plays,
    because it is handled before the `if (this.auto) return`.
  - Verdict: Ready for QA. The one leftover risk sits in DS-1: Esc during `ending` with the autopilot holding him
    runs the same unreleased-drag path. That gets fixed there.
- **QA:**
  - Steps: expand a Clock (`__wsState.instances.get('clock-…').setExpanded(true)`), start an autopilot fight, then
    send `keydown` Escape on the shell window.
  - Results:
    - At fight start, focus moved to DeskSprite and `captured` was `['Escape']`.
    - Esc → `mode: ending`, winner `truce`. The clock stayed expanded.
    - After the cleanup, `captured` was `[]`, and the next Esc collapsed the clock.
  - Snapshots: `esc_1_fight_over_expanded.png`, `esc_2_after_first_esc.png` in `…/scratchpad/qa/`.
  - Side finding: in a fight over a full-screen widget, the stickman stays hidden behind the sheet. Filed as DS-8;
    it is outside this ticket's criteria.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · developer · In Progress · started
  - 2026-11-17 · developer · In Review · implemented, see Dev notes
  - 2026-11-17 · reviewer · Ready for QA · capture and release are correct; Esc in `ending` skips to the cleanup, and the guard makes cleanupFight idempotent
  - 2026-11-17 · QA · Accepted · with a Clock expanded, Esc ended the fight only; the clock stayed expanded and the next Esc collapsed it
  - 2026-11-18 · QA · Accepted (unchanged) · regression check: Esc over a full-screen clock ended the fight, the clock stayed expanded, the next Esc collapsed it

---

## DS-7 · Fake error dialogs draw their text out of place
- **Type:** Bug · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Observation:** in most fights the fake error dialogs he throws are drawn wrong:
  - the title starts left of the dialog ("Error 0xSTICK" hangs outside the box);
  - the first words of the body are cut ("…ling Stickman Pro 2.0… 3%");
  - the ⚠ icon sits on top of the text.
  See `crop_L5a_t087.png` and `c_boss.png` in
  `scratchpad/qa/`.
- **Probable cause:** `Popup.draw` (`src/world/objects.js`) never sets `textAlign`. `AppActor.draw`
  (`src/actors/app.js`: the tier tag, "🧹 cleaning up" and "(Not Responding)") sets `gx.textAlign = 'center'`
  outside `save()/restore()`, so the setting leaks into the next draws. The DS-3 tier tags make this happen in
  almost every fight.
- **Acceptance:**
  - With a strong or boss app on screen, the dialogs show the title, ⚠ and body inside the box with no overlap.
  - Every draw that changes `textAlign` (or the font or baseline) restores it.
- **Dev notes:**
  - Root cause confirmed: the tier tag, "🧹 cleaning up" and "(Not Responding)" labels in `AppActor.draw` set
    font and `textAlign` outside `save()/restore()`.
  - Fix:
    - those labels are now inside one `save()/restore()`;
    - `Popup.draw` sets its own `textAlign = 'left'` and `textBaseline = 'alphabetic'`, so it doesn't depend on
      leftover state.
  - Files: `src/actors/app.js`, `src/world/objects.js`.
  - Verified: snapshot with Guardian (boss) and Ping (weak) on screen and two dialogs. Titles, ⚠ and body sit
    inside the box with no overlap.
- **Review:**
  - Fixed. The labels in `AppActor.draw` (tier tag, "🧹 cleaning up", "(Not Responding)", scan) are inside one
    `save()/restore()`. `Popup.draw` sets `textAlign`/`textBaseline` itself. I grepped every `textAlign =` in
    `src/`: each one is inside a save/restore pair (`fx.js` resets to `start` itself).
  - Re-checked: snapshot during a fight with ★ STRONG and ▫ WEAK tags and two fake dialogs on screen. Title, ⚠ and
    body sit inside each box (`scratchpad/r4_popups_tiers.png`).
  - Out of scope, for the record: the existing grayscale `gx.filter` on "not responding" apps (`app.js`, in HEAD
    before this work).
  - Verdict: Ready for QA.
- **QA (round 2):**
  - Tested in the same instance as DS-1's round-2 QA.
  - The dialogs drew cleanly in every fight:
    - L3 with a ▫ WEAK Ping on screen (`crop_L3_s020.png`);
    - L5 (`c_L5.png`);
    - three dialogs forced with two 👑 BOSS apps (Guardian, root Bash) and a weak app on screen
      (`crop_popups_boss.png`).
  - In each: title in the red bar, ⚠ left of the text, body inside the box, OK button in place, no overlap.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · filed during DS-1…6 testing
  - 2026-11-18 · developer · In Review · labels wrapped in save/restore; Popup sets its own alignment; verified in a snapshot with tier tags on screen
  - 2026-11-18 · reviewer · Ready for QA · labels wrapped in save/restore; every textAlign site checked; dialogs verified in a snapshot with tier tags
  - 2026-11-18 · QA · Accepted · dialogs clean with boss/weak tier tags on screen (3 forced dialogs, 2 real-time fights)

## DS-8 · A fight with a full-screen widget open is invisible
- **Type:** Bug · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Steps:** expand a widget (Clock), then start a fight, from the menu or with
  `{"cmd":"fight","autopilot":true,"level":3}`.
- **Observation:**
  - The fight HUD appears over the sheet, but the stickman stays at `layer: 'back'` behind it, and so do the apps.
  - In 15 s his hp went 260 → 219 and nothing of the fight was visible. You fight an invisible enemy.
  - See `sheet_fight_9s.png` and `sheet_fight_15s.png` in `…/scratchpad/qa/`.
- **Acceptance:** when a fight starts while a sheet is open, one of these happens:
  - the stickman, the apps and the fight objects come to the front layer for the fight and go back after it;
  - or the fight doesn't start, with a toast such as "Close the full-screen widget to fight".
  A snapshot 5 s into the fight shows him.
- **Dev notes:**
  - A fight that starts while a widget is full screen (or a sheet that opens during a fight) runs in front of it.
    `game.setFightFront(on)`:
    - paints everything on the front canvas;
    - moves him to the front layer;
    - moves app and file-copy hitboxes to the front layer, so their speech bubbles show too
      (`Hitboxes.setLayer`; new hitboxes are created in the current layer).
  - When the fight ends it switches back: he is behind the sheet again.
  - In front of a sheet only the floor and hole ledges count as platforms, as before.
  - Files: `src/game.js`, `src/ui/hitboxes.js`.
  - Verified:
    - Clock full screen, autopilot L3 fight. Snapshot at 5 s: the stickman, the apps, an app's bubble, cracks and
      a command block are drawn over the clock; `stick.layer === 'front'`.
    - After the truce: `fightFront: false`, `layer: 'back'`.
- **Review:**
  - `setFightFront(on)` (`src/game.js`) is idempotent. It switches the paint target, his layer and every hitbox
    layer (new hitboxes are created in the current layer), and clears the canvas it leaves.
  - Exit paths:
    - `cleanupFight` → `setFightFront(false)`, which covers truce, win, loss and Esc (in fight and in `ending`);
    - the `sheet` event toggles it during `fight` and `ending`;
    - unmount or hot reload drops the whole game, and the host removes its overlay elements.
  - Re-checked in an isolated instance (port 47871):
    - Clock full screen, autopilot L3: at 5 s he, the apps, a bubble and a command block are drawn over the clock
      (`scratchpad/r4_sheet_fight_5s.png`).
    - Esc → `mode chill`, `fightFront false`, `layer back`, hitboxes back; the sheet stayed expanded (DS-6
      unaffected).
    - Opening the sheet mid-fight → front; closing it mid-fight → back.
    - Removing the widget mid-fight while in front: the old game's clock stopped, 0 DeskSprite overlay elements
      were left, and the debug handle was gone. The re-added instance started in chill with `layer back`.
  - Cosmetic, host side: WidgetSystem's "EXIT FULL SCREEN Esc" pill overlaps the middle of the fight's top bar.
  - Verdict: Ready for QA.
- **Dev notes (round 2, PM polish: the host's exit pill overlapped the top bar):**
  - While a fight runs in front of a full-screen widget, the arena gets class `ds-sheet`. That sets
    `--ds-top: 50px`, which moves the whole centre stack down below the host's "Exit full screen" pill: top bar,
    ally bar, legend, toasts, hold pill and help panel. The pill lives in the top 56 px.
  - It switches back if the widget collapses mid-fight.
  - Files: `style.css`, `src/game.js` (`setFightFront`).
  - Verified (snapshot `…/scratchpad/ds8pillc.png`): pill at y 8–36, fight top bar at y 62–117, no overlap. After
    collapsing the widget mid-fight the top bar went back to y 12 and he went back to the back layer.
- **Review (round 2):**
  - `setFightFront` toggles `.ds-sheet` on the arena element (`src/game.js`). In `style.css` that sets
    `--ds-top: 50px`, which shifts the top bar, ally bar, legend, toast, hold pill and help panel down together.
  - A stuck offset can't happen: the class lives on the arena element, which is a new element for each fight and
    is removed at cleanup and on unmount.
  - Re-checked in an isolated instance (port 47871), top bar `top`:
    - start with the sheet open → `.ds-sheet`, 62 px;
    - sheet closed mid-fight → removed, 12 px;
    - reopened → back to 62 px;
    - Esc → arena gone;
    - next fight without a sheet → no class, 12 px;
    - unmount mid-fight with the sheet open → 0 arenas left; the re-added instance's fight had no class.
  - Snapshot: the exit pill sits clear above the HUD (`scratchpad/r5_sheet_hud_offset.png`).
  - Verdict: Ready for QA.
- **QA (round 2):**
  - Clock full screen, then an autopilot L3 fight (`sheet_5s.png`, `sheet_10s.png`). At 5 s:
    - `layer: front`, `fightFront: true`;
    - the stickman, the apps, cracks and bubbles are drawn over the clock;
    - the arena has `ds-sheet`; the top bar sits at y 62–117 and the exit pill at y 8–36, so they don't overlap.
  - Collapsing the clock mid-fight → `layer: back`, top bar at y 12. Re-expanding → front again, top bar at 62.
  - Plain path (DS-6): expand, start the fight, Esc → truce, the clock stays expanded, and the next Esc collapses
    it.
  - Edge case seen, not a defect: after `setExpanded(true)` mid-fight the host focuses the clock, so the next Esc
    collapses the clock rather than ending the fight. A user can't reach a widget's expand button through the
    arena, so only a script hits this.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · found while testing DS-6
  - 2026-11-18 · developer · In Review · fight runs in front of a full-screen widget and goes back after; verified by snapshot
  - 2026-11-18 · reviewer · Ready for QA · front/back switch verified for start, open/close mid-fight, Esc and unmount mid-fight; no stuck state
  - 2026-11-18 · developer · In Review · fight HUD steps below the host exit-full-screen pill while a sheet is open; verified by snapshot
  - 2026-11-18 · reviewer · Ready for QA · round 2: HUD offset toggles with the sheet, no stuck .ds-sheet after Esc/unmount; pill clear in snapshot
  - 2026-11-18 · QA · Accepted · fight drawn over a full-screen clock; HUD below the exit pill (62 vs 8–36 px); front/back toggles on collapse and re-expand

## DS-9 · Level curve: levels 1–2 are a foregone conclusion, level 5 no stronger than level 4
- **Type:** Balance · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Observation** (round-2 bench, autopilot; the full table is in DS-2's QA section):
  - His wins: L1 0/10, L2 0/8, L3 7/20, L4 6/8, L5 7/10.
  - At L1 the autopilot wins every fight and keeps 40–88 desk hp (median 67). L2 looks the same (median 60).
  - The real-time L1 fight was one-sided: 51 s, 36 desk damage, 9 distinct moves.
  - L5 (70%) is no stronger than L4 (75%), and L2 → L3 is a cliff (0% → 35–50%).
  - An L1 or L2 exhibition is not fun to watch, because the result is never in doubt.
- **Acceptance:** a bench of 10+ autopilot fights per level shows:
  - win rates that rise with level, roughly L1 10–25%, L2 20–35%, L3 35–50% (keep), L4 45–60%, L5 55–70%;
  - no level where the autopilot wins with ≥ 80 desk hp left in more than 1 of 10 fights.
- **Dev notes:**
  - Root causes:
    - **L2 → L3 cliff:** level 3 doubled his blast volume (two blasts instead of one). His damage rate to the
      desk was nearly flat from L3 to L5.
    - **L4 jump:** level 4 added attack-cancelling dodges all at once.
    - **Level 1:** has far fewer moves.
  - Changes:
    - per-level blast homing (1.0 → 2.2 rad/s);
    - a per-level chance of a second blast (30% → 90%);
    - a per-level attack-cancel chance (0 / 0 / 0 / 15% / 40%);
    - the level table re-tuned (`power()` in `src/stickman/brain.js`). Level 1 has more hp and a higher per-move
      damage factor, because its kit is so small.
    - This supersedes the table in DS-2's Dev notes.
  - **Bench method:** `G.bench(level, n)` now starts every fight from an empty roster (the 2 random starter allies
    still join), so runs are comparable. Even so, 50-fight runs at identical settings differed by up to ±10
    points, so the numbers below are 100 fights per level.

    | level | wins | target | autopilot wins with ≥ 80 desk hp | durations |
    |---|---|---|---|---|
    | 1 | 19% | 10–25% | 9/100 | 75–143 s |
    | 2 | 24% | 20–35% | 7/100 | 53–120 s |
    | 3 | 44% | 35–50% | 4/100 | 66–129 s |
    | 4 | 52% | 45–60% | 2/100 | 64–126 s |
    | 5 | 70% | 55–70% | 0/100 | 52–138 s |

    - Win rates rise with every level.
    - L5 sits at the top edge of its band; at these settings it measured 57–76% across runs.
- **Review:**
  - The `power()` table, `HOMING`, `DOUBLE` and `CANCEL` per level (`src/stickman/brain.js:28-50`) are read
    where they are used (`fireBlast(g.power.homing)`, `chance(g.power.double)`, `threatCancel`). No logic
    problems found. The balance numbers are QA's to judge.
  - The L3 sample from my DS-1 bench (6/10 wins, n=10) is within the ±10 points the developer reports.
  - Nit: on `brain.js:44` the comment for `cancel` ("chance to abort an attack to dodge") was pasted after the
    `double` comment; it belongs on the `cancel:` line.
  - Verdict: Ready for QA.
- **Dev notes (round 2, review nit):** the misplaced comment in `power()` is fixed (the attack-cancel comment
  sits on `cancel` again). No behaviour change.
- **Review (round 2, nit):** the `cancel` comment is back on its own line in `power()` (`brain.js:42`). Comment
  only, no behaviour change.
- **QA (round 2):**
  - 2 × 100 autopilot fights per level (`bench_L*_a/b.json`):

    | level | his wins (2 runs) | total | target | autopilot wins with ≥ 80 desk hp | desk left when the autopilot wins (median) |
    |---|---|---|---|---|---|
    | 1 | 20% · 20% | 20.0% | 10–25% | 10/200 | 54 |
    | 2 | 33% · 23% | 28.0% | 20–35% | 15/200 | 48.5 |
    | 3 | 50% · 45% | 47.5% | 35–50% | 9/200 | 40 |
    | 4 | 51% · 55% | 53.0% | 45–60% | 4/200 | 33 |
    | 5 | 71% · 62% | 66.5% | 55–70% | 3/200 | 30 |

  - Every level is inside its band, and the curve rises at every step.
  - The worst one-sided rate is L2: 15/200 = 7.5%, under the 1-in-10 limit. The two L2 runs differed by 10
    points, as the developer warned.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · filed from the DS-2 benches
  - 2026-11-18 · developer · In Review · curve smoothed: L1–L5 = 19/24/44/52/70% (100 fights each), stomps ≤ 9/100
  - 2026-11-18 · reviewer · Ready for QA · level table and per-level blast/cancel wiring reviewed; one misplaced comment (nit)
  - 2026-11-18 · developer · Ready for QA (unchanged) · review nit folded in: comment fix in power(), no behaviour change
  - 2026-11-18 · reviewer · Ready for QA (unchanged) · nit fix checked (power() comment); status unchanged
  - 2026-11-18 · QA · Accepted · 200 fights/level: 20 / 28 / 47.5 / 53 / 66.5%, all in band; one-sided wins ≤ 7.5%

## DS-10 · He gets hurt by his own drawn weapons
- **Type:** Bug · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Observation:**
  - Test: an exhibition at L3 with the autopilot stopped, every app removed, and the desk pinned at 100. 40 s of
    fast-forward, 3 trials.
  - With nothing on the player's side, he still took 0, 15 and 99 damage (`drawn` 15–59, `burn` 40). The only
    objects were his own (`drawn`, owner `stick`).
  - Probable cause: the object-vs-stickman check in `src/game.js` (around the `s.hurt(dmg, kx, ky, { obj: o })`
    line) hurts him with any fast object, whatever its `owner`, once `thrownAt` is cleared. His fire-ink drawings
    also set `burn`.
  - Leftovers frozen by a cleanup that a new fight cancels are still live objects and can hit him the same way.
  - Self-damage also shows up in normal benches (`drawn` and part of `burn` in `bySource`), which makes him
    weaker than designed.
- **Acceptance:**
  - Objects he made never damage him, unless the player or an ally grabbed, threw or deflected them.
  - The test above shows 0 `drawn`/`burn` damage over 3 × 40 s.
- **Dev notes:**
  - Root cause: the object-vs-stickman check only skipped his objects that had an item or a finite life. His
    drawn swords and staffs (life ∞), dropped weapons, fire drawings and frozen leftovers could hit and burn him.
    File copies he kicked or ground-pounded could also fly back into him.
  - Fix (`src/game.js` `combat`):
    - objects with `owner === 'stick'` never hurt him;
    - a file copy he just kicked is ignored for 2.5 s;
    - an object you grab with ✋ (`arena`), or deflect with a 🛡️ shield (`sketch.js`), becomes `owner: 'user'`, so
      it can hurt him again.
  - Files: `src/game.js`, `src/ui/arena.js`, `src/world/sketch.js`, `src/stickman/brain.js`,
    `src/stickman/tricks.js`.
  - Verified with QA's test (exhibition L3, autopilot stopped, apps removed, desk pinned): 6 × 40 s → 0 damage
    taken in every trial, with his own objects lying around.
- **Review:**
  - `combat()` skips `owner === 'stick'` objects unless he threw them (`thrownAt`; those only aim at the cursor and
    apps). Kicked file copies get a 2.5 s grace period. Grabbing (`arena.js`) and the shield deflect (`sketch.js`)
    hand an object to the player.
  - Re-checked:
    - QA's test (exhibition L3, autopilot off, apps removed, desk pinned), 3 × 40 s: 0 damage taken each time,
      with 2–4 of his objects on the field.
    - Positive check: his fire weapon grabbed with ✋ became `owner: 'user'` and, flung at him, hit for 15 (+ burn).
      The same fling with `owner: 'stick'` restored did no new damage.
  - Note, by design: a user weapon he steals stays his after he drops it, until the player grabs it back. That
    matches the acceptance ("unless the player … grabbed …").
  - Verdict: Ready for QA.
- **QA (round 2):**
  - QA's test, run 6 times: an exhibition at L3, autopilot stopped, every app removed each step, desk pinned,
    40 s of fast-forward (`solo.json`).
  - He took 0 damage in all 6. His own `drawn` objects were on the field each time, fire-ink ones included
    (`drawn:fire:stick`), plus leftover text blocks.
  - In 1,000 bench fights `drawn` damage totals 0–43 per 200 fights, about 0.1 per fight. That is user drawings
    the report labels generically, not self-hits.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · found while measuring DS-3
  - 2026-11-18 · developer · In Review · his own objects never hurt him (grabbed/deflected ones do); QA test 6 × 40 s → 0 damage
  - 2026-11-18 · reviewer · Ready for QA · QA's test 3 × 40 s → 0 self-damage; grabbed objects hurt him again
  - 2026-11-18 · QA · Accepted · 6 × 40 s solo test: 0 self-damage with his own (fire) drawings on the field

## DS-11 · High CPU while he is awake after a fight
- **Type:** Performance · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Observation:**
  - Measured with `top -b -n 2 -d 5` on the instance's WebKitWebProcess, after a fight and its cleanup, while he
    chilled (fishing, riding, skating, push-ups) for over 2 minutes.
  - Total: 18–24%. With DeskSprite's frame loop stopped: 6%. So DeskSprite costs about 12–18% of a core while
    awake and not fighting.
  - He didn't go dormant in the ~2.5 min after the fight. He did fall asleep later.
- **Acceptance:**
  - DeskSprite's share in awake chill is about 5% of a core or less, measured the same way. Ideas: a 30 fps cap
    outside fights, skip unchanged frames, smaller dirty areas.
  - Dormant stays near 0.
- **Dev notes:**
  - Measured the WebKitWebProcess of an isolated instance (clock, sysmon, Mochi, fsck) with `top -d 15–18`, 4
    apps, awake chill. The readings are noisy: ±3 points depending on what he and the apps are doing.
  - Findings:
    - On this host every screen change costs a full-screen recomposite: about 0.6% of a core per change,
      whatever its size. Partial (dirty-rect) canvas repaints made no measurable difference, so they were
      removed again.
    - The cost is therefore mostly how many distinct changes per second happen.
    - An empty 60 Hz `requestAnimationFrame` alone cost about 5 points.
  - Changes:
    - **Chill loop:** a 30 Hz timer instead of a 60 Hz animation frame. Physics runs in 1/60 s substeps, so
      throws and ragdolls behave exactly as before. Fights stay at 60 Hz.
    - **Repaint rate:** chill repaints at most 10 fps while something moves (was 24), and 5 fps when nobody has
      touched the mouse for 30 s. Unchanged frames are still skipped; asleep stays at 10 fps.
    - **Hitboxes:** DOM moves ride along with repaints. Hitboxes near the pointer or of a talking character
      update every repaint; all others catch up together once a second.
    - **Nest card:** it rewrote 5 text nodes, the bars and the button every 400 ms whatever changed (≈13 DOM
      mutations/s); it now writes only changes. The stick hitbox's `display` write is also skipped when
      unchanged.
    - **Calmer apps:** they pause 6–16 s between strolls (was 3–9 s).
  - Result on a fresh instance:

    | state | WebKit CPU |
    |---|---|
    | no DeskSprite | 2.4% |
    | asleep (dormant) | 4.7% |
    | awake, pointer active | 15–18% (one sample 21%) |
    | awake, away (no mouse 30 s) | 11–15% |
    | awake, old settings (60 Hz, 15–24 fps, per-frame DOM writes) | 25–28% |

    - DeskSprite's awake share is now about 9–13 points (away) and 13–16 points (active), against the ~5%
      target.
  - **Status:** the ~5% target is NOT reached. In this host the floor while something animates is roughly JS
    (~5%) + 0.6% per changed frame. Getting under 5% would mean animating at ~3–4 fps, or a host change: for
    example, compositing the widget layer only where it changed, or giving creature canvases their own surface.
    PM's call. Dormant (asleep) is near 0 as required (+2.3 points).
  - Files: `src/game.js`, `src/ui/hitboxes.js`, `src/ui/nest.js`, `src/actors/app.js`.
- **Review:**
  - Code is sound:
    - Chill runs on `ctx.every(33)` and fights on `ctx.raf`. `startLoop()` switches on every mode change and in
      `wake()`, and the host cancels both on unmount. Verified: after removing the widget in chill, and also
      mid-fight, the old game's clock stopped.
    - Physics substeps (`round(dt * 60)`) keep throws the same.
    - Lazy hitboxes still update anything within 400 px of the pointer or talking, every repaint. The nest card
      and the stick hitbox `display` only write on change.
    - No new rAF, listener or interval outside `ctx`.
  - **Acceptance is not met, by the developer's own numbers:** 9–16 points awake against the ~5% target. Dormant
    is still near 0. The host-floor analysis is plausible, but whether to accept it, change the target, or ask for
    a host change is the PM's decision. QA should measure the same way and record it. I am passing the code, not
    the target.
  - Verdict: Ready for QA (with a PM decision on the target).
- **QA (round 2):**
  - `top -b -n 2 -d 15` on the instance's WebKitWebProcess, with clock ×2, sysmon, Mochi and fsck. "Active"
    means a pointer simulated in the page (moved every 200 ms, `lastMove` refreshed).

    | state | samples | median |
    |---|---|---|
    | no DeskSprite (instance removed) | 4.0, 5.9, 3.7 | 4.0% |
    | asleep, dormant | 5.9, 6.1 (10.9 once an app woke the loop) | 6.0% |
    | awake, away | 12.8, 13.6, 17.5, 15.5 | 14.5% |
    | awake, pointer active | 15.1, 15.8, 14.5, 13.1 | 14.8% |
    | in a fight (60 Hz) | 35.7, 36.9 | 36% |

  - DeskSprite's share: about +2 points asleep, +9–13 awake, +32 in a fight. In my round-1 measurement (old
    code, baseline 6%) it was +12–18 awake.
  - The reductions work: the awake share fell by roughly a third. Nothing broke: throws, ragdolls, landing after
    levitation, cleanup walks and dormancy all behaved normally in the round-2 fights.
  - The ~5% target is not reached, as the ticket says (host floor). How it feels: chill animation still looks
    smooth at the lower repaint rate; I saw no stutter in snapshots or traces. The target itself is the PM's and
    user's call.
  - **Verdict: Accepted** for the implemented reductions, per the PM's instruction. The ~5% target stays open as a
    PM decision.
- **History:**
  - 2026-11-17 · QA · Open · measured during DS-1…6 testing
  - 2026-11-18 · developer · In Review · awake cost roughly halved vs old settings (25–28% → 11–18% total); ~5% target not reached, host floor documented for the PM
  - 2026-11-18 · reviewer · Ready for QA · loop/timer/hitbox/nest changes sound, no leaks on unmount; CPU target still unmet by dev's numbers, PM decision needed
  - 2026-11-18 · QA · Accepted · reductions verified: awake +9–13 points over a 4% baseline (was +12–18), asleep +2, fight +32; ~5% target unmet (PM decision)

## DS-12 · Fights are hard to read: crack clutter and floor-only action
- **Type:** UX / fun · **Severity:** Medium · **Status:** Accepted · **Reporter:** QA
- **Observation:**
  - Mid-fight, 13–21 cracks cover the screen until someone presses 🩹 Repair (L3 at 46 / 52 / 58 s: 13 / 20 / 21
    cracks, `c_L3a_mid.png`).
  - The fighters are about 60 px tall and spend most of the fight in the bottom ~150 px of a 1048 px screen. The
    rest is empty space plus cracks.
  - Snapshots every 5–6 s often show nothing happening anywhere but the floor strip (`c_L5a_a.png`, `c_L5a_b.png`).
  - The moments themselves are good (banners, labels, damage numbers). They are just small and low.
- **Acceptance:**
  - At most about 8 cracks are visible at once (the oldest fade).
  - In a 90 s L3 autopilot fight he spends ≥ 25% of the time above the bottom 200 px (widget tops, jumps,
    teleports), checked with a per-second trace of `stick.y`.
  - Snapshots every 5 s let a viewer tell who is doing what.
- **Dev notes:**
  - **Cracks:**
    - at most 8 open cracks; beyond that the oldest fades quickly (`MAX_CRACKS` in `src/fx/fx.js`);
    - cracks kept for fsck's crack tickets are never faded by the cap.
    - Measured over 5 L3 fights: max open cracks 8; max visible (still fading) 8–10.
  - **Height:**
    - **Levitate:** a new fight move. He floats 230–380 px up and keeps fighting from the air (blasts, slashes,
      moving sideways) for 10–16 s. A jump or dodge doesn't end it, a knockdown does.
    - **Perch:** a new fight move. He runs up onto a widget top.
    - `stick.top` gives where his feet are, including the hover, so traces of `stick.y` should use `stick.top`
      (`stick.y` stays on the floor while he floats).
    - `fightReport().aboveBottom200` gives the share of the fight he spent above the bottom 200 px.
  - Measured: 28–35% per level over 100-fight benches (L3: 29–33%). Per-second traces of `stick.top` in single L3
    fights showed 20–45%.
  - Files: `src/fx/fx.js`, `src/world/cleanup.js`, `src/stickman/brain.js`, `src/stickman/stickman.js`,
    `src/game.js`.
- **Review:**
  - Cracks: the cap is fine. `fx.crack()` fades the oldest open cracks past 8 (`MAX_CRACKS`, `src/fx/fx.js`).
    Cracks pinned for fsck (`c.ticket`) are exempt and heal on resolve or expire, or when `cleanup.cancel()` runs
    at the next fight. Re-checked over a 10-fight L3 bench: open cracks peaked at exactly 8.
  - Height: over the same 10 fights `aboveBottom200` was 0.21–0.64; 3 of 10 were under 0.25 (0.21, 0.22, 0.24).
    QA to judge against "≥ 25% in a 90 s L3 fight".
  - **Bug (blocker): he stays floating after a fight that ends while he levitates.**
    - Cause: `levitateTick` only runs inside `fight()` (`src/stickman/brain.js:636`), and `levT` is only reset in
      `startFight`. After the fight `levT` stays > 0, so `floating` stays true (`brain.js:87`) and the hover
      never decays.
    - Reproduced: levitate, then `endFight('truce')`. 30 s later in chill: `levT 9`, `hover 377`, `top 669`, so
      he juggles about 380 px above the floor (`scratchpad/r4_float_after_fight.png`). It lasts until the next
      fight. `canDoze` can still pass, so he can fall asleep floating.
    - Benches and autopilot fights hit this often (levitate has weight 24 + 2·level).
  - **Required change:**
    1. End the levitation when the fight ends: set `brain.levT = 0` in `cleanupFight` (or `endFight`), or let
       `update()` drop it whenever `mode !== 'fight'`. The existing decay then brings him down.
- **Dev notes (round 2, review: floating after the fight):**
  - Root cause as the reviewer found: `levT` only counted down inside `fight()` and was reset only by the next
    `startFight`.
  - Fix:
    - `Brain.update()` drops `levT` whenever `mode !== 'fight'`. That covers every way a fight ends (win, loss,
      truce, Esc on the result screen, autopilot, bench), because they all leave `fight` mode; the existing hover
      decay then brings him down.
    - `canDoze()` also refuses while he is still hovering (`hover > 1`).
  - Files: `src/stickman/brain.js`, `src/game.js`.
  - Verified in an isolated instance (levitating at 300–430 px, then the fight ended):

    | ending | 1.5 s later | 30 s later |
    |---|---|---|
    | truce | `levT 0`, hover 0 | feet on the floor |
    | he loses | `levT 0`, hover 0 (result screen) | feet on the floor |
    | he wins | `levT 0`, hover 0 (result screen) | feet on the floor |

    - After `bench(3, 2)`: `levT 0`.
    - Sleep forced right after a mid-float truce: hover 2 px at 0.5 s, then 0.
    - `canDoze()` asleep on the ground: true; with 50 px of hover: false.
- **Review (round 2):**
  - Fixed. `Brain.update` clears `levT` whenever `mode !== 'fight'`, so every exit path is covered (`ending`,
    chill, Esc). The existing decay brings the hover down. `canDoze` refuses while `hover > 1`.
  - Re-checked my repro in an isolated instance (port 47871): levitate (hover 280), then `endFight('truce')`.
    Already in `ending`, `levT` was 0 and hover falling (84). In chill, hover was 0 and his feet on the floor;
    30 s later still 0.
  - Doze guard: asleep, `canDoze()` was false with `hover = 50` and true with `hover = 0`, and he then went
    dormant.
  - Verdict: Ready for QA.
- **QA (round 2):**
  - **Cracks:** at most 8 open and 9 visible (one fading) in each real-time fight (L3, L5); 4 at L1. pass.
  - **Height**, from per-second traces of `stick.top` in real time: L3 59%, L5 35%, L1 28% of the fight above the
    bottom 200 px.
    - Bench `aboveBottom200`, 1,000 fights: median 0.30–0.32 per level, minimum 0.07.
    - Fights under 0.25: L1 47/200, L2 57, L3 50, L4 44, L5 38. So about a quarter of fights fall under the bar,
      while the typical fight clears it.
    - Judged by eye: it reads well. Levitation puts him mid-screen with blasts and slashes, perching uses widget
      tops, and every 5 s snapshot showed who was doing what. pass.
  - **Landing after a fight that ends mid-float**, each case levitating at 205–254 px:
    - truce: `levT 0`, hover 0 within 1.5 s;
    - he loses: the same, on the result screen;
    - he wins: the same.
    6 s later all three were on the floor (`float_end_*.png`), and no traced chill second showed hover.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · fun-to-watch review of the real-time fights
  - 2026-11-18 · developer · In Review · crack cap 8 (oldest fades fast); levitate/perch moves: 28–35% of fight time above the bottom 200 px
  - 2026-11-18 · reviewer · In Progress · crack cap verified (max 8); blocker: he keeps floating in chill if a fight ends mid-levitate
  - 2026-11-18 · developer · In Review · levitation ends with any fight ending; no dozing while hovering; verified for truce, win, loss and bench
  - 2026-11-18 · reviewer · Ready for QA · round 2: no float after a fight that ends mid-levitate; doze refused while hovering; verified live
  - 2026-11-18 · QA · Accepted · cracks ≤ 8 open; real-time height 59/35/28% (L3/L5/L1), bench median 0.31; lands after truce/win/loss mid-float

## DS-13 · Fight HUD contrast and the first-fight help
- **Type:** UX · **Severity:** Low · **Status:** Accepted · **Reporter:** QA
- **Observation:**
  - The HUD panels are translucent, so widgets under them (clock digits, sysmon, the nest's FIGHT button) show
    through the ally bar and the legend (`crop_hud.png`, `crop_L1a_t001.png`).
  - The legend shapes are dimmed unless the pencil is selected, which is always the case while the autopilot
    plays.
  - In the first human fight the help panel opens by itself, but he already attacks while you read it.
- **Acceptance:**
  - Widget text under the HUD can't be read through it.
  - The legend reads at a glance with any tool selected.
  - While the auto-opened help panel is showing, he waits, or the fight starts when it closes.
- **Dev notes:**
  - HUD panels (top bar, tools, ally bar, legend, autopilot badge) have an opaque background (`#17151d`); widgets
    under them no longer show through.
  - The legend's shapes are no longer dimmed when the pencil isn't selected.
  - The first human fight is held while the auto-opened help panel shows:
    - only the HUD runs, with no AI, physics or fight clock, and an orange "⏸ The fight starts when you close the
      help" pill;
    - closing the help (✕, `?`/`H`, or clicking into the arena) starts it with a "FIGHT!" toast.
  - Files: `style.css`, `src/ui/arena.js`, `src/game.js`.
  - Verified:
    - 4 s into a first fight: `hold: true`, `fightT 0`, desk 100, no stick moves;
    - after closing: `hold: false`, and he acted (5 moves in 3 s);
    - snapshot: the sysmon widget under the ally bar is fully covered.
- **Review:**
  - The opaque HUD (`#17151d`) and undimmed legend are in `style.css`, and the HUD covered the clock fully in my
    sheet-fight snapshot. The hold design is clean: `step()` returns early and only the HUD and timers run.
    ✕, `?`/`H` and clicking into the arena all release it.
  - **Bug:** pressing **B** while the first fight is held hides the help but keeps the fight held. `toggleBook`
    removes `.show` from the help panel directly (`src/ui/arena.js:197`) instead of going through
    `toggleHelp(false)`.
    - Reproduced: first fight → `hold: true`; press B → help hidden and sketchbook open, but still `hold: true`,
      `fightT 0`, and the "⏸ The fight starts when you close the help" pill still shows with no help visible.
    - It recovers on a click into the arena, or `?` twice. That breaks the acceptance ("the fight starts when it
      closes").
  - Nit: the HUD colour is hard-coded `#17151d` while the rest of the HUD follows theme tokens. Consider
    `var(--ws-panel-solid, #17151d)` or similar if the theme provides an opaque token.
  - **Required change:**
    1. When the sketchbook hides the help during a hold, release the hold too: call `toggleHelp(false)` from
       `toggleBook`, or `setHold(false)` with the "FIGHT!" toast.
- **Dev notes (round 2, review: B during the held first fight):**
  - Root cause: `toggleBook` hid the help panel directly, bypassing `toggleHelp(false)`, which is what releases
    the hold. It now calls `toggleHelp(false)`. Every way the help can close goes through `toggleHelp`, so the
    hold always clears.
  - Review nit: the HUD background is a token, `--ds-hud-bg: var(--ws-panel-solid, #17151d)`. No theme defines an
    opaque panel token today (`--ws-panel` is translucent in both themes), so the dark fallback applies; a theme
    can override it.
  - Files: `src/ui/arena.js`, `style.css`.
  - Verified: in a held first fight, each closing path was tried in turn. B (the sketchbook opens), `?`, `H`,
    `F1`, the ✕ button and a click into the arena each gave `hold: false`, the pill gone, `fightT` running.
    Esc ends the fight (truce), as designed.
- **Review (round 2):**
  - Fixed. `toggleBook` routes through `toggleHelp(false)` when it opens (`src/ui/arena.js`), which releases a
    hold with the "FIGHT!" toast. Hiding the help now goes only through `toggleHelp`, so it can't hide while
    the fight stays held.
  - Re-checked my repro: first fight held (`hold true`, help shown, pill shown); B → `hold false`, help hidden,
    sketchbook open, pill hidden; the fight ran (`fightT` 2 s, his moves recorded). Edge cases: B again closes the
    book; `?` twice opens and closes help with no re-hold.
  - HUD colour: `--ds-hud-bg: var(--ws-panel-solid, #17151d)`. For the record, no WidgetSystem theme defines
    `--ws-panel-solid` today, so the fallback is always used. That's fine; the token is only a hook.
  - Verdict: Ready for QA.
- **QA (round 2):**
  - First human fight with `sawHelp` reset before each try. Every closing path tested: ✕, `?`, `h`, `H`, `F1`, `B`,
    and a click into the arena.
    - Before closing: `hold: true`, the pill shown, `fightT 0`, desk 100, 0 stick moves.
    - After closing, every path gave `hold: false`, the pill hidden, `fightT` 3.1 s and 1–4 stick moves. `B` opened
      the sketchbook and started the fight.
  - HUD: opaque. The clock and sysmon under the ally bar and legend no longer show through (`crop_held.png`), and
    the legend shapes are undimmed during autopilot.
  - New defect found, filed as DS-15: while the fight is held, the white fight-start flash freezes at
    `flashA 0.6`. The whole screen stays washed at about 36% white until the help closes (pixel (255,255,255,92)
    after 8 s of hold, `held_8s.png`). It doesn't break this ticket's criteria.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · from DS-5 testing
  - 2026-11-18 · developer · In Review · opaque HUD, undimmed legend, first-fight help holds the fight until closed; verified
  - 2026-11-18 · reviewer · In Progress · opaque HUD and hold reviewed; B during the held first fight hides the help but keeps the fight held
  - 2026-11-18 · developer · In Review · B and every other help-closing path release the hold; HUD colour is a token; verified
  - 2026-11-18 · reviewer · Ready for QA · round 2: B during the held first fight starts it; help/hold edge cases checked live
  - 2026-11-18 · QA · Accepted · all 7 help-closing paths (✕ ? h H F1 B click) release the hold; opaque HUD; frozen start flash filed as DS-15

## DS-14 · Editing any file in the DeskSprite folder hot-reloads the widget, including the user's own instance
- **Type:** Process / dev tooling · **Severity:** Low · **Status:** Accepted · **Reporter:** QA
- **Observation:**
  - WidgetSystem detects changes from the newest mtime of any file in the widget folder (`registry._dir_version`),
    and the user's own config lists this folder.
  - During this QA session the log showed 15+ `[reload] desksprite` lines from code and `tracker/TICKETS.md`
    edits. Each one restarts the stickman in every instance that loads this folder, and a fight in progress is
    lost.
  - After quick back-to-back reloads, `window.__desksprite[id]` pointed at the old, frozen Game for a while
    (overlapping remounts), which misleads QA and debug scripts.
- **Acceptance:**
  - Editing `tracker/*.md` or `README.md` doesn't reload the widget: move the tracker out of the widget folder, or
    have the watcher ignore it.
  - After a reload, `window.__desksprite[id]` always points at the live game.
- **Dev notes:**
  - The host part was done by the PM: the watcher ignores `tracker/`, docs and `.md`.
  - My part, in `main.js`: on unmount the debug handle is deleted only if it still points at this game. An
    overlapping remount therefore can't wipe the new handle, and the mount always overwrites it with the live
    game.
  - Verified in an isolated instance:
    - after 3 back-to-back reloads, `window.__desksprite[id]` was the new game, with its clock advancing;
    - touching `tracker/TICKETS.md` and `README.md` produced no `[reload]`.
- **Review:**
  - `main.js` only deletes the debug handle if it still points at this game. Verified: removing an instance
    cleared its handle, and the re-added instance got a fresh, live one. The `tracker/` and `.md` watcher change is
    host-side (PM).
  - Nit (optional): the handle is set after `await game.start()`. In a rare overlap where an older mount's
    `start()` finishes after the newer mount set its handle, the old game would overwrite the handle and then
    delete it on its own unmount. Setting the handle right after `new Game(ctx)`, before the `await`, closes that
    window.
  - Verdict: Ready for QA.
- **Dev notes (round 2, review nit):**
  - The debug handle is now set before `await game.start()`, so during a remount it never points at the previous
    instance. It's removed again if `start()` throws, so a failed mount can't leave a stale handle. The unmount
    still removes it only if it points at this game.
  - Files: `main.js`.
  - Verified: after 3 back-to-back reloads the handle pointed at the new game, with its clock advancing.
- **Review (round 2, nit):** `main.js` sets the handle before `await game.start()` and drops it if `start()`
  throws (only if it still points at this game). Verified: the handle was there for the re-added instance, and
  removing the instance cleared it.
- **QA (round 2):**
  - `touch tracker/TICKETS.md README.md` → no `[reload]` line in the log.
  - Three overlapping `remount()` calls 150 ms apart. Afterwards `window.__desksprite[id]` was the live game (same
    ctx as the instance, clock advancing), with no extra overlay hosts.
  - **Verdict: Accepted.**
- **History:**
  - 2026-11-17 · QA · Open · seen during DS-1…6 testing
  - 2026-11-18 · developer · In Review · debug handle only removed by its own game; verified after 3 quick reloads
  - 2026-11-18 · reviewer · Ready for QA · handle guard verified on remove/re-add; optional nit on handle ordering
  - 2026-11-18 · developer · Ready for QA (unchanged) · review nit folded in: handle set before start (dropped if start fails); verified after 3 quick reloads
  - 2026-11-18 · reviewer · Ready for QA (unchanged) · nit fix checked (handle before start, dropped on failure); status unchanged
  - 2026-11-18 · QA · Accepted · md/tracker edits don't reload; handle live after 3 overlapping remounts

## DS-15 · The fight-start flash freezes over the screen while the first-fight help holds the fight
- **Type:** Bug · **Severity:** Low · **Status:** Accepted · **Reporter:** QA
- **Steps:** a first human fight (`sawHelp` unset), so the help opens and holds the fight. Wait 8 s, then
  snapshot.
- **Observation:**
  - `startFight` fires `fx.flash(0.6, '#ffffff')`, but while the fight is held `step()` returns before the fx
    update, so `fx.flashA` stays at 0.6.
  - The whole screen stays washed with about 36% white (pixel (255,255,255,92)) behind the help panel until it
    closes. After closing, the flash fades normally (`held_8s.png` vs `after_release.png` in `scratchpad/qa2/`).
  - Speech bubbles also stay frozen in place during the hold. One sat half-hidden between the top bar and the
    ally bar (`crop_held.png`).
- **Acceptance:**
  - During a held first fight the start flash fades within ~1 s as usual, or is deferred until the fight starts.
  - A snapshot 5 s into the hold shows no white veil.
- **Dev notes:**
  - Root cause confirmed: while the first fight is held, `Game.step()` returns before `fx.update()`, so the start
    flash (`fx.flash(0.6, '#fff')`) and the start particles froze.
  - Fix: the held branch also runs `this.fx.update(dt)`. The effects keep fading (flash, particles, shake), while
    the AI, physics and fight clock still wait.
  - Speech bubbles: they anchor to their speakers, who are frozen during the hold, so a bubble also stays put
    until it times out. The one QA saw between the top bar and the ally bar belonged to an app standing high on
    the screen. Left as is; it's not part of this ticket's acceptance.
  - Files: `src/game.js`, one hunk in `step()`.
  - Verified in an isolated instance (first fight, `sawHelp` unset):
    - `flashA` 0.6 → 0.15 at 0.25 s → 0 at 0.5 s, with `hold` still true and `fightT` 0;
    - snapshot 5 s into the hold: no white veil. Sampled pixels show only the faint red fight vignette (alpha
      6–11, against 92 before).
- **Review:**
  - One line in the held branch of `step()` (`src/game.js:1051`). `fx.update` is purely cosmetic: particles
    (they read platforms only for bouncing), fading cracks, bolts, beams, rings, popText, shake, flash and
    glitch. It changes nothing outside `FX`: no hp, no fight clock, no AI, no objects. Ticketed cracks aren't
    `healing`, so they don't fade early.
  - Ticking them while held is right: the start flash, the summon bolt and any healing cracks from the last
    fight finish instead of freezing on screen.
  - Re-checked in an isolated instance (port 47871), first fight with `sawHelp` unset:
    - `flashA` was 0.6 → 0.27 at 0.3 s → 0 at 5 s, with `hold` still true;
    - during the hold: `fightT` 0, his position unchanged, 0 moves, 0 damage either way;
    - after release, the fight ran (3 moves in 2 s);
    - a snapshot 5 s into the hold had pixel alpha 8–12 (only the fight vignette, against QA's 92);
      `scratchpad/r6_held5s.png`.
  - Note (pre-existing since DS-13, not this change): game timers keep firing during the hold, so the
    second starter ally is summoned while held. It stands still until the fight starts. That's harmless.
  - Verdict: Ready for QA.
- **QA (re-test):**
  - Tested on the uncommitted working-folder diff (`git diff -- src`) applied to a worktree of HEAD aa7018e, in an
    isolated instance (port 47861).
  - First human fight with `sawHelp` reset, the help holding the fight:
    - `fx.flashA` was already 0 at 0.5 s into the hold (before the fix it stayed at 0.6);
    - a snapshot after 10 s of hold had no white veil (screen pixels (0,0,0,0) and (46,0,0,11), against
      (255,255,255,92) before);
    - `?` released the hold and the fight ran (`fightT` 2.1 s).
  - Perf: not relevant to this change (a one-line fx update during the hold).
  - **Verdict: Accepted.** The fix still has to be committed.
- **History:**
  - 2026-11-18 · QA · Open · found while testing DS-13
  - 2026-11-21 · developer · In Review · effects keep updating while the first fight is held; flash gone in 0.5 s; snapshot at 5 s clean
  - 2026-11-21 · reviewer · Ready for QA · fx-only tick while held; flash gone, fight still frozen; verified live
  - 2026-11-26 · QA · Accepted · flash fades within 0.5 s while the help holds the fight; no veil after a 10 s hold (tested on the uncommitted diff)

## DS-16 · Level-1 fights drag
- **Type:** Balance / fun · **Severity:** Low · **Status:** Ready for QA · **Reporter:** QA
- **Observation:**
  - Level 1 now has 430 hp, against 300 at L3. Its fights are the longest of any level.
    - Bench (200 fights): median 117 s against 87–95 s at L2–L5. 10% of them run over 140 s, and one ran 153.3 s,
      past DS-1's 150 s limit.
    - Real-time L1 (`L1_*`): 122.9 s, and the autopilot won with 72 desk hp left.
  - For a viewer, L1 is two minutes of a slow, low-damage stickman who rarely threatens the desk. The win rate is
    fine (20%), but the fight is long for what happens in it.
- **Acceptance:**
  - L1 median duration ≤ ~100 s and no L1 fight over 150 s in a 200-fight bench.
  - The L1 win rate stays at 10–25%. For example, trade some of his hp for more frequent (weaker) moves, or start
    the overtime earlier at L1.
- **Dev notes:**
  - Root cause: level 1 had 430 hp and the slowest decisions of any level, so fights were long grinds where he
    rarely threatened the desk.
  - Fix, a trade of hp for tempo (`power()` in `src/stickman/brain.js`):
    - L1 hp 430 → 330;
    - L1 decisions per second ×1.3;
    - L1 damage factor 1.7 → 2.0.
    - Levels 2–5 are unchanged.
  - Measured with `G.bench(1, 50)` ×4 (200 fights, same start every fight), against the old code in the same
    session:

    | | old (430 hp) | new | new, repeat run |
    |---|---|---|---|
    | wins | 18.5% | 24% | 23.5% |
    | median duration | 113.9 s | 94.7 s | 98.1 s |
    | 90th percentile | 127.4 s | 112.9 s | 115 s |
    | longest | 142.6 s | 123.7 s | 141 s |
    | over 150 s | 0 | 0 | 0 |
    | under 45 s | 0 | 0 | 0 |
    | autopilot wins with ≥ 80 desk hp | 12% | 11% | 8.5% |

    - Pooled over the two new runs (400 fights): 23.75% wins and 9.75% such stomps.
    - In L1, win rate and stomps move together: settings that brought wins under ~20% pushed stomps over 10%
      (1.92 damage: 19.5% wins, 11.5% stomps). So L1 sits in the upper half of its 10–25% band.
  - L2 side-effect check (L2 code unchanged): three 100-fight runs gave 31%, 18% and 33%, pooled 27.3% (band
    20–35%); stomps 6%; median 91–93 s.
  - Real-time L1 autopilot fight: see History.
- **Review:**
  - `power()` (`src/stickman/brain.js`): HP[0] 330, DMG[0] 2.0, and `speed × 1.3` only when `k === 0`. Since
    `k = max(0, lvl − 1)`, that's level 1 only. `power.speed` is only read by the fight decision timer
    (`think`), so chill is unaffected.
  - Checked through `fightLevel` overrides:

    | level | hp | dmg | decisions/s |
    |---|---|---|---|
    | 1 | 330 | 2.0 | 1.30 |
    | 2 | 300 | 1.77 | 1.16 |
    | 3 | 300 | 1.82 | 1.32 |
    | 5 | 310 | 1.72 | 1.64 |
    | 6 | 325 | 1.72 | 1.80 |
    | 9 | 370 | 1.72 | 2.28 |

    Levels 2+ are unchanged, and a stats-level-1 fight gets the same numbers as an override to level 1.
  - Observation for QA: L1 now decides faster than L2 (1.30 vs 1.16) and about as fast as L3. The step from L1
    to L2 is now about kit (weapons, possession, ultimate), not tempo. That's a design call, not a bug.
  - Spot check, `G.bench(1, 50)` in an isolated instance (port 47871):
    - durations reproduce: median 97.2 s, p90 114.4 s, max 126 s, none over 150 s or under 45 s;
    - his wins 6/50 = 12% (dev: ~24%);
    - autopilot wins with ≥ 80 desk hp: 8/50 = 16% (dev: 8.5–11%);
    - saved stats unchanged.
    The win and stomp gaps are within what 50 fights can show (±6 points), but they lean toward the bottom of
    the 10–25% band and above DS-9's 1-in-10 stomp limit. QA's 200-fight re-bench should settle it.
  - Code verdict: Ready for QA. The balance acceptance is QA's.
- **QA (re-test, partial; stopped for the session wrap-up):**
  - The diff is live in my worktree instance: L1 `maxHp` 330, `speed` 1.3, `dmg` 2.0; L2 unchanged (300 hp,
    1.16).
  - **Still needed:**
    - the 200-fight L1 bench and the 100-fight L2 bench, to settle the gap between the developer's 23.75% wins /
      9.75% lopsided and the reviewer's 12% / 16%;
    - one real-time L1 fight watched as a viewer, to judge whether L1 deciding faster than L2 feels right.
    - A first attempt didn't run: a shell-quoting slip in my script, caught before any fights started.
  - Status stays Ready for QA.
- **History:**
  - 2026-11-18 · QA · Open · from the round-2 benches and the real-time L1 fight
  - 2026-11-21 · developer · In Review · L1 trades hp for tempo: median 113.9 → ~96 s, longest ≤ 141 s, wins ~24% (400 fights); L2 unchanged at 27%
  - 2026-11-21 · developer · In Review · real-time L1 autopilot fight: 85.4 s (QA's was 122.9 s); autopilot won with 43 desk hp left; he did 93.5 desk damage
  - 2026-11-21 · reviewer · Ready for QA · L1-only tempo/hp/dmg change verified; durations reproduce (median 97 s, max 126 s); wins 12%/stomps 16% in 50 fights, for QA's re-bench
  - 2026-11-26 · QA · Ready for QA (unchanged) · re-test started: L1 numbers verified live; 200×L1 + 100×L2 bench still to run

## DS-17 · At night he naps in 10-second loops, yawning and stretching every time
- **Type:** Bug · **Severity:** Medium · **Status:** Open · **Reporter:** QA
- **Observation:**
  - 28 minutes of real-time chill, 23:31–23:59, so in night mode. 22 naps:
    - 8–12 s each once his energy was 94–100;
    - as little as 4 s between naps (gaps: 104, 4, 6, 4, 147, 76 … 4, 110, 35 s).
  - Each nap starts and ends with a line, so these were the most repeated stick lines: "*stretch*" 11×,
    "Mmm… what did I miss?" 8×, "*yawn*" 7×, "Getting sleepy…" 4×, "*yaaawn* Good nap." 4×.
  - Probable cause (`brain.js`):
    - `actSleep` has weight 12 at night regardless of energy;
    - the nap ends as soon as `energy > 98 && t > 10`.
    So a rested stickman keeps dozing off and waking straight back up.
- **Perf** (same run; the user's desktop was busy, with their own WidgetSystem running):
  - DeskSprite's web process: 3.4–6 % while dormant, 10–17 % awake.
  - Every wake also restarts the render loop (0 → 4–6 renders/s).
- **Acceptance:**
  - At night with energy > 90 he takes at most about one nap per 10 minutes, or naps last ≥ 60 s.
  - The sleepy and wake lines don't repeat within 5 minutes.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session

## DS-18 · Chill talk is too frequent and repeats lines minutes apart
- **Type:** UX / fun · **Severity:** Medium · **Status:** Open · **Reporter:** QA
- **Observation** (28 min of chill, the stickman and 4 apps):
  - 262 lines, 9.4 per minute (5.5 from the stickman), but only 113 distinct.
  - Most repeated:
    - Dev: "Tabs. Not spaces. Fight me." 11×, once twice in 4 s; "TODO: fix later (2019)" 8×;
    - Cog: "Toggle. Untoggle. Toggle." 8×;
    - Brushy: "Who needs layers? I live in the moment." 6×.
  - 73 times a speaker repeated the same line within 3 minutes.
  - The pools are small (`STICK.chill` has 7 lines), and `line()` / `appLine()` pick at random with no memory.
  - The user likes the variety of behaviour, but the words wear out quickly.
- **Acceptance:**
  - No speaker repeats a line within 5 minutes; the picker avoids its last N lines.
  - Chill talk averages ≤ ~4 lines/min with 4 apps on screen, measured over 20 min.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session

## DS-19 · Dragging a widget he stands on doesn't carry him; he teleports or gets flung
- **Type:** Bug · **Severity:** Low · **Status:** Open · **Reporter:** QA
- **Repro:** put him on Mochi's widget, then move it with `inst.moveTo()`.
- **Observation:**
  - **Smooth drag** (12 px right and 5 px up every 33 ms, 40 steps):
    - for about 1 s he stayed at his old height, ending 120 px below the widget's new top, still "on" it;
    - then he jumped ~330 px sideways and fell.
    - Widget platforms only refresh about once a second (`refreshWidgets` on a 1 s timer, plus the end-of-drag
      `layout` event).
  - **One-step moves:**
    - +340 px sideways flung him into the air (x +397, airborne) and he fell to the floor;
    - moving the widget up made him fall through.
  - Removing the widget under him works fine: he falls and lands.
- **Acceptance:** while a widget he stands on is dragged, he rides along smoothly, or hops off from his own spot.
  He never teleports sideways or hangs below the widget's top.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session (edge cases)

## DS-20 · In front of a full-screen widget he can ride something invisible and sleep floating off-screen
- **Type:** Bug · **Severity:** Low · **Status:** Open · **Reporter:** QA
- **Observation:**
  - A tear into a full-screen Clock put him in the front layer.
  - He then did `ride` (an app, which lives behind the sheet) and fell asleep at x = 19, 58 px above the floor,
    half off the left screen edge, floating over the clock.
  - 20 s later he was back in the back layer.
- **Acceptance:** in the front layer he only rides or rests on things drawn in front (the floor and hole ledges),
  and he never sleeps partly off-screen.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session (tears)

## DS-21 · Apps clip at the screen edges and pile onto Mochi
- **Type:** UX · **Severity:** Low · **Status:** Open · **Reporter:** QA
- **Observation** (28 min of chill):
  - Apps often stop with their centre 13–22 px from the edge, half off-screen. In 2-second samples:
    Brushy 69×, Dev 21×, Calc 10×.
  - A file copy's label was cut at the left edge.
  - Three apps and the stickman crowded onto Mochi's widget top, standing on and over the sleeping Mochi (Cog's
    body over Mochi, Dev and Calc overlapping).
- **Acceptance:**
  - Strolls stay at least half a body width from the screen edges.
  - Creatures on a widget top spread out and keep clear of Mochi's spot.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session

## DS-22 · Idea: let tears linger, so the hole is part of the show
- **Type:** Feature · **Severity:** Low · **Status:** Open · **Reporter:** QA
- **Pitch:**
  - A tear lasts about 10 s: fsck's default repair delay is 8 s, and fsck claims the ticket at once. So "sit in
    the hole" rarely happens, and the tear is barely seen.
  - After tearing in, he could sit in the hole and peek out, wave or dangle his legs for 5–8 s before fsck shows
    up, maybe with a line to fsck ("Just a minute!").
- **Acceptance:** in a tear, the hole and his reaction are visible for at least ~6 s before the repair starts.
- **History:**
  - 2026-11-26 · QA · Open · exploratory session idea

## QA resume notes (2026-11-26)
- **Exploratory session, done:**
  - 28 min of chill with perf (DS-17, DS-18, DS-21);
  - one forced tear, repaired by fsck in about 10 s (DS-20, DS-22);
  - real-time L2 and L4 fights;
  - edge cases: moving, resizing and removing the widget he stands on (DS-19); Night Cron ↔ Glass mid-chill,
    which worked; hot reload, which kept the handle live and the apps restored; RSS over 28 min, 218–320 MB with
    no drift.
  - DS-15 Accepted on the uncommitted diff.
- **Fights as a viewer:**
  - L2: 113.6 s, the autopilot won with 34 desk hp left after the desk was down to 7. Almost all his desk damage
    was blasts (138 of 150), so the fight reads as one-note.
  - L4: 86.1 s, he won with 92/300 hp left. Ink Storm spikes did 86 damage; a good, varied fight.
- **Perf** (top 5 s samples; Xwayland and gnome-shell are noisy because the user's own WidgetSystem was running,
  its web process at 3–29 %; machine idle 85–96 %):

  | scenario | DS web % | Xwayland % | gnome-shell % | renders/s |
  |---|---|---|---|---|
  | no DeskSprite | ~2 (1.4–3.2) | ~19 (9–30) | ~20 (19–28) | – |
  | chill, awake | ~12.7 (8.8–15.4) | ~22 (11–28) | ~19 (17–26) | 4 (1–8) |
  | chill, 28 min (awake and dormant) | median 10.6 (3.4–17.1) | median 19.9 (9.7–46) | median 14.5 | 4.6 (0 dormant) |
  | fight (L2, L4) | ~58 (47–76) | ~50 (35–56) | ~22 (19–28) | ~51 |

  Only the DS web column is a solid A/B. In fights, Xwayland is clearly higher (+~30 points).
- **Environment notes:**
  - The test instance draws on the user's real desktop. At ~00:04 the full-screen Clock was collapsed and the
    nest was dragged from (1008,24) to (1027,196), most likely by the user. Keep full-screen tests short.
  - Clicks and keys on Wayland weren't tested; there is no input injection.
- **Next:**
  - DS-16 benches: 200×L1 and 100×L2, plus one real-time L1 fight.
  - A natural (unforced) tear with an 8 s repair.
  - Mochi and fsck interacting with him over longer runs.
  - Clicks and Esc on Wayland, if input can be driven.
