// Who everyone is and what they say. The apps are "your" programs: loyal to you, nervous
// about the stickman, and each with its own way of fighting.
import { pick } from '../util.js';

export const APPS = {
  browser: {
    nick: 'Foxy', title: 'Guardian of the Web', ability: 'dash', hp: 70, speed: 150,
    idle: ['47 tabs open and I regret nothing.', 'Has anyone seen my bookmarks?', 'Loading… loading… ok I\'m back.', 'I\'ve seen things on the internet you wouldn\'t believe.'],
    fight: ['Fire dash!', 'Tab out of here!', 'You\'re getting a 404 to the face!', 'Refresh THIS!'],
    hurt: ['Ow, my cache!', 'Connection lost…'],
    stick: ['Stop clicking on suspicious links, stickman.', 'You again? Browse somewhere else.'],
  },
  antivirus: {
    nick: 'Guardian', title: 'Paranoid Protector', ability: 'quarantine', hp: 90, speed: 95,
    idle: ['Scanning… 0 threats. Suspicious.', 'Database updated. Trust no one.', 'Did that pixel just move?', 'Real-time protection: ON. Real-time anxiety: ON.'],
    fight: ['THREAT DETECTED!', 'Quarantine protocol engaged!', 'You are a virus and I will prove it!', 'Heuristic analysis: you\'re going down.'],
    hurt: ['Firewall breached!', 'Definitions… outdated…'],
    stick: ['I\'m watching you, unsigned executable.', 'Your signature does not match any known friend.'],
  },
  terminal: {
    nick: 'Bash', title: 'Grumpy Old Shell', ability: 'command', hp: 80, speed: 85,
    idle: ['$ uptime  …nobody appreciates me.', 'Real users type. Mice are for cats.', 'It works on my machine.', '$ fortune  →  "You will be attacked by a stickman."'],
    fight: ['$ sudo throw --hard', '$ echo "BLOCK" > /dev/stickman', 'Permission denied, kid.', '$ kill -9 attitude'],
    hurt: ['Segmentation fault (core dumped)', '^C ^C ^C'],
    stick: ['Did you just pipe yourself into my stdin?', 'Kid, read the man page.'],
  },
  trash: {
    nick: 'Binny', title: 'Always Hungry', ability: 'devour', hp: 110, speed: 70,
    idle: ['Got any old files? I\'m starving.', 'Nom. Recycled.', 'Empty me? Never!', 'One app\'s junk is my lunch.'],
    fight: ['CHOMP!', 'Into the bin you go!', 'Recycling… YOU!', 'I eat stickmen for breakfast!'],
    hurt: ['Ugh, I\'m full of holes now.', 'Spilled everything!'],
    stick: ['You smell like a deleted file.', 'Stay still, I\'m just going to… taste you.'],
  },
  folder: {
    nick: 'Folda', title: 'Shy Keeper of Things', ability: 'shield', hp: 100, speed: 90,
    idle: ['I keep everything organized… mostly.', 'Please don\'t open me in public.', 'Subfolder of a subfolder of a…', 'Shhh, I\'m hiding the homework.'],
    fight: ['Shield up!', 'Get behind me!', 'Folder… FORTRESS!', 'Nothing gets through my tabs!'],
    hurt: ['My papers!', 'I\'m getting zipped up!'],
    stick: ['Please don\'t rename me again.', 'Eek! Not my contents!'],
  },
  paint: {
    nick: 'Brushy', title: 'Dreamy Artist', ability: 'repair', hp: 60, speed: 100,
    idle: ['Every pixel is a tiny canvas.', 'Who needs layers? I live in the moment.', 'That wallpaper needs more purple.', 'I paint, therefore I am.'],
    fight: ['Patching the cracks!', 'A little touch-up!', 'Art heals!', 'Undo! Undo! UNDO!'],
    hurt: ['My palette!', 'Smudged!'],
    stick: ['You know you were DRAWN, right? You\'re my cousin!', 'Hold still, I want to paint you in blue.'],
  },
  music: {
    nick: 'Tune', title: 'Chill Vibes Only', ability: 'dance', hp: 60, speed: 100,
    idle: ['♪ lo-fi beats to fight stickmen to ♪', 'Turn it up!', 'This next track is a banger.', 'Shuffle mode is a lifestyle.'],
    fight: ['DROP THE BEAT!', 'Everybody dance now!', 'Can\'t fight if you\'re grooving!', 'Bass boost!'],
    hurt: ['Record scratch!', 'Buffering…'],
    stick: ['You\'ve got rhythm, stick dude.', 'Dance battle? Any time.'],
  },
  calculator: {
    nick: 'Calc', title: 'Nerd With Numbers', ability: 'numbers', hp: 60, speed: 90,
    idle: ['0.1 + 0.2 = 0.30000000000000004. I hate it here.', 'Did you know π never ends?', 'I computed 42 possible futures. You lose in all of them.', 'Divide and conquer.'],
    fight: ['Have some π!', 'Order of operations: YOU first!', 'Divided by ZERO!', 'Exponential damage!'],
    hurt: ['ERROR', 'NaN… NaN…'],
    stick: ['Your stickiness is statistically improbable.', 'I calculated your weakness: stairs.'],
  },
  settings: {
    nick: 'Cog', title: 'Gearhead', ability: 'roll', hp: 90, speed: 140,
    idle: ['Have you tried turning it off and on?', 'Toggle. Untoggle. Toggle.', 'I control the brightness. Fear me.', 'Default settings are for cowards.'],
    fight: ['Rolling out!', 'Settings changed: YOU = flat!', 'Gear grind!', 'Torque!'],
    hurt: ['Grinding noises…', 'Reset to factory…'],
    stick: ['Who enabled you?', 'You\'re not in my config.'],
  },
  clock: {
    nick: 'Tick', title: 'Keeper of Time', ability: 'slow', hp: 70, speed: 80,
    idle: ['Tick. Tock. Tick.', 'You\'re late. You\'re always late.', 'Time flies. I don\'t.', 'Did anyone set an alarm for the fight?'],
    fight: ['TIME… SLOWS!', 'Slow-motion mode!', 'You\'re out of time!', 'Pause!'],
    hurt: ['My gears!', 'Running slow…'],
    stick: ['It\'s nap time, stickman.', 'Your time is almost up.'],
  },
  mail: {
    nick: 'Posty', title: 'Unread Messenger', ability: 'letters', hp: 60, speed: 120,
    idle: ['You have 9,999 unread messages.', 'Reply all? Bold move.', 'Spam, spam, spam…', 'Sent from my desktop.'],
    fight: ['Express delivery!', 'Return to sender!', 'Paper cuts incoming!', 'SPAM ATTACK!'],
    hurt: ['Undeliverable!', 'Bounced!'],
    stick: ['There\'s a letter for you. It says "go away".', 'You\'ve been flagged as spam.'],
  },
  chat: {
    nick: 'Ping', title: 'Notification Machine', ability: 'ping', hp: 60, speed: 120,
    idle: ['Ping! Ping! Ping!', 'Someone is typing…', 'Seen 2 min ago.', '@everyone hi'],
    fight: ['PING!', 'Notification storm!', 'You\'ve been muted!', 'Mention spam!'],
    hurt: ['Disconnected…', 'Rate limited!'],
    stick: ['New phone who dis?', 'Typing… typing… go away.'],
  },
  code: {
    nick: 'Dev', title: 'Caffeinated Editor', ability: 'command', hp: 80, speed: 100,
    idle: ['It compiled on the first try. Something is wrong.', 'Just one more refactor.', 'Tabs. Not spaces. Fight me.', 'TODO: fix later (2019)'],
    fight: ['Compile this!', 'Syntax error in your FACE!', 'Debugging you!', 'git push --force!'],
    hurt: ['Stack overflow!', 'Merge conflict!'],
    stick: ['Who wrote you? There are no comments.', 'You\'re a bug, not a feature.'],
  },
  game: {
    nick: 'Joy', title: 'Player One', ability: 'dash', hp: 70, speed: 140,
    idle: ['Just one more level.', 'Achievement unlocked: idle.', 'Press START to continue.', 'GG EZ.'],
    fight: ['COMBO!', 'Critical hit!', 'Boss fight!', 'Respawning… just kidding, ATTACK!'],
    hurt: ['Game over?!', 'Lag!'],
    stick: ['You look like a final boss.', 'Player two has entered the game.'],
  },
};

export const STICK = {
  chill: ['Nice desktop you got here.', 'I live here now.', 'Hmm, what does this button do?', 'Just vibing.', 'Is it me or is this wallpaper moving?', 'Your windows are very comfy.', '*whistles*'],
  bored: ['Booored.', 'Play with me!', 'Hey. Hey. Hey. Hey you.', 'I could draw something…', 'Want to fight? Just asking.'],
  sleepy: ['*yawn*', 'Five more minutes…', 'Getting sleepy…'],
  hungry: ['I could eat a whole JPEG.', 'Feed me! (button\'s on my nest)', 'My stomach is making dial-up noises.'],
  fed: ['Crunchy!', 'Mmm, pixels.', 'Delicious. More?', 'Om nom nom.'],
  petted: ['Hehe.', 'That tickles!', '♥', 'Okay, okay, you\'re my favorite.'],
  poked: ['Hey!', 'Stop poking me!', 'Rude.', 'I felt that.', 'Do that again. I dare you.'],
  thrown: ['WHEEEE!', 'AAAAAAH!', 'Not cool!', 'Put me DOWN!'],
  landed: ['…ow.', 'Nailed the landing. Sort of.', 'I\'m okay!', 'Again! …no wait.'],
  angry: ['That\'s it. You and me. Now.', 'You want a fight? You got one.', 'Grrr…'],
  challenge: ['Fight me! (click me)', 'Duel? Click me if you dare.', 'Bet you can\'t beat me. Click to fight.'],
  declined: ['Chicken.', 'Fine. Next time.', 'Coward! …just kidding.'],
  fightStart: ['Let\'s dance, Animator.', 'Your desktop is MINE!', 'Draw your weapon!', 'Round one. FIGHT!'],
  taunt: ['Is that all you\'ve got?', 'You missed!', 'Too slow!', 'Nice try, cursor.', 'Haha!', 'Come on!'],
  hurt: ['Ugh!', 'Oof!', 'Hey!', 'Argh!', 'Ow ow ow!'],
  drawing: ['Two can play this game.', 'I can draw too, you know.', 'Let me just… sketch something.'],
  stealWeapon: ['Ooh, I\'ll take that.', 'Thanks for the sword!', 'Mine now!'],
  possess: ['You work for ME now!', 'Join the stick side.', 'Mind control, activate!'],
  summon: ['Come alive!', 'Rise, little program!', 'Wake up, buddy!', 'Let\'s get this party started.'],
  win: ['Victory! Your desktop is mine!', 'Ha! Better luck next time.', 'Stickman: 1, Animator: 0.'],
  lose: ['Okay… you win. This time.', 'I yield! I yield!', 'GG. Rematch later?'],
  cpuHot: ['It\'s getting hot in here. CPU at {cpu}%!', 'Who\'s mining crypto?!', 'I\'m sweating pixels.'],
  batteryLow: ['Battery at {bat}%… plug us in!', 'Running on fumes here.'],
  night: ['It\'s late. Go to sleep, human.', 'Shhh, night mode.'],
  morning: ['Good morning! Coffee for me?', 'Rise and shine!'],
  files: ['What\'s in this file? Don\'t worry, it\'s just a copy.', 'Snapshot taken! Now I can kick it.', 'Look, a copy of your file. Wheee!'],
  doodle: ['Look what I drew!', 'Art!', 'Do you like it?'],
};

export function line(group, vars = {}) {
  const s = pick(STICK[group] || ['…']);
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '?');
}

export function appLine(kind, group) {
  const a = APPS[kind];
  return pick((a && a[group]) || ['…']);
}

// Short scripted exchanges between the stickman and an app, used when they meet.
export const CHATS = [
  ['How\'s life in the taskbar?', '{idle}'],
  ['Wanna see me do a backflip?', 'Please don\'t, you\'ll scratch the wallpaper.'],
  ['Race you to the top widget!', 'You\'re on!'],
  ['What are you working on?', '{idle}'],
  ['Do you think the Animator likes me?', 'They keep dragging you around, so… maybe?'],
  ['{stickline}', '{stick}'],
];
