// The band's pet: a pixel sprite whose mood follows the session. Its hooks live in register.tsx.

export type Mood = 'working' | 'waiting' | 'blocked'
export type Activity = 'think' | 'read' | 'write' | 'build'
// size grows with the context window's fill; tired when the 5-hour window runs low
export type Look = { size: 0 | 1 | 2; tired: boolean; activity: Activity }

export const moodOf = (blocked: boolean, isWorking: boolean): Mood =>
  blocked ? 'blocked' : isWorking ? 'working' : 'waiting'

// What the running tool looks like the pet is doing; no tool is thinking.
export const activityOf = (tool: string | null): Activity =>
  tool === null
    ? 'think'
    : /^(Read|Grep|Glob|LS|NotebookRead|WebFetch|WebSearch)$/.test(tool)
      ? 'read'
      : /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)
        ? 'write'
        : 'build'

// The same thresholds the band turns orange at: context 60% (red 85%), 5-hour 75% used.
export const lookOf = (ctxPct: number, fiveUsed: number, tool: string | null): Look => ({
  size: ctxPct >= 85 ? 2 : ctxPct >= 60 ? 1 : 0,
  tired: fiveUsed >= 75,
  activity: activityOf(tool),
})

const BODY: Record<Mood, string> = { working: '#88c0d0', waiting: '#a3be8c', blocked: '#d08770' }
const CAPTION: Record<Mood, string> = { working: 'Working', waiting: 'Your turn', blocked: 'Needs you' }

// On your turn with a filling context window, the pet suggests making room.
export const captionOf = (mood: Mood, ctxPct: number) =>
  mood === 'waiting' && ctxPct >= 60 ? `Context ${ctxPct}% full: try /compact or /clear` : CAPTION[mood]

export const petColor = (mood: Mood) => BODY[mood]

// A grid of 3px pixels, 12 rows: the body fills rows 4–11 and is 10, 12 or 14
// wide by size; the 4 columns right of it hold a prop, a "!" or a "z", and the
// rows above the head hold thought dots.
const P = 3
const Y = 4
const DARK = '#2e3440'
const LIGHT = '#eceff4'
const GRAY = '#d8dee9'

const widthOf = (look: Look) => 10 + 2 * look.size
export const petPx = (look: Look) => ({ width: (widthOf(look) + 4) * P, height: 12 * P })

const px = (x: number, y: number, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
const g = (fill: string, rects: string, cls = '') => `<g${cls ? ` class="${cls}"` : ''} fill="${fill}">${rects}</g>`

// ponytail: CSS keyframes with steps() instead of SMIL, so the jumps stay pixel-crisp
// and prefers-reduced-motion can switch them off
const KEYFRAMES =
  '@keyframes hop{50%{transform:translateY(-1px)}}' +
  '@keyframes look{25%{transform:translateX(1px)}75%{transform:translateX(-1px)}}' +
  '@keyframes blink{94%{opacity:0}97%{opacity:1}}' +
  '@keyframes off{50%{opacity:0}}' +
  '@keyframes on{0%{opacity:0}50%{opacity:1}}' +
  '@keyframes scribble{50%{transform:translateX(-1px)}}' +
  '@keyframes d1{0%{opacity:0}25%{opacity:1}}@keyframes d2{0%{opacity:0}50%{opacity:1}}@keyframes d3{0%{opacity:0}75%{opacity:1}}'

export const petSvg = (mood: Mood, look: Look) => {
  const w = widthOf(look)
  const { width, height } = petPx(look)
  const e1 = Math.floor(w / 2) - 2
  const e2 = e1 + 3
  // tired, everything moves at half speed
  const s = (sec: number) => `${look.tired ? sec * 2 : sec}s steps(1) infinite`
  const act = mood === 'working' ? look.activity : null

  const css: string[] = []
  if (act === 'think' || mood === 'blocked') css.push(`.b{animation:hop ${s(mood === 'blocked' ? 1 : 0.5)}}`)
  if (act === 'think') css.push(`.e{animation:look ${s(2.4)}}`)
  if (mood === 'waiting' && !look.tired) css.push(`.t{animation:blink ${s(4)}}`)
  if (mood === 'blocked') css.push(`.x{animation:off ${s(0.5)}}`)
  if (act === 'build' || act === 'read') css.push(`.f1{animation:off ${s(act === 'read' ? 1.2 : 0.6)}}.f2{animation:on ${s(act === 'read' ? 1.2 : 0.6)}}`)
  if (act === 'write') css.push(`.p{animation:scribble ${s(0.3)}}`)
  if (act === 'think') css.push(`.d1{animation:d1 ${s(1.6)}}.d2{animation:d2 ${s(1.6)}}.d3{animation:d3 ${s(1.6)}}`)
  if (mood === 'waiting' && look.tired) css.push(`.z{animation:hop ${s(1)}}`)

  const body = [px(2, Y, w - 4), px(1, Y + 1, w - 2), px(0, Y + 2, w, 4), px(1, Y + 6, w - 2), px(2, Y + 7), px(w - 3, Y + 7)].join('')
  // eyes two pixels tall, so a blink, or tired lids, drop only the top half
  const eyes = (look.tired ? '' : g(DARK, px(e1, Y + 2) + px(e2, Y + 2), 't')) + px(e1, Y + 3) + px(e2, Y + 3)
  // reading glasses: two lenses with a bridge, the eyes on their inner edges
  const glasses =
    act === 'read'
      ? g(DARK, px(e1 + 1, Y + 2, 2, 1)) + g(LIGHT, px(e1 - 1, Y + 2, 2, 2) + px(e2, Y + 2, 2, 2))
      : ''
  // a face per mood, so the state reads without the color: a smile on your turn, an open mouth when it needs you
  const mouth =
    mood === 'waiting' ? px(e1, Y + 5) + px(e1 + 1, Y + 6, 2) + px(e2, Y + 5) : mood === 'blocked' ? px(e1 + 1, Y + 5, 2, 2) : ''
  const arm = act === 'read' || act === 'write' || act === 'build' ? px(w, Y + 4) : ''

  const x = w + 1
  const prop =
    act === 'read'
      ? // an open book whose page turns
        g('#5e81ac', px(x, Y + 5, 3, 1)) + g(LIGHT, px(x, Y + 3, 3, 2)) + g(GRAY, px(x + 1, Y + 3, 1, 2)) + g(LIGHT, px(x + 1, Y + 2), 'f2')
      : act === 'write'
        ? // a pencil scribbling on a sheet
          g(LIGHT, px(x, Y + 6, 3, 1)) + `<g class="p">${g('#ebcb8b', px(x, Y + 3) + px(x + 1, Y + 4))}${g(DARK, px(x + 2, Y + 5))}</g>`
        : act === 'build'
          ? // a hammer, raised then struck, with a spark
            g('#4c566a', px(x, Y + 7, 3, 1)) +
            `<g class="f1">${g('#ebcb8b', px(x, Y + 2, 1, 3))}${g(GRAY, px(w, Y + 1, 3, 1))}</g>` +
            `<g class="f2">${g('#ebcb8b', px(x, Y + 4, 2, 1))}${g(GRAY, px(x + 2, Y + 3, 1, 4))}${g('#ebcb8b', px(x + 2, Y + 1))}</g>`
          : act === 'think'
            ? g(GRAY, px(w - 2, Y - 1), 'd1') + g(GRAY, px(w, Y - 2), 'd2') + g(GRAY, px(w + 1, 0, 2, 2), 'd3')
            : mood === 'blocked'
              ? g(BODY.blocked, px(x, Y, 1, 4) + px(x, Y + 5), 'x')
              : mood === 'waiting' && look.tired
                ? g(GRAY, px(w, 0, 3, 1) + px(w + 1, 1) + px(w, 2, 3, 1), 'z')
                : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w + 4} 12" shape-rendering="crispEdges">` +
    `<style>${css.join('')}${KEYFRAMES}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
    `<g class="b">${g(BODY[mood], body + arm)}${glasses}<g class="e" fill="${DARK}">${eyes}</g>${g(DARK, mouth)}</g>` +
    prop +
    '</svg>'
  )
}

// The terminal has no Svg: one row of text, stepped by a clock tick.
export const petFrame = (mood: Mood, look: Look, tick: number) => {
  const pad = ' '.repeat(look.size)
  const eye = look.tired ? '=' : mood === 'blocked' ? '°' : '•'
  const mouth = mood === 'blocked' ? 'o' : mood === 'waiting' ? '‿' : '_'
  const face = (left = '', right = '') => `(${pad}${left}${eye}${mouth}${eye}${right}${pad})`
  const t = look.tired ? Math.floor(tick / 2) : tick
  const pick = (frames: string[]) => frames[t % frames.length]

  if (mood === 'blocked') return pick([`${face()}!`, `${face()} `])
  if (mood === 'waiting') {
    if (look.tired) return pick([`${face()}z`, `${face()}Z`])
    return pick([...Array<string>(7).fill(`${face()} `), `(${pad}-‿-${pad}) `])
  }
  switch (look.activity) {
    case 'think':
      return pick([`${face()}.  `, `${face()}.. `, `${face()}...`])
    case 'read':
      return pick([`${face(' ')}📖`, `${face('', ' ')}📖`])
    case 'write':
      return pick([`${face()}✎ `, `${face()} ✎`])
    case 'build':
      return pick([`${face()}⚒ `, `${face()} ⚒`])
  }
}
