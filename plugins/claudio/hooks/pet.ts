// The band's pet: a pixel sprite whose mood follows the session. Its hooks live in register.tsx.

export type Mood = 'working' | 'waiting' | 'blocked'
export type Sport = 'basketball' | 'soccer' | 'weights' | 'jumprope'
export type Activity = 'think' | 'read' | 'search' | 'write' | 'build' | 'juggle' | 'browse' | 'send' | 'plan' | 'cast' | Sport
// size grows with the context window's fill; tired when the 5-hour window runs low
// angry: on your turn while a newer claudio is published
export type Look = { size: 0 | 1 | 2; tired: boolean; activity: Activity; angry?: boolean }

export const moodOf = (blocked: boolean, isWorking: boolean): Mood =>
  blocked ? 'blocked' : isWorking ? 'working' : 'waiting'

// With no tool running the pet thinks or plays a sport, the next one after each tool ends.
const PLAY: Activity[] = ['think', 'basketball', 'soccer', 'weights', 'jumprope']

// What the running tool looks like the pet is doing.
export const activityOf = (tool: string | null, plays = 0): Activity =>
  tool === null
    ? (PLAY[plays % PLAY.length] ?? 'think')
    : /^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)
      ? 'read'
      : /^(WebFetch|WebSearch|ToolSearch)$/.test(tool)
        ? 'search'
        : /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)
          ? 'write'
          : /^(TodoWrite|Task(Create|Update|List|Get))$|update_plan/.test(tool)
            ? 'plan'
            : /^(Agent|Task|Workflow|SendMessage)$|start_session/.test(tool)
              ? 'juggle'
              : tool === 'Skill'
                ? 'cast'
                : /Browser|chrome|computer|Simulator|playwright/i.test(tool)
                  ? 'browse'
                  : /slack|gmail|send|reply|forward|draft|Notification/i.test(tool)
                    ? 'send'
                    : 'build'

// The same thresholds the band turns orange at: context 60% (red 85%), 5-hour 75% used.
export const lookOf = (ctxPct: number, fiveUsed: number, tool: string | null, plays = 0): Look => ({
  size: ctxPct >= 85 ? 2 : ctxPct >= 60 ? 1 : 0,
  tired: fiveUsed >= 75,
  activity: activityOf(tool, plays),
})

const BODY: Record<Mood, string> = { working: '#88c0d0', waiting: '#a3be8c', blocked: '#d08770' }
const CAPTION: Record<Mood, string> = { working: 'Working', waiting: 'Your turn', blocked: 'Needs you' }

// On your turn with a filling context window, the pet suggests making room.
export const captionOf = (mood: Mood, ctxPct: number) =>
  mood === 'waiting' && ctxPct >= 60 ? `Context ${ctxPct}% full: try /compact or /clear` : CAPTION[mood]

const ANGRY = '#bf616a'
// the 💢 anger mark, 5×5, in the free corner above the head's right side
const VEIN = [[1, 0], [3, 0], [0, 1], [1, 1], [3, 1], [4, 1], [0, 3], [1, 3], [3, 3], [4, 3], [1, 4], [3, 4]]
export const petColor = (mood: Mood, angry = false) => (angry && mood === 'waiting' ? ANGRY : BODY[mood])

// A grid of 3px pixels, 12 rows: the body fills rows 4–11 and is 10, 12 or 14
// wide by size; the 4 columns right of it hold a prop, a "!" or a "z", and the
// rows above the head hold thought dots, a raised barbell or a skipping rope.
const P = 3
const Y = 4
const DARK = '#2e3440'
const LIGHT = '#eceff4'
const GRAY = '#d8dee9'
const STEEL = '#4c566a'
const FROST = '#5e81ac'
const AMBER = '#ebcb8b'
const ROSE = '#bf616a'
const BALL = '#d08770'
const LEAF = '#a3be8c'

const widthOf = (look: Look) => 10 + 2 * look.size
export const petPx = (look: Look) => ({ width: (widthOf(look) + 4) * P, height: 12 * P })

const px = (x: number, y: number, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
const g = (fill: string, rects: string, cls = '', opacity = 1) =>
  `<g${cls ? ` class="${cls}"` : ''} fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${rects}</g>`
// two frames that swap halfway through each cycle
// a round 3×3 ball centred on (cx, cy)
const ball = (cx: number, cy: number) => px(cx, cy - 1) + px(cx - 1, cy, 3, 1) + px(cx, cy + 1)
const frames = (one: string, two: string) => `<g class="f1">${one}</g><g class="f2">${two}</g>`

const SPORTS: Activity[] = ['basketball', 'soccer', 'weights', 'jumprope']
// seconds per two-frame cycle
const CYCLE: Partial<Record<Activity, number>> = {
  read: 1.2,
  build: 0.6,
  juggle: 0.6,
  browse: 0.8,
  send: 1,
  plan: 1.2,
  cast: 0.8,
  basketball: 0.6,
  soccer: 0.8,
  weights: 1.2,
  jumprope: 0.6,
}

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
  // shaking, red, frowning under slanted brows, with a flashing anger mark
  const angry = mood === 'waiting' && look.angry === true
  const color = petColor(mood, angry)

  const css: string[] = []
  const sport = act !== null && SPORTS.includes(act)
  const cycle = act === null ? undefined : CYCLE[act]
  // the body hops while thinking, when it needs you, and over the rope, in step with it
  if (angry) css.push(`.b{animation:look ${s(0.4)}}.x{animation:off ${s(0.5)}}`)
  else if (act === 'think' || act === 'jumprope' || mood === 'blocked')
    css.push(`.b{animation:hop ${s(mood === 'blocked' ? 1 : act === 'jumprope' ? 0.6 : 0.5)}}`)
  if (act === 'think') css.push(`.e{animation:look ${s(2.4)}}`)
  if (mood === 'waiting' && !look.tired && !angry) css.push(`.t{animation:blink ${s(4)}}`)
  if (mood === 'blocked') css.push(`.x{animation:off ${s(0.5)}}`)
  if (cycle !== undefined) css.push(`.f1{animation:off ${s(cycle)}}.f2{animation:on ${s(cycle)}}`)
  if (act === 'search') css.push(`.m{animation:look ${s(1.2)}}`)
  if (act === 'write') css.push(`.p{animation:scribble ${s(0.3)}}`)
  if (act === 'think') css.push(`.d1{animation:d1 ${s(1.6)}}.d2{animation:d2 ${s(1.6)}}.d3{animation:d3 ${s(1.6)}}`)
  if (mood === 'waiting' && look.tired && !angry) css.push(`.z{animation:hop ${s(1)}}`)

  const body = [px(2, Y, w - 4), px(1, Y + 1, w - 2), px(0, Y + 2, w, 4), px(1, Y + 6, w - 2), px(2, Y + 7), px(w - 3, Y + 7)].join('')
  // a sheen on the top-left and a shadow along the bottom give the blob some volume
  const shading = g(LIGHT, px(2, Y + 1, 2, 1) + px(1, Y + 2), '', 0.5) + g(DARK, px(1, Y + 6, w - 2), '', 0.18)
  // a sweatband for sports; rosy cheeks on your turn
  const band = sport ? g(ROSE, px(1, Y + 1, w - 2)) : ''
  const cheeks = mood === 'waiting' && !look.tired && !angry ? g(ROSE, px(e1 - 1, Y + 4) + px(e2 + 1, Y + 4), '', 0.55) : ''
  // eyes two pixels tall, so a blink, or tired lids, drop only the top half
  const eyes = angry
    ? px(e1 - 1, Y + 2) + px(e1, Y + 3) + px(e2 + 1, Y + 2) + px(e2, Y + 3) // slanted, like \ /
    : (look.tired ? '' : g(DARK, px(e1, Y + 2) + px(e2, Y + 2), 't')) + px(e1, Y + 3) + px(e2, Y + 3)
  // glasses for focused work: two lenses with a bridge, the eyes on their inner edges
  const glasses =
    act === 'read' || act === 'search' || act === 'write' || act === 'browse' || act === 'plan'
      ? g(DARK, px(e1 + 1, Y + 2, 2, 1)) + g(LIGHT, px(e1 - 1, Y + 2, 2, 2) + px(e2, Y + 2, 2, 2))
      : ''
  // a face per mood, so the state reads without the color: a smile on your turn, an open mouth when it needs you
  const mouth = angry
    ? px(e1 + 1, Y + 5, 2) + px(e1, Y + 6) + px(e2, Y + 6)
    : mood === 'waiting' ? px(e1, Y + 5) + px(e1 + 1, Y + 6, 2) + px(e2, Y + 5) : mood === 'blocked' ? px(e1 + 1, Y + 5, 2, 2) : ''
  const arm =
    act === 'basketball'
      ? px(w, Y + 2)
      : act === 'juggle'
        ? px(1, Y - 1, 1, 2) + px(w - 2, Y - 1, 1, 2)
        : act !== null && !SPORTS.includes(act) && act !== 'think' && act !== 'search'
          ? px(w, Y + 4)
          : ''

  const x = w + 1
  const props: Record<Activity, string> = {
    // an open book whose page turns
    read: g(FROST, px(x, Y + 5, 3, 1)) + g(LIGHT, px(x, Y + 3, 3, 2)) + g(GRAY, px(x + 1, Y + 3, 1, 2)) + g(LIGHT, px(x + 1, Y + 2), 'f2'),
    // a magnifying glass sweeping side to side
    search: `<g class="m">${g(FROST, px(x, Y + 1, 3, 1) + px(x, Y + 2) + px(x + 2, Y + 2) + px(x, Y + 3, 3, 1))}${g(LIGHT, px(x + 1, Y + 2), '', 0.7)}${g(STEEL, px(w, Y + 4))}</g>`,
    // a pencil scribbling on a sheet
    write: g(LIGHT, px(x, Y + 6, 3, 1)) + `<g class="p">${g(AMBER, px(x, Y + 3) + px(x + 1, Y + 4))}${g(DARK, px(x + 2, Y + 5))}</g>`,
    // a hammer, raised then struck, with a spark
    build:
      g(STEEL, px(x, Y + 7, 3, 1)) +
      frames(g(AMBER, px(x, Y + 2, 1, 3)) + g(GRAY, px(w, Y + 1, 3, 1)), g(AMBER, px(x, Y + 4, 2, 1)) + g(GRAY, px(x + 2, Y + 3, 1, 4)) + g(AMBER, px(x + 2, Y + 1))),
    // three balls kept in the air, passed round each beat
    juggle: (() => {
      const [l, t, r] = [px(0, 1, 2, 2), px(Math.floor(w / 2) - 1, 0, 2, 2), px(w - 2, 1, 2, 2)]
      return frames(g(BALL, l) + g(AMBER, t) + g(LEAF, r), g(LEAF, l) + g(BALL, t) + g(AMBER, r))
    })(),
    // a laptop whose screen fills with lines
    browse:
      g(FROST, px(x, Y + 2, 3, 3)) +
      g(GRAY, px(w, Y + 5, 4, 1)) +
      frames(g(LIGHT, px(x, Y + 2, 2, 1)), g(LIGHT, px(x, Y + 2, 2, 1) + px(x, Y + 3, 3, 1) + px(x, Y + 4))),
    // a paper plane, thrown from the hand up and away
    send: frames(g(LIGHT, px(x, Y + 3, 3, 1) + px(x, Y + 4)) + g(GRAY, px(x + 1, Y + 4)), g(LIGHT, px(x, 0, 3, 1) + px(x, 1)) + g(GRAY, px(x + 1, 1))),
    // a clipboard whose boxes get ticked
    plan:
      g(LIGHT, px(x, Y + 2, 3, 5)) +
      g(STEEL, px(x + 1, Y + 1)) +
      g(GRAY, px(x + 1, Y + 3, 2, 1) + px(x + 1, Y + 5, 2, 1)) +
      g(LEAF, px(x, Y + 3)) +
      frames(g(STEEL, px(x, Y + 5)), g(LEAF, px(x, Y + 5))),
    // a wand with a star, throwing sparkles
    cast:
      g(STEEL, px(x, Y + 3) + px(x + 1, Y + 2)) +
      g(AMBER, px(x + 2, Y + 1)) +
      frames(g(AMBER, px(x, Y) + px(x + 2, Y - 2)), g(AMBER, px(x + 1, Y - 1) + px(x + 2, Y + 3))),
    think: g(GRAY, px(w - 2, Y - 1), 'd1') + g(GRAY, px(w, Y - 2), 'd2') + g(GRAY, px(w + 1, 0, 2, 2), 'd3'),
    // a dribble, from the raised hand to the floor
    basketball: frames(g(BALL, ball(x + 1, Y + 2)), g(BALL, ball(x + 1, Y + 6))),
    // keepy-uppy: off the knee, then high in the air
    soccer: frames(g(LIGHT, ball(x, Y + 6)) + g(DARK, px(x, Y + 6)), g(LIGHT, ball(x + 1, 1)) + g(DARK, px(x + 1, 1))),
    // a barbell pressed overhead from the shoulders, then lowered onto the head
    weights: frames(
      g(BODY[mood], px(1, 2, 1, 3) + px(w - 2, 2, 1, 3)) + g(GRAY, px(1, 1, w - 2, 1)) + g(STEEL, px(0, 0, 1, 3) + px(w - 1, 0, 1, 3)),
      g(BODY[mood], px(1, 4) + px(w - 2, 4)) + g(GRAY, px(1, 3, w - 2, 1)) + g(STEEL, px(0, 2, 1, 3) + px(w - 1, 2, 1, 3)),
    ),
    // the rope arcs over the head, then under the feet as the body hops
    jumprope: frames(
      g(AMBER, px(2, 1, w - 4, 1) + px(1, 2) + px(w - 2, 2) + px(0, 3, 1, 3) + px(w - 1, 3, 1, 3)),
      g(AMBER, px(0, 9) + px(w - 1, 9) + px(1, 10) + px(w - 2, 10) + px(2, 11, w - 4, 1)),
    ),
  }
  const prop = angry
    ? g(ANGRY, VEIN.map(([vx, vy]) => px(w - 1 + vx, vy)).join(''), 'x')
    : act !== null
      ? props[act]
      : mood === 'blocked'
        ? g(BODY.blocked, px(x, Y, 1, 4) + px(x, Y + 5), 'x')
        : mood === 'waiting' && look.tired
          ? g(GRAY, px(w, 0, 3, 1) + px(w + 1, 1) + px(w, 2, 3, 1), 'z')
          : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w + 4} 12" shape-rendering="crispEdges">` +
    `<style>${css.join('')}${KEYFRAMES}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
    `<g class="b">${g(color, body + arm)}${shading}${band}${cheeks}${glasses}<g class="e" fill="${DARK}">${eyes}</g>${g(DARK, mouth)}</g>` +
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
    if (look.angry) return pick([`(${pad}ò‸ó${pad})💢`, `(${pad}ò‸ó${pad})  `])
    if (look.tired) return pick([`${face()}z`, `${face()}Z`])
    return pick([...Array<string>(7).fill(`${face()} `), `(${pad}-‿-${pad}) `])
  }
  switch (look.activity) {
    case 'think':
      return pick([`${face()}.  `, `${face()}.. `, `${face()}...`])
    case 'read':
      return pick([`${face(' ')}📖`, `${face('', ' ')}📖`])
    case 'search':
      return pick([`${face(' ')}🔍`, `${face('', ' ')}🔍`])
    case 'write':
      return pick([`${face()}✎ `, `${face()} ✎`])
    case 'build':
      return pick([`${face()}⚒ `, `${face()} ⚒`])
    case 'juggle':
      return pick([`${face()}·°·`, `${face()}°·°`])
    case 'browse':
      return pick([`${face(' ')}💻`, `${face('', ' ')}💻`])
    case 'send':
      return pick([`${face()}✈ `, `${face()} ✈`])
    case 'plan':
      return pick([`${face()}☐ `, `${face()}☑ `])
    case 'cast':
      return pick([`${face()}✨ `, `${face()} ✨`])
    case 'basketball':
      return pick([`${face()}🏀 `, `${face()} 🏀`])
    case 'soccer':
      return pick([`${face()}⚽ `, `${face()} ⚽`])
    case 'weights':
      return pick([`ᕦ${face()}ᕤ`, ` ${face()} `])
    case 'jumprope':
      return pick([`~${face()}~`, `_${face()}_`])
  }
}
