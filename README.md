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

**Fight mode** (Esc or 🏳️ ends it):

| key | tool | |
|---|---|---|
| 1 | ✋ Hand | grab and throw anything. Snatch his weapon. A quick click on him is a bonk |
| 2 | ✏️ Pencil | draw. Straight strokes become sticks (weapons), closed shapes become heavy blocks. Q/W/E/R pick the ink: normal, 🔥 fire (burns), ❄️ ice (freezes), 🟢 bouncy |
| 3 | 🧽 Eraser | erase drawings and popups, and slowly erase *him* |
| 4 | 💣 Bomb | 1.8 s fuse |
| 5 | ⚡ Lightning | stuns him, and frees possessed apps |

**Sketchbook: shapes become weapons.** Draw roughly. Close is good enough. Press **B**
or 📖 in a fight to see the cheat sheet. It opens by itself the first time.

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

The top bar summons allies, each with its own ability:

- Browser: fire dash
- Antivirus: quarantine cage
- Terminal: falling commands
- Trash: eats him, then spits him out
- Folder: shield
- Paint: repairs cracks and refills your ink
- Music: forces everyone to dance
- Calculator: throws numbers
- Settings: rolls into him
- Clock: slows time

🩹 Repair heals cracks and rebuilds the file copies.

You lose when the desktop's integrity bar hits zero. He wins when he cracks the screen
enough. Leave everything to your apps and he usually wins, so join in. Wins earn him XP,
and levels unlock new moves:

- Level 2: drawing weapons, possession, flying kicks, ground pound, copying your weapons
- Level 3: fire weapons, fake errors, teleport strike
- Level 4: double blasts

Scripts can poke him too: `widgetctl send desksprite '{"cmd":"fight"}'`. The other
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
| `src/actors/lore.js` | personalities and dialogue |
| `src/actors/art.js` | built-in icons, mapping real apps to archetypes |
| `src/world/physics.js` | one-way platforms, verlet ragdoll, rigid bodies |
| `src/world/objects.js` | drawings, file copies, ball, cookie, bomb, text blocks, popups, projectiles |
| `src/fx/` | particles, cracks, lightning, shake, glitch, synth sounds |
| `src/ui/` | nest card, fight arena and HUD, hitboxes (click targets and bubble anchors) |

Debugging: `widgetctl url` opens the desktop in a browser. `window.__desksprite[<instance id>]`
is the live game object.
