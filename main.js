// DeskSprite: an "Animator vs Animation" stickman who lives on your desktop.
// The widget frame is his nest (stats and care buttons). He and everything he plays with
// are drawn on the free-roaming overlay layer above your widgets.
import { Game } from './src/game.js';
import { Nest } from './src/ui/nest.js';

export async function mount(ctx) {
  const game = new Game(ctx);
  // debug handle for devtools (widgetctl url / widgetctl devtools), set before start so it never
  // points at the previous instance while this one starts; dropped again if the start fails
  (window.__desksprite ||= {})[ctx.id] = game;
  try { await game.start(); } catch (e) {
    if (window.__desksprite[ctx.id] === game) delete window.__desksprite[ctx.id];
    throw e;
  }
  new Nest(ctx, game);
  const offs = [
    ctx.menu.add({ label: 'Start a fight', icon: '⚔️', action: () => game.startFight() }),
    ctx.menu.add({ label: 'Watch a fight (autopilot)', icon: '🤖', action: () => game.startFight({ autopilot: true }) }),
    ctx.menu.add({ label: 'Bring an app to life', icon: '📦', action: () => game.summonApp() }),
    ctx.menu.add({ label: 'Feed', icon: '🍪', action: () => game.feed() }),
    ctx.menu.add({ label: 'Call him home', icon: '🏠', action: () => game.callHome() }),
  ];
  return () => {
    offs.forEach((off) => off?.());
    game.destroy();
    // overlapping remounts: only drop the handle if it still points at this game
    if (window.__desksprite?.[ctx.id] === game) delete window.__desksprite[ctx.id];
  };
}
