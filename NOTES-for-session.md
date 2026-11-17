# Notes for the DeskSprite session (changes made by the WidgetSystem session)

On 2026-11-17 the user asked the WidgetSystem session to implement these directly:

- **Layers (WidgetSystem API v2).** When a widget goes full screen, it becomes a "sheet" that covers
  the back layer. DeskSprite now has two canvases: `this.canvas` (back) and `this.canvasFront` (front,
  in `layer: 'front'`). The stickman has `stick.layer`. `game.setStickLayer(l)` switches it and also
  moves his hitbox, so his speech bubbles follow.
- **Tearing** (`src/stickman/layers.js`, installed into Brain):
  - `actTearIn` files a `tear` ticket and grows it in 4 stages, drops paper scraps (as `orphan`
    tickets that fsck collects), and climbs through into the front layer.
  - `actSitInHole` sits on a hole's bottom edge.
  - `actReturnBack` goes back behind the sheet.
  - Weights live in `Brain.choose()`; the new setting `tear` is never/stuck/sometimes/often.
- **Platforms:** in front of a sheet, only the floor and hole ledges (`kind: 'ledge'`) count.
- **fsck** is WidgetSystem's built-in repair daemon. It repairs tears. Apps now comment on fresh holes.
- No surprise fights while a sheet is open. The fight arena lives in the front layer.
- The nest and HUD use theme tokens (Night Cron / Glass). The level pill is his own orange again.

Not done yet:
- crack tickets after fights (needs crack ids and `healCrack(id)` in fx.js)
- self-repair when fsck is absent
- the neon skin for the stickman
- `keys.capture(['Escape'])` in the arena

See WidgetSystem `docs/WIDGET_API.md` ("Layers, sheets, tickets & actors").
