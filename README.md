# DeskSprite

An *Animator vs Animation*-style stickman who lives on your desktop, built as a widget for
[WidgetSystem](../WidgetSystem) (see its `docs/WIDGET_API.md`).

He's a Tamagotchi most of the time. He walks and jumps across your widgets, sits on their
edges, sleeps, doodles in the air, plays ball and eats cookies, and chats with your apps.
Those apps come alive as little characters with legs and eyes. Sometimes he challenges
you (click him to accept), or you press **⚔️ Fight** on his nest. Then the whole desktop
becomes an arena. You draw weapons, throw him around, drop bombs and call lightning. He
steals your drawings, draws his own swords, fires energy blasts at your cursor, cracks the
"screen", possesses your apps and buries you in fake error dialogs.

## Nothing real is ever touched

- The manifest asks for **no permissions** (`"permissions": []`), so the widget can't run
  commands or reach the network.
- Desktop files and installed apps are read once, through the read-only
  `ctx.host.desktopItems()` and `ctx.host.apps()`, and only for **names and icons**. The
  game smashes *visual copies* (marked `⧉ copy`), and they rebuild themselves afterwards.
- Cracks, glitches, the "crash screen" and error popups are paint on the widget layer.
  When the fight ends, everything is restored.
- Apps that aren't installed still show up, using built-in original icon art.

## Run it

**Standalone** (Linux with Python 3, GTK 3 and WebKit2GTK 4.1):

```sh
./run.sh          # ./run.sh stop to stop him
```

**Inside [WidgetSystem](https://github.com/NGdev2/WidgetSystem)**: install it from the Navigator
(✦ → Navigator…), or register a local checkout:

```sh
widgetctl path add ~/Documents/Profession/projects/DeskSprite
widgetctl add desksprite
```

Saving any file hot-reloads it. `solo/` is the bundled runner (made by `widgetctl export-solo`).

When a widget goes full screen, he lives behind it, and sometimes tears his way through to the
front. WidgetSystem's repair daemon **fsck** patches the hole and collects the paper scraps.

## Playing

**Chill mode** (his nest is the widget):
🍪 drops a cookie, ✋ pets him, ⚽ throws a ball, 📦 brings an app to life, ⚔️ starts a fight.
Left alone, he also skateboards on a board he draws himself, juggles (and sometimes
drops the balls), fishes from widget edges, opens portals between widgets, moonwalks,
throws paper planes and chases them, rides your apps, meditates in mid-air, does
handstands, sneezes, and waves when you come back to the computer.
Drag him, the apps or file copies to throw them. Click him to pet him. Click three times
fast and he gets annoyed, and an annoyed stickman picks fights. Settings: name, color,
size, talking, mischief level, surprise challenges, apps waking up on their own, file
copies, sound.

**Fight mode** (Esc or 🏳️ ends it). The **❓ Help** button in the top bar (or **?** / **H**) opens
the guide at any time, and a strip under the allies shows every shape you can draw and the keys.
Esc in a fight only ends the fight, even with a full-screen widget open.

| key | tool | |
|---|---|---|
| 1 | ✋ Hand | grab and throw anything. Snatch his weapon. A quick click on him is a bonk |
| 2 | ✏️ Pencil | draw. Straight strokes become sticks (weapons), closed shapes become heavy blocks. Q/W/E/R pick the ink: normal, 🔥 fire (burns), ❄️ ice (freezes), 🟢 bouncy |
| 3 | 🧽 Eraser | erase drawings and popups, and slowly erase *him* |
| 4 | 💣 Bomb | 1.8 s fuse |
| 5 | ⚡ Lightning | stuns him, and frees possessed apps |

**Sketchbook: shapes become weapons.** Draw roughly. Close is good enough. Press **B**
or 📖 in a fight to see the cheat sheet. The help guide opens by itself the first time.

| draw | you get | |
|---|---|---|
| short straight line | 🗡️ Sword | grab it with ✋ and swing it (he can steal it) |
| long straight line | 🔱 Spear | flies straight at him |
| V or < | 🪃 Boomerang | hits him and comes back |
| zigzag | ⚡ Lightning | instant strike |
| spiral | 🌪️ Tornado | sucks him in and spins him |
| arc, like ( | 🏹 Bow | floats and shoots arrows |
| wavy line ~~~ | 🌊 Wave | sweeps him away |
| circle | 🛡️ Shield | follows your cursor and blocks his shots |
| triangle | 🚀 Rocket | homes in on him and explodes |
| star | ✴️ Shuriken | spinning throwing star |
| box around him | ⛓️ Cage | traps him |
| box anywhere else | 📦 Crate | heavy block |

Inks stack with shapes: a fire spear burns him, an ice crate freezes him. From level 2 he
sometimes copies your weapon and throws it back at you.

The top bar summons allies, each with its own ability and a power tier (shown on its button
and over its head): ▫ weak apps have little hp and run from him, ★ strong and 👑 boss apps hit
harder, shrug off knocks and have a signature move every third cast.

| app | tier | ability | signature |
|---|---|---|---|
| Antivirus (Guardian) | 👑 boss | quarantine cage | Full System Scan: a scanline sweeps the screen and quarantines him |
| Terminal (Bash) | ★ strong, 👑 boss from his level 4 (root) | falling commands | Fork Bomb: a rain of processes; as root it opens with `sudo rm -rf` |
| Browser (Foxy) | ★ strong | fire dash | Tab Storm: three fire dashes in a row |
| Trash (Binny) | ★ strong | eats him, lunges at him, spits junk when he floats out of reach | Recycle: spits the junk it ate back at him |
| Folder, Paint, Settings, Clock, Code, Game | ▪▪ normal | shield, repair + ink, roll, slow time, commands, dash | |
| Music, Calculator, Mail, Chat | ▫ weak | dance, numbers, letters, pings | |

Ability damage shows up as `ally <kind>` in `fightReport()`. `G.duels(kinds, level, trials)` measures how hard
each app hits on its own.

🩹 Repair heals cracks and rebuilds the file copies.

You lose when the desktop's integrity bar hits zero. He wins when he cracks the screen
enough. Leave everything to your apps and he usually wins, so join in. Wins earn him XP.
Every level makes him harder to beat (against the autopilot he wins about 20% at level 1, 45%
at level 3 and 70% at level 5): more armor, decision speed and reach, better dodging (he reacts
sooner, blinks away, from level 4 cancels attacks to dodge and catches thrown spears), blasts
that curve harder after your cursor and more often come in pairs, and new moves:

- Level 2: drawing weapons, possession, flying kicks, ground pound, copying your weapons,
  and an ultimate (the bar under his hp): Overcharge
- Level 3: fire weapons, fake errors, teleport strike, ultimate Ink Storm
- Level 4: Ink Storm ends with a quake
- Level 5: ultimate Final Form, a sweeping energy beam you have to outrun

At every level he also floats up and fights from the air, and runs up onto widget tops.

Fights are paced so none is over in seconds: both sides warm up over the first ~45 s, no
ultimate before 50 s, a side that's nearly beaten gets a short comeback window, and from 100 s
it's overtime (every hit counts more). At most 8 cracks stay on screen. A fight started while a
widget is full screen happens in front of it. In your first fight the help opens and the fight
waits until you close it.

**Watch a fight:** right-click → *Watch a fight (autopilot)*, or
`widgetctl send desksprite '{"cmd":"fight","autopilot":true}'`. The autopilot plays your side
like a decent human (draws weapons, uses the tools, summons allies). Click anywhere to take
over. Autopilot fights are exhibitions: they don't change his wins, losses or XP.

**After a fight** Binny the trash bin walks to every leftover drawing and eats it (one walks in
if it isn't around, and leaves afterwards). Each leftover is also an `orphan` ticket and up to
five cracks stay as `crack` tickets, so WidgetSystem's **fsck** can collect or seal them first.
Everything is gone within about a minute.

Scripts can poke him too: `widgetctl send desksprite '{"cmd":"fight"}'` (add `"autopilot": true`
to watch, and `"level": 3` to fight at another level without changing his stats). The other
commands are `feed`, `summon` (with optional `"kind"`), `say` (with `"text"`), `pause`,
`resume`, and `trick` with a `"name"`. Trick names are skate, juggle, fish, portal,
moonwalk, plane, ride, meditate, handstand and sneeze.

## Code map

| file | |
|---|---|
| `main.js` | entry: builds the game, the nest and the right-click menu |
| `src/game.js` | world, platforms (floor plus widget tops), loop, combat rules, fight lifecycle |
| `src/stickman/rig.js` | skeleton, forward kinematics, drawing, pose library |
| `src/stickman/stickman.js` | locomotion, jumps, ragdoll, getting up, actions, weapons |
| `src/stickman/brain.js` | utility AI for chill life, plus the fight AI |
| `src/stickman/tricks.js` | skate, juggle, fish, portal, moonwalk, plane, ride…, ground pound, teleport strike |
| `src/world/sketch.js` | shape recognition for drawn weapons, and their behaviours |
| `src/actors/app.js` | app characters: walking, tumbling, abilities, possession |
| `src/actors/lore.js` | personalities, dialogue and power tiers |
| `src/actors/art.js` | built-in icons, mapping real apps to archetypes |
| `src/world/physics.js` | one-way platforms, verlet ragdoll, rigid bodies |
| `src/world/objects.js` | drawings, file copies, ball, cookie, bomb, text blocks, popups, projectiles |
| `src/world/cleanup.js` | after a fight: Binny eats the leftovers; orphan and crack tickets for fsck |
| `src/fx/` | particles, cracks, lightning, shake, glitch, synth sounds |
| `src/ui/` | nest card, fight arena and HUD, the autopilot, hitboxes (click targets and bubble anchors) |

Debugging: `widgetctl url` opens the desktop in a browser. `window.__desksprite[<instance id>]`
is the live game object. On it, `fightReport()` returns the current or last fight's stats
(duration, damage both ways by source, moves used by each side, level, winner, leftovers,
cleanup), `fastForward(secs)` runs the game faster than real time, and `bench(level, runs)`
plays autopilot fights in fast forward (each from the same start: no roster, just the 2 starter
allies, and each followed by 60 s of cleanup) and puts the results in `benchResults`; his saved
stats and apps are restored afterwards. `duels(kinds, level, trials)` does the same for single
apps (`duelResults`). Results vary a lot from run to run: compare 100+ fights per setting. Host timers (ticket expiry, fsck)
keep real time, so judge crack cleanup in a real-time fight.
