// Built-in icon art (original drawings, 64x64). Used when the host can't give us the real
// app or file icons, and for apps that "come to life" even when they aren't installed.
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

export const ART = {
  browser: svg(`
    <defs><radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#7fd3ff"/><stop offset="1" stop-color="#2459c9"/></radialGradient>
    <linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd43a"/><stop offset=".5" stop-color="#ff7a1a"/><stop offset="1" stop-color="#e3262f"/></linearGradient></defs>
    <circle cx="32" cy="33" r="22" fill="url(#g)"/>
    <path d="M14 20c3-6 9-10 13-11-2 3-2 6-1 8 5-5 14-6 20-3-6 0-10 3-11 6 8-1 14 4 15 11 1 10-7 20-19 20C17 51 9 40 11 29c1-3 2-6 3-9z" fill="url(#f)"/>
    <path d="M22 30c3 2 8 2 11-1-1 6-6 10-12 9 2-2 2-5 1-8z" fill="#fff3" />`),
  antivirus: svg(`
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ff09a"/><stop offset="1" stop-color="#0f9a52"/></linearGradient></defs>
    <path d="M32 6l22 8v15c0 15-10 24-22 29C20 53 10 44 10 29V14z" fill="url(#s)" stroke="#0b6b3a" stroke-width="2"/>
    <path d="M21 32l8 8 15-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  terminal: svg(`
    <rect x="6" y="10" width="52" height="44" rx="8" fill="#1d2230" stroke="#495468" stroke-width="2"/>
    <rect x="6" y="10" width="52" height="9" rx="4" fill="#353d50"/>
    <circle cx="13" cy="14.5" r="2" fill="#ff5f57"/><circle cx="19" cy="14.5" r="2" fill="#febc2e"/><circle cx="25" cy="14.5" r="2" fill="#28c840"/>
    <path d="M15 28l9 6-9 6" fill="none" stroke="#7CFF8A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="28" y="40" width="16" height="3.5" rx="1.5" fill="#7CFF8A"/>`),
  trash: svg(`
    <defs><linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#b9c2cf"/><stop offset="1" stop-color="#7d8796"/></linearGradient></defs>
    <rect x="13" y="14" width="38" height="6" rx="3" fill="#6d7584"/><rect x="26" y="9" width="12" height="6" rx="2" fill="#6d7584"/>
    <path d="M16 21h32l-3 33a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4z" fill="url(#t)"/>
    <path d="M25 27v24M32 27v24M39 27v24" stroke="#5a6270" stroke-width="2.5" stroke-linecap="round"/>`),
  folder: svg(`
    <path d="M6 16a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v4H6z" fill="#e9a11a"/>
    <rect x="6" y="22" width="52" height="32" rx="5" fill="#ffc43d"/>
    <rect x="6" y="22" width="52" height="6" rx="3" fill="#ffd36e"/>`),
  paint: svg(`
    <path d="M32 8C17 8 7 18 7 31c0 12 9 21 20 21 4 0 5-3 4-6s1-6 5-6h7c8 0 14-5 14-12C57 17 46 8 32 8z" fill="#f3e3c3" stroke="#b79b6a" stroke-width="2"/>
    <circle cx="20" cy="27" r="4.5" fill="#e63946"/><circle cx="29" cy="18" r="4.5" fill="#ffb703"/><circle cx="40" cy="18" r="4.5" fill="#2a9d8f"/><circle cx="47" cy="28" r="4.5" fill="#457bf5"/>
    <path d="M58 6L38 38l-4 3 1-5L54 4z" fill="#8a5a2b"/><path d="M34 41c-3 0-6 3-6 6 3 0 6-2 7-4z" fill="#222"/>`),
  music: svg(`
    <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c77dff"/><stop offset="1" stop-color="#5a189a"/></linearGradient></defs>
    <circle cx="32" cy="32" r="25" fill="url(#m)"/>
    <path d="M26 44V20l18-4v22" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="22" cy="44" r="5" fill="#fff"/><circle cx="40" cy="39" r="5" fill="#fff"/>`),
  calculator: svg(`
    <rect x="12" y="6" width="40" height="52" rx="7" fill="#3a3f4b"/>
    <rect x="17" y="11" width="30" height="11" rx="2.5" fill="#bfe8c4"/>
    <text x="44" y="20" font-family="monospace" font-size="9" text-anchor="end" fill="#234">3.14</text>
    ${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${17 + c * 10.5}" y="${26 + r * 10}" width="8.5" height="8" rx="2" fill="${c === 2 ? '#ff9f1c' : '#636b7a'}"/>`).join('')).join('')}
    <rect x="17" y="56" width="0" height="0"/>`),
  settings: svg(`
    <g transform="translate(32 32)">
    ${Array.from({ length: 8 }, (_, i) => `<rect x="-5" y="-27" width="10" height="12" rx="2" fill="#8b95a7" transform="rotate(${i * 45})"/>`).join('')}
    <circle r="19" fill="#8b95a7"/><circle r="8" fill="#e8ecf2"/><circle r="19" fill="none" stroke="#6b7487" stroke-width="2"/></g>`),
  clock: svg(`
    <circle cx="32" cy="34" r="24" fill="#fff" stroke="#3a86ff" stroke-width="5"/>
    <path d="M32 18v16l10 6" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round"/>
    <rect x="12" y="4" width="10" height="6" rx="3" fill="#3a86ff" transform="rotate(-30 17 7)"/><rect x="42" y="4" width="10" height="6" rx="3" fill="#3a86ff" transform="rotate(30 47 7)"/>`),
  mail: svg(`
    <rect x="6" y="14" width="52" height="36" rx="6" fill="#4cc9f0"/>
    <path d="M8 18l24 18 24-18" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`),
  chat: svg(`
    <path d="M10 12h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H28l-12 10v-10h-6a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="#5865f2"/>
    <circle cx="22" cy="28" r="4" fill="#fff"/><circle cx="32" cy="28" r="4" fill="#fff"/><circle cx="42" cy="28" r="4" fill="#fff"/>`),
  code: svg(`
    <rect x="6" y="6" width="52" height="52" rx="10" fill="#1f6feb"/>
    <path d="M24 22l-10 10 10 10M40 22l10 10-10 10" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  game: svg(`
    <path d="M14 22h36c7 0 10 8 10 18 0 7-3 10-7 10-5 0-7-7-12-7H23c-5 0-7 7-12 7-4 0-7-3-7-10 0-10 3-18 10-18z" fill="#2b2d42"/>
    <path d="M17 31v8M13 35h8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="44" cy="32" r="3" fill="#ef233c"/><circle cx="50" cy="37" r="3" fill="#06d6a0"/>`),
  // --- file kinds (for desktop copies)
  file: svg(`<path d="M16 6h22l12 12v38a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="#f5f7fb" stroke="#9aa6b8" stroke-width="2"/><path d="M38 6v12h12" fill="#d9dfe9"/>
    <path d="M21 30h22M21 37h22M21 44h15" stroke="#9aa6b8" stroke-width="2.5" stroke-linecap="round"/>`),
  image: svg(`<rect x="8" y="10" width="48" height="44" rx="5" fill="#e9f4ff" stroke="#7aa7d9" stroke-width="2"/><circle cx="22" cy="24" r="5" fill="#ffd166"/>
    <path d="M10 50l16-16 10 10 7-7 13 13" fill="#5fb878"/>`),
  archive: svg(`<rect x="12" y="8" width="40" height="48" rx="4" fill="#c9a26b"/><path d="M30 8h4v6h-4zM30 16h4v6h-4zM30 24h4v6h-4z" fill="#7d5a2c"/><rect x="27" y="32" width="10" height="10" rx="2" fill="#7d5a2c"/>`),
  video: svg(`<rect x="8" y="12" width="48" height="40" rx="6" fill="#222"/><path d="M27 23v18l15-9z" fill="#fff"/>`),
};

export const ARCHETYPES = ['browser', 'antivirus', 'terminal', 'trash', 'folder', 'paint', 'music', 'calculator', 'settings', 'clock', 'mail', 'chat', 'code', 'game'];

const cache = new Map();
export function artImage(key) {
  if (cache.has(key)) return cache.get(key);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ART[key] || ART.file);
  cache.set(key, img);
  return img;
}

export function urlImage(url) {
  if (cache.has(url)) return cache.get(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  cache.set(url, img);
  return img;
}

// Guess an archetype from a real app's metadata (.desktop categories / name).
export function archetypeFor(app) {
  const s = `${app.id || ''} ${app.name || ''} ${(app.categories || []).join(' ')} ${app.comment || ''}`.toLowerCase();
  const rules = [
    ['antivirus', /antivir|clamav|clamtk|security|firewall|malware/],
    ['browser', /webbrowser|browser|firefox|chrom|brave|opera|vivaldi|epiphany|edge/],
    ['terminal', /terminalemulator|terminal|konsole|tilix|kitty|alacritty|xterm|console/],
    ['code', /development|ide|code|editor|vim|emacs|jetbrains|sublime/],
    ['paint', /graphics|paint|gimp|krita|inkscape|draw|photo/],
    ['music', /audio|music|player|spotify|rhythmbox|sound|vlc/],
    ['calculator', /calculator|calc\b|math/],
    ['settings', /settings|control|preferences|system/],
    ['clock', /clock|alarm|timer|calendar/],
    ['mail', /mail|thunderbird|evolution|geary/],
    ['chat', /chat|telegram|discord|slack|signal|messag|instant/],
    ['game', /game|steam|play/],
    ['folder', /filemanager|files|nautilus|nemo|dolphin|thunar/],
    ['trash', /trash/],
  ];
  for (const [k, re] of rules) if (re.test(s)) return k;
  return null;
}

export function fileKind(item) {
  if (item.kind === 'dir') return 'folder';
  const m = (item.mime || '') + ' ' + (item.name || '').toLowerCase();
  if (/image|\.png|\.jpe?g|\.gif|\.webp|\.svg/.test(m)) return 'image';
  if (/video|\.mp4|\.mkv|\.webm/.test(m)) return 'video';
  if (/zip|tar|gz|7z|rar|archive/.test(m)) return 'archive';
  return 'file';
}
