// The band's pet: a 16-bit pixel sprite whose mood follows the session. Its hooks live in register.tsx.

export type Mood = 'working' | 'waiting' | 'blocked'
export type Sport = 'basketball' | 'soccer' | 'weights' | 'jumprope'
// What a running claudio skill looks like the pet is doing between its tools.
export type Signature = 'sail' | 'wrap' | 'snip' | 'launch' | 'sleuth' | 'mark' | 'sort' | 'stash'
export type Activity = 'think' | 'read' | 'search' | 'write' | 'build' | 'juggle' | 'browse' | 'send' | 'plan' | 'cast' | Sport | Signature
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

// shipit sails, wrap-session wraps a gift, cut-release cuts a ribbon, promote-to-prod launches a rocket
const SIGNATURES = new Map<string, Signature>([
  ['shipit', 'sail'],
  ['wrap-session', 'wrap'],
  ['cut-release', 'snip'],
  ['promote-to-prod', 'launch'],
  ['investigate', 'sleuth'],
  ['pr-review', 'mark'],
  ['review-cycle', 'mark'],
  ['slack-triage', 'sort'],
  ['inbox-triage', 'sort'],
  ['figma-triage', 'sort'],
  ['vercel-triage', 'sort'],
  ['super-triage', 'sort'],
  ['save-to-vault', 'stash'],
  ['save-session-to-worklog', 'stash'],
])

// A claudio skill's signature, or null for one without (it keeps the usual play).
export const signatureOf = (skill: string) => SIGNATURES.get(skill.replace(/^claudio:/, '')) ?? null

// The same thresholds the band turns orange at: context 60% (red 85%), 5-hour 75% used.
// A running skill's signature takes the place of play between its tools.
export const lookOf = (ctxPct: number, fiveUsed: number, tool: string | null, plays = 0, signature: Signature | null = null): Look => ({
  size: ctxPct >= 85 ? 2 : ctxPct >= 60 ? 1 : 0,
  tired: fiveUsed >= 75,
  activity: tool === null && signature !== null ? signature : activityOf(tool, plays),
})

const BODY: Record<Mood, string> = { working: '#88c0d0', waiting: '#a3be8c', blocked: '#d08770' }
const CAPTION: Record<Mood, string> = { working: 'Working', waiting: 'Your turn', blocked: 'Needs you' }

// On your turn with a filling context window, the pet suggests making room.
export const captionOf = (mood: Mood, ctxPct: number) =>
  mood === 'waiting' && ctxPct >= 60 ? `Context ${ctxPct}% full: try /compact or /clear` : CAPTION[mood]

const ANGRY = '#bf616a'
export const petColor = (mood: Mood, angry = false) => (angry && mood === 'waiting' ? ANGRY : BODY[mood])

// A grid of 1.5px pixels, 24 rows, at the size the 8-bit pet's 3px grid had: the
// body fills rows 8–23 and is 20, 24 or 28 wide by size; the 8 columns right of it
// hold a prop, a "!" or a "z", and the rows above the head hold thought bubbles, a
// raised barbell, a skipping rope or a hat.
const P = 1.5
const INK = '#2e3440'
const STEEL = '#4c566a'
const GRAY = '#d8dee9'
const LIGHT = '#eceff4'
const AMBER = '#ebcb8b'
const ROSE = '#bf616a'
const PLUM = '#b48ead'
const WOOD = '#a0785a'

// a mix of two #rrggbb colors, t of the way from a to b
const mix = (a: string, b: string, t: number) =>
  '#' +
  [1, 3, 5]
    .map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0'))
    .join('')

// One letter per color in the pixel maps; the capitals are the body's, set per mood.
const INKS: Record<string, string> = {
  k: INK,
  t: STEEL,
  g: GRAY,
  w: LIGHT,
  s: '#88c0d0',
  f: '#5e81ac',
  r: ROSE,
  q: mix(ROSE, INK, 0.35),
  o: '#d08770',
  a: AMBER,
  u: mix(AMBER, '#ffffff', 0.6),
  l: '#a3be8c',
  p: PLUM,
  j: mix(PLUM, INK, 0.35),
  n: WOOD,
  m: mix(WOOD, INK, 0.4),
}
// an outline, the base, a shadow, a sheen, and rosy cheeks
const bodyInks = (c: string) => ({ O: mix(c, INK, 0.6), B: c, S: mix(c, INK, 0.22), H: mix(c, '#ffffff', 0.45), C: mix(c, ROSE, 0.6) })

const px = (x: number, y: number, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
const g = (fill: string, rects: string) => `<g fill="${fill}">${rects}</g>`
// A pixel map, one string per row: '.' is see-through, any other letter a color of `inks`.
// Runs of one color in a row become one rect.
const art = (inks: Record<string, string>, x0: number, y0: number, rows: string[], cls = '') => {
  const runs = new Map<string, string>()
  rows.forEach((row, y) => {
    for (let x = 0, n = 1; x < row.length; x += n) {
      for (n = 1; row.charAt(x + n) === row.charAt(x); ) n++
      const fill = inks[row.charAt(x)]
      if (fill !== undefined) runs.set(fill, (runs.get(fill) ?? '') + px(x0 + x, y0 + y, n))
    }
  })
  const out = [...runs].map(([fill, rects]) => g(fill, rects)).join('')
  return cls ? `<g class="${cls}">${out}</g>` : out
}
// widens a map by repeating its column `at` k more times
const stretch = (rows: string[], at: number, k: number) => rows.map(r => r.slice(0, at) + r.charAt(at).repeat(k) + r.slice(at))
// two frames that swap halfway through each cycle
const frames = (one: string, two: string) => `<g class="f1">${one}</g><g class="f2">${two}</g>`

// the size-0 body, widened at column 10 for the bigger sizes
const BODY_MAP = [
  '......OOOOOOOO......',
  '....OOHHHBBBBBOO....',
  '...OHHHBBBBBBBBBO...',
  '..OHHBBBBBBBBBBBBO..',
  '.OHHBBBBBBBBBBBBBBO.',
  '.OHBBBBBBBBBBBBBBBO.',
  'OHBBBBBBBBBBBBBBBBBO',
  'OBBBBBBBBBBBBBBBBBBO',
  'OBBBBBBBBBBBBBBBBBBO',
  'OBBBBBBBBBBBBBBBBBSO',
  'OBBBBBBBBBBBBBBBBBSO',
  'OSBBBBBBBBBBBBBBBSSO',
  '.OSBBBBBBBBBBBBBBSO.',
  '..OSSSSSSSSSSSSSSO..',
  '...OSSO......OSSO...',
  '....OO........OO....',
]
// round glasses for focused work, the pupils on the lenses' inner edges
const GLASSES = ['.kk......kk.', 'kwgkkkkkkwgk', 'kgkk....kkgk', 'kgkk....kkgk', '.kk......kk.']
// a checked deerstalker, widened at column 7 with the head
const HAT = ['.....nnnn.....', '...nnmnnmnn...', '..nmnnmnnmnn..', '.nnmnnmnnmnnn.', '.nmnnmnnmnnmn.', 'mmmmmmmmmmmmmm']
// the 💢 anger mark, in the free corner above the head's right side
const VEIN = ['..r.r..', '.rr.rr.', 'rr...rr', '.......', 'rr...rr', '.rr.rr.', '..r.r..']
const ball = (c: string) => ['.cc.', 'cwcc', 'cccc', '.cc.'].map(r => r.replace(/c/g, c))
const BASKETBALL = ['.oo.', 'okoo', 'ooko', '.oo.']
const SOCCER = ['.ww.', 'wwkw', 'wkww', '.ww.']
const PLATE = ['tt', 'tt', 'tt', 'tt', 'tt']
const PLANE = ['ww....', 'wwwwww', '.gg...']
const ROCKET = ['..r..', '.rrr.', '.www.', '.wfw.', '.wsw.', '.www.', '.www.', 'owwwo', 'o.t.o']
const ENVELOPE = ['tttttt', 'tgwwgt', 'twggwt', 'twwwwt', 'tttttt']
const SCROLL = ['.n.', 'uuu', 'uau', 'uuu', '.n.']
const PEN = ['q', 'r', 'r', 'k']
const SAIL = ['w....', 'ww...', 'ww...', 'wwg..', 'wwwg.', 'wwwg.', 'wwwwg', 'wwwwg', 'wwwwg', 'wwwwg', 'mmmmm']

const SPORTS: Activity[] = ['basketball', 'soccer', 'weights', 'jumprope']
const HOLDS: Activity[] = ['read', 'write', 'build', 'browse', 'send', 'plan', 'cast', 'wrap', 'snip', 'mark', 'sort', 'stash', 'sleuth']
const FOCUSED: Activity[] = ['read', 'search', 'write', 'browse', 'plan', 'mark']
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
  sail: 1.2,
  wrap: 1.2,
  snip: 0.8,
  launch: 0.6,
  mark: 1.2,
  sort: 1,
  stash: 1.2,
}

// ponytail: CSS keyframes with steps() instead of SMIL, so the jumps stay pixel-crisp
// and prefers-reduced-motion can switch them off
const KEYFRAMES =
  '@keyframes hop{50%{transform:translateY(-2px)}}' +
  '@keyframes bob{50%{transform:translateY(1px)}}' +
  '@keyframes look{25%{transform:translateX(1px)}75%{transform:translateX(-1px)}}' +
  '@keyframes sweep{25%{transform:translateX(2px)}75%{transform:translateX(-2px)}}' +
  '@keyframes blink{94%{opacity:0}97%{opacity:1}}' +
  '@keyframes off{50%{opacity:0}}' +
  '@keyframes on{0%{opacity:0}50%{opacity:1}}' +
  '@keyframes scribble{50%{transform:translateX(-1px)}}' +
  '@keyframes d1{0%{opacity:0}25%{opacity:1}}@keyframes d2{0%{opacity:0}50%{opacity:1}}@keyframes d3{0%{opacity:0}75%{opacity:1}}'

const widthOf = (look: Look) => 20 + 4 * look.size
export const petPx = (look: Look) => ({ width: (widthOf(look) + 8) * P, height: 24 * P })

export const petSvg = (mood: Mood, look: Look) => {
  const w = widthOf(look)
  const W = w + 8
  const k = w - 20
  const { width, height } = petPx(look)
  const cx = w / 2
  const e1 = cx - 5
  const e2 = cx + 3
  // where a held prop starts, over the hand
  const X = w + 1
  // tired, everything moves at half speed
  const s = (sec: number) => `${look.tired ? sec * 2 : sec}s steps(1) infinite`
  const act = mood === 'working' ? look.activity : null
  // shaking, red, frowning under slanted brows, with a flashing anger mark
  const angry = mood === 'waiting' && look.angry === true
  const inks = { ...INKS, ...bodyInks(petColor(mood, angry)) }
  const d = (x: number, y: number, rows: string[], cls = '') => art(inks, x, y, rows, cls)

  const css: string[] = []
  const sport = act !== null && SPORTS.includes(act)
  const cycle = act === null ? undefined : CYCLE[act]
  // the body hops while thinking, when it needs you, and over the rope, in step with it; it bobs with its ship
  if (angry) css.push(`.b{animation:sweep ${s(0.4)}}.x{animation:off ${s(0.5)}}`)
  else if (act === 'sail') css.push(`.b,.hull{animation:bob ${s(1.2)}}`)
  else if (act === 'think' || act === 'jumprope' || mood === 'blocked')
    css.push(`.b{animation:hop ${s(mood === 'blocked' ? 1 : act === 'jumprope' ? 0.6 : 0.5)}}`)
  if (act === 'think') css.push(`.e{animation:look ${s(2.4)}}`)
  if (mood === 'waiting' && !look.tired && !angry) css.push(`.t{animation:blink ${s(4)}}`)
  if (mood === 'blocked') css.push(`.x{animation:off ${s(0.5)}}`)
  if (cycle !== undefined) css.push(`.f1{animation:off ${s(cycle)}}.f2{animation:on ${s(cycle)}}`)
  if (act === 'search' || act === 'sleuth') css.push(`.m{animation:sweep ${s(1.2)}}`)
  if (act === 'write') css.push(`.p{animation:scribble ${s(0.3)}}`)
  if (act === 'think') css.push(`.d1{animation:d1 ${s(1.6)}}.d2{animation:d2 ${s(1.6)}}.d3{animation:d3 ${s(1.6)}}`)
  if (mood === 'waiting' && look.tired && !angry) css.push(`.z{animation:hop ${s(1)}}`)

  const body = d(0, 8, stretch(BODY_MAP, 10, k))
  // a sweatband for sports; rosy cheeks on your turn
  const band = sport ? d(4, 10, ['r'.repeat(w - 8)]) + d(3, 11, ['q'.repeat(w - 6)]) : ''
  const cheeks = mood === 'waiting' && !look.tired && !angry ? d(e1 - 2, 16, ['CC']) + d(e2 + 2, 16, ['CC']) : ''
  // eyes three pixels tall with a glint, so a blink, or tired lids, drop only the top two
  const eyes = angry
    ? d(e1 - 1, 10, ['kk.', '.kk']) + d(e2, 10, ['.kk', 'kk.']) + d(e1, 12, ['kk', 'kk']) + d(e2, 12, ['kk', 'kk'])
    : (look.tired ? '' : d(e1, 12, ['wk', 'kk'], 't') + d(e2, 12, ['wk', 'kk'], 't')) + d(e1, 14, ['kk']) + d(e2, 14, ['kk'])
  const glasses = act !== null && FOCUSED.includes(act) ? d(e1 - 1, 11, GLASSES) : ''
  // a face per mood, so the state reads without the color: a smile on your turn, an open mouth when it needs you
  const mouth = angry
    ? d(cx - 2, 16, ['.kk.', 'k..k'])
    : mood === 'waiting'
      ? d(cx - 2, 16, ['k..k', '.kk.'])
      : mood === 'blocked'
        ? d(cx - 2, 16, ['.kk.', 'krrk', '.kk.'])
        : d(cx - 1, 17, ['kk'])
  const hat = act === 'sleuth' ? d(cx - 7 - k / 2, 4, stretch(HAT, 7, k)) : ''
  const hand = (y: number) => d(w - 1, y, ['.OO', 'BBO', '.OO'])
  const arm =
    act === 'basketball'
      ? hand(12)
      : act === 'juggle'
        ? d(2, 6, ['OO', 'OB', 'OB', 'OB']) + d(w - 4, 6, ['OO', 'BO', 'BO', 'BO'])
        : act !== null && HOLDS.includes(act)
          ? hand(15)
          : ''

  // a magnifying glass, its handle down to the hand
  const glass = d(X - 1, 7, ['..ttt..', '.twsst.', '.tssst.', '.tssft.', '..ttt..', '.nn....', 'nn.....', 'n......'], 'm')
  // the ship's hull, portholes along it, over the waves
  const hull = [
    'm'.repeat(W),
    Array.from({ length: W }, (_, i) => (i % 6 === 3 ? 'a' : 'n')).join(''),
    '.' + 'n'.repeat(W - 3) + '..',
    '..' + 'm'.repeat(W - 6) + '....',
  ]
  const sea = (shift: number) => d(0, 22, [Array.from({ length: W }, (_, i) => 'ws..'.charAt((i + shift) % 4)).join(''), 'f'.repeat(W)])

  const props: Record<Activity, string> = {
    // an open book whose page turns
    read: d(X, 12, ['.wwtww.', 'wggtggw', 'wwwtwww', 'wggtggw', 'wwwtwww', 'fffffff', '.fffff.']) + d(X + 3, 9, ['..ww', '.ww.', 'ww..'], 'f2'),
    // a magnifying glass sweeping side to side
    search: glass,
    // a pencil scribbling on a sheet
    write: d(X, 20, ['wwwwwww', 'wttttww', 'wwwwwww']) + d(X + 1, 14, ['.....o', '....aa', '...aa.', '..aa..', '.nn...', 'kn....'], 'p'),
    // a hammer, raised then struck on an anvil, with a spark
    build:
      d(X + 1, 20, ['gggggt', 'tttttt', '..tt..', '.tttt.']) +
      frames(d(X - 1, 8, ['ggg', 'ttt', '.n.', '.n.', '.n.', '.n.', '.n.', '.n.']), d(X, 15, ['....gt.', 'nnnngta', '....gt.', '....gt.', '....gtu'])),
    // three balls kept in the air, passed round each beat
    juggle: frames(
      d(0, 2, ball('o')) + d(cx - 2, 0, ball('a')) + d(w - 4, 2, ball('l')),
      d(0, 2, ball('l')) + d(cx - 2, 0, ball('o')) + d(w - 4, 2, ball('a')),
    ),
    // a laptop whose screen fills with lines
    browse:
      d(X, 14, ['.ttttt.', '.tffft.', '.tffft.', '.tffft.', '.ttttt.', 'ggggggg', 'ttttttt']) +
      frames(d(X + 2, 15, ['ww.']), d(X + 2, 15, ['ww.', 'sww', 'w..'])),
    // a paper plane, thrown from the hand up and away
    send: frames(d(X, 14, PLANE), d(X + 1, 1, PLANE)),
    // a clipboard whose boxes get ticked
    plan:
      d(X, 12, ['..tt..', 'nnttnn', 'nwwwwn', 'nlwggn', 'nwwwwn', 'nwwggn', 'nwwwwn', 'nnnnnn']) +
      frames(d(X + 1, 17, ['t']), d(X + 1, 17, ['l'])),
    // a wand with a star, throwing sparkles
    cast:
      d(X, 10, ['....a..', '...aua.', '..t.a..', '.t.....', 't......']) +
      frames(d(X + 1, 8, ['u']) + d(X + 6, 7, ['a']), d(X + 6, 13, ['u']) + d(X + 2, 9, ['a'])),
    think: d(w - 4, 6, ['gg', 'gg'], 'd1') + d(w - 1, 3, ['.g.', 'gwg', '.g.'], 'd2') + d(w + 1, 0, ['.gggg.', 'gwwwwg', 'gwwwwg', '.gggg.'], 'd3'),
    // a dribble, from the raised hand to the floor
    basketball: frames(d(X + 1, 10, BASKETBALL), d(X + 1, 20, BASKETBALL)),
    // keepy-uppy: off the knee, then high in the air
    soccer: frames(d(X, 19, SOCCER), d(X + 2, 0, SOCCER)),
    // a barbell pressed overhead from the shoulders, then lowered onto the head
    weights: frames(
      d(0, 0, PLATE) + d(w - 2, 0, PLATE) + d(2, 2, ['g'.repeat(w - 4)]) + d(2, 3, Array<string>(7).fill('OB')) + d(w - 4, 3, Array<string>(7).fill('BO')),
      d(0, 4, PLATE) + d(w - 2, 4, PLATE) + d(2, 6, ['g'.repeat(w - 4)]) + d(2, 7, Array<string>(3).fill('OB')) + d(w - 4, 7, Array<string>(3).fill('BO')),
    ),
    // the rope arcs over the head, then under the feet as the body hops
    jumprope: frames(
      g(AMBER, px(5, 2, w - 10) + px(3, 3, 2) + px(w - 5, 3, 2) + px(2, 4) + px(w - 3, 4) + px(1, 5, 1, 2) + px(w - 2, 5, 1, 2) + px(0, 7, 1, 6) + px(w - 1, 7, 1, 6)),
      g(AMBER, px(0, 18, 1, 3) + px(w - 1, 18, 1, 3) + px(1, 21) + px(w - 2, 21) + px(2, 22, 2) + px(w - 4, 22, 2) + px(4, 23, w - 8)),
    ),
    // shipit: the pet sails a ship that bobs on the waves, its pennant flying
    sail:
      `<g class="hull">${d(w + 2, 1, Array<string>(17).fill('m'))}${d(w + 3, 4, SAIL)}${d(0, 18, hull)}` +
      `${frames(d(w + 3, 1, ['rrr', 'rr.']), d(w + 3, 1, ['rr.', 'rrr']))}</g>` +
      frames(sea(0), sea(2)),
    // wrap-session: a box, its paper folding up, then tied with a ribbon and a bow
    wrap: frames(
      d(X, 17, ['nnnnnnn', 'nmmmmmn', 'nnnnnnn', 'ppppppp', 'ppppppp', 'jjjjjjj']) + d(X + 4, 12, ['..p', '.pp', 'ppj', 'pj.', 'j..']),
      d(X, 17, ['jjjajjj', 'pppappp', 'aaaaaaa', 'pppappp', 'pppappp', 'jjjajjj']) + d(X + 1, 14, ['aa.aa', 'auaua', '..a..']),
    ),
    // cut-release: scissors snip a ribbon, its cut end dropping
    snip: frames(
      d(X - 1, 16, ['rrrrrrrr', 'qqqqqqqq']) + d(X + 1, 10, ['ff.ff', 'ff.ff', '.gtg.', '.g.g.', 'g...g']),
      d(X - 1, 16, ['rrrr', 'qqqq']) + d(X + 4, 17, ['rrr', 'qqq']) + d(X + 1, 12, ['.fff.', '.f.f.', '..t..', '..g..', '..g..']),
    ),
    // promote-to-prod: a rocket on its pad, then lifting off on a column of flame
    launch:
      d(X, 23, ['ttttttt']) +
      frames(
        d(X + 1, 13, ROCKET) + d(X + 2, 22, ['.a.']),
        d(X + 1, 8, ROCKET) + d(X + 2, 17, ['aua', 'aua', '.a.', '.u.']) + d(X, 21, ['gg...gg', 'ggg.ggg']),
      ),
    // investigate: a deerstalker on, sweeping a magnifying glass for clues
    sleuth: glass,
    // pr-review: a red pen underlining a page's lines
    mark:
      d(X, 12, ['ggggggg', 'gwwwwwg', 'gwtttwg', 'gwwwwwg', 'gwtttwg', 'gwwwwwg', 'gwtttwg', 'gwwwwwg', 'ggggggg']) +
      frames(d(X + 2, 15, ['rrr']) + d(X + 5, 12, PEN), d(X + 2, 15, ['rrr']) + d(X + 2, 17, ['rrr']) + d(X + 5, 14, PEN)),
    // the triage skills: a letter sorted into a tray
    sort:
      frames(d(X, 13, ENVELOPE) + d(X + 1, 19, ['wwwww']), d(X, 15, ENVELOPE) + d(X + 1, 18, ['ggggg', 'wwwww'])) +
      d(X, 18, ['f.....f', 'f.....f', 'fffffff']),
    // save-to-vault: a scroll slid into a safe, its dial turning
    stash:
      frames(d(X + 2, 9, SCROLL), d(X + 2, 12, SCROLL)) +
      d(X, 15, ['ggggggt', 'gtkkktt', 'gtttttt', 'gtttttt', 'gtttttt', 'gtttttt', 'gtttttt', 'kk...kk']) +
      frames(d(X + 2, 18, ['.a.', 'gtg', '.g.']), d(X + 2, 18, ['.g.', 'gta', '.g.'])) +
      d(X + 5, 19, ['g', 'g']),
  }
  const prop = angry
    ? d(w, 0, VEIN, 'x')
    : act !== null
      ? props[act]
      : mood === 'blocked'
        ? d(X + 2, 9, ['oo', 'oo', 'oo', 'oo', 'oo', 'oo', '..', 'oo', 'oo'], 'x')
        : mood === 'waiting' && look.tired
          ? d(w + 1, 0, ['ggggg', '...g.', '..g..', '.g...', 'ggggg'], 'z') + d(w + 5, 6, ['ggg', '.g.', 'ggg'], 'z')
          : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} 24" shape-rendering="crispEdges">` +
    `<style>${css.join('')}${KEYFRAMES}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
    `<g class="b">${body}${arm}${band}${cheeks}<g class="e">${eyes}</g>${glasses}${mouth}${hat}</g>` +
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
    case 'sail':
      return pick([`${face()}🚢 `, `${face()} 🚢`])
    case 'wrap':
      return pick([`${face()}📦`, `${face()}🎁`])
    case 'snip':
      return pick([`${face()}✂ `, `${face()} ✂`])
    case 'launch':
      return pick([`${face()}🚀 `, `${face()} 🚀`])
    case 'sleuth':
      return pick([`${face(' ')}🔎`, `${face('', ' ')}🔎`])
    case 'mark':
      return pick([`${face()}✓ `, `${face()}✓✓`])
    case 'sort':
      return pick([`${face()}✉ `, `${face()}📥`])
    case 'stash':
      return pick([`${face()}📜`, `${face()}🔒`])
  }
}
