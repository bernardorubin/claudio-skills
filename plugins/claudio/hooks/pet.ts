// The band's pet: a pixel sprite whose mood follows the session. Its hooks live in register.tsx.

export type Mood = 'working' | 'waiting' | 'blocked'

export const moodOf = (blocked: boolean, isWorking: boolean): Mood =>
  blocked ? 'blocked' : isWorking ? 'working' : 'waiting'

export const PET_PX = { width: 48, height: 36 }

const BODY: Record<Mood, string> = { working: '#88c0d0', waiting: '#a3be8c', blocked: '#d08770' }
export const CAPTION: Record<Mood, string> = { working: 'Working', waiting: 'Your turn', blocked: 'Needs you' }

// 12×9 grid of 4px pixels: an egg on two feet, eyes two pixels tall so a blink
// drops only the top half, and a "!" beside it while blocked.
const px = (x: number, y: number, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
const body = [px(2, 0, 6), px(1, 1, 8), px(0, 2, 10, 4), px(1, 6, 8), px(2, 7), px(7, 7)].join('')

// ponytail: CSS keyframes with steps() instead of SMIL, so the jumps stay pixel-crisp
// and prefers-reduced-motion can switch them off
const motion: Record<Mood, string> = {
  working:
    '.b{animation:hop .5s steps(1) infinite}.e{animation:look 2.4s steps(1) infinite}' +
    '@keyframes hop{50%{transform:translateY(-1px)}}@keyframes look{25%{transform:translateX(1px)}75%{transform:translateX(-1px)}}',
  waiting: '.t{animation:blink 4s steps(1) infinite}@keyframes blink{94%{opacity:0}97%{opacity:1}}',
  blocked:
    '.b{animation:hop 1s steps(1) infinite}.x{animation:flash .5s steps(1) infinite}' +
    '@keyframes hop{50%{transform:translateY(-1px)}}@keyframes flash{50%{opacity:0}}',
}

export const petSvg = (mood: Mood) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${PET_PX.width}" height="${PET_PX.height}" viewBox="0 0 12 9" shape-rendering="crispEdges">` +
  `<style>${motion[mood]}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
  `<g class="b"><g fill="${BODY[mood]}">${body}</g>` +
  `<g class="e" fill="#2e3440"><g class="t">${px(3, 2)}${px(6, 2)}</g>${px(3, 3)}${px(6, 3)}</g>` +
  // a face per mood, so the state reads without the color: none while it concentrates,
  // a smile on your turn, an open mouth when it needs you
  (mood === 'waiting' ? `<g fill="#2e3440">${px(3, 5)}${px(4, 6, 2)}${px(6, 5)}</g>` : '') +
  (mood === 'blocked' ? `<g fill="#2e3440">${px(4, 5, 2, 2)}</g>` : '') +
  '</g>' +
  (mood === 'blocked' ? `<g class="x" fill="${BODY.blocked}">${px(11, 1, 1, 4)}${px(11, 6)}</g>` : '') +
  '</svg>'

// The terminal has no Svg: one row of text, stepped by a clock tick.
const FRAMES: Record<Mood, string[]> = {
  working: ['( •_•)', '(•_• )'],
  waiting: ['(•‿•) ', '(•‿•) ', '(•‿•) ', '(•‿•) ', '(•‿•) ', '(•‿•) ', '(•‿•) ', '(-‿-) '],
  blocked: ['(°o°)!', '(°o°) '],
}

export const petFrame = (mood: Mood, tick: number) => FRAMES[mood][tick % FRAMES[mood].length]

export const petColor = (mood: Mood) => BODY[mood]
