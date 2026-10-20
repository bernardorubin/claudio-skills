import { expect, mock, test } from 'claude-code/testing'

import { activityOf, captionOf, lookOf, moodOf, petFrame, petPx, petSvg, signatureOf } from './pet'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

const FRESH = lookOf(10, 10, null)

test('mood, frames and sprite', async () => {
  expect(moodOf(true, true)).toBe('blocked')
  expect(moodOf(false, true)).toBe('working')
  expect(moodOf(false, false)).toBe('waiting')
  expect(petFrame('working', FRESH, 0)).not.toBe(petFrame('working', FRESH, 1))
  expect(petFrame('waiting', FRESH, 7)).toBe('(-‿-) ')
  expect(petSvg('blocked', FRESH)).toContain('class="x"')
  expect(petSvg('waiting', FRESH)).not.toContain('class="x"')
  expect(petSvg('working', FRESH)).toContain('prefers-reduced-motion')
})

test('grows with the context, tires near the 5-hour limit, and picks a prop by tool', async () => {
  expect([0, 60, 85].map(pct => lookOf(pct, 0, null).size)).toEqual([0, 1, 2])
  expect(petPx(lookOf(90, 0, null)).width).toBeGreaterThan(petPx(FRESH).width)
  expect(petFrame('waiting', lookOf(90, 0, null), 0)).toBe('(  •‿•  ) ')

  const tired = lookOf(10, 80, null)
  expect(tired.tired).toBe(true)
  expect(petSvg('waiting', tired)).not.toContain('class="t"') // lids down, no blink
  expect(petSvg('waiting', tired)).toContain('class="z"')
  expect(petFrame('working', tired, 0)).toBe(petFrame('working', tired, 1)) // half speed

  expect(['Read', 'Grep', 'Edit', 'Bash', 'mcp__x__y'].map(activityOf)).toEqual(['read', 'read', 'write', 'build', 'build'])
  expect(petSvg('working', lookOf(10, 10, 'Bash'))).toContain('class="f1"')
  expect(petSvg('working', lookOf(10, 10, 'Edit'))).toContain('class="p"')
  expect(petFrame('working', lookOf(10, 10, 'Read'), 0)).toContain('📖')
})

test('plays a different sport between tools, and wears glasses for focused work', async () => {
  expect([0, 1, 2, 3, 4, 5].map(n => activityOf(null, n))).toEqual(['think', 'basketball', 'soccer', 'weights', 'jumprope', 'think'])
  expect(activityOf('WebSearch')).toBe('search')
  const tools = ['Agent', 'mcp__Claude_Browser__navigate', 'mcp__slack__slack_send_message', 'TodoWrite', 'Skill', 'Bash']
  expect(tools.map(t => activityOf(t))).toEqual(['juggle', 'browse', 'send', 'plan', 'cast', 'build'])
  for (const tool of tools.slice(0, 5)) {
    const look = lookOf(10, 10, tool)
    expect(petSvg('working', look)).toContain('class="f2"')
    expect(petFrame('working', look, 0)).not.toBe(petFrame('working', look, 1))
  }
  for (const n of [1, 2, 3, 4]) {
    const look = lookOf(10, 10, null, n)
    expect(petSvg('working', look)).toContain('class="f2"')
    expect(petSvg('working', look)).toContain('#bf616a') // sweatband
    expect(petFrame('working', look, 0)).not.toBe(petFrame('working', look, 1))
  }
  // the rope swings in step with the hop
  expect(petSvg('working', lookOf(10, 10, null, 4))).toContain('.b{animation:hop')
  for (const tool of ['Read', 'WebSearch', 'Edit']) expect(petSvg('working', lookOf(10, 10, tool))).toContain('#eceff4')
  expect(petSvg('working', lookOf(10, 10, 'Bash'))).not.toContain('#bf616a')
})

const SIGNATURES = ['sail', 'wrap', 'snip', 'launch', 'sleuth', 'mark', 'sort', 'stash'] as const

test('a claudio skill with a signature shows it between tools, and tools keep their props', async () => {
  expect(['shipit', 'claudio:wrap-session', 'investigate', 'superpowers:brainstorming', 'constructor'].map(signatureOf)).toEqual([
    'sail',
    'wrap',
    'sleuth',
    null,
    null,
  ])
  expect(lookOf(10, 10, null, 3, 'sail').activity).toBe('sail')
  expect(lookOf(10, 10, 'Read', 3, 'sail').activity).toBe('read')
  for (const sig of SIGNATURES) {
    const look = lookOf(10, 10, null, 0, sig)
    expect(petSvg('working', look)).toMatch(sig === 'sleuth' ? '.m{animation:sweep' : '.f2{animation:on')
    expect(petFrame('working', look, 0)).not.toBe(petFrame('working', look, 1))
  }
  // the pet bobs in step with its ship
  expect(petSvg('working', lookOf(10, 10, null, 0, 'sail'))).toContain('.b,.hull{animation:bob')
})

test('every sprite stays inside its box at every size', async () => {
  const acts = ['think', 'read', 'search', 'write', 'build', 'juggle', 'browse', 'send', 'plan', 'cast', 'basketball', 'soccer', 'weights', 'jumprope', ...SIGNATURES] as const
  for (const ctx of [10, 60, 90]) {
    const base = lookOf(ctx, 10, null)
    const svgs = [
      ...acts.map(activity => petSvg('working', { ...base, activity })),
      petSvg('waiting', base),
      petSvg('waiting', lookOf(ctx, 80, null)),
      petSvg('waiting', { ...base, angry: true }),
      petSvg('blocked', base),
    ]
    for (const svg of svgs) {
      const [, boxW = '0', boxH = '0'] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? []
      for (const [, x = '', y = '', w = '', h = ''] of svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g)) {
        expect(Number(x) >= 0 && Number(y) >= 0 && Number(x) + Number(w) <= Number(boxW) && Number(y) + Number(h) <= Number(boxH)).toBe(true)
      }
    }
  }
})

test('sails through shipit between its tools until the turn ends', { options: { pet: true } }, async ($, on) => {
  mock.clock(on)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('store.get', () => ({ value: true }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  const sprite = async () => {
    const band = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...BAND(true) })
    const svg = await band.find({ type: 'Svg' })
    await band.unmount()
    return String(svg?.props.source)
  }

  expect(await sprite()).not.toContain('class="hull"')
  await $.skill.prompt({ skill: 'claudio:shipit', text: 'Ship it.' })
  expect(await sprite()).toContain('class="hull"')
  // a helper skill shipit loads keeps the ship
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: 'Ask first.' })
  expect(await sprite()).toContain('class="hull"')
  // a subagent's turn ending leaves it; the main turn's ending clears it
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  expect(await sprite()).toContain('class="hull"')
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await sprite()).not.toContain('class="hull"')
})

test('suggests /compact or /clear on your turn once the context fills', async () => {
  expect(captionOf('waiting', 59)).toBe('Your turn')
  expect(captionOf('waiting', 72)).toBe('Context 72% full: try /compact or /clear')
  expect(captionOf('working', 90)).toBe('Working')
})

test('shows working, your turn, and needs you while a question or a permission dialog waits', { options: { pet: true } }, async ($, on) => {
  mock.clock(on)
  // the question is answered only when this promise settles, so the band is read meanwhile
  let answer: () => void = () => undefined
  let reached: () => void = () => undefined
  const asked = new Promise<void>(r => (reached = r))
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: { text: 'ok' } }
    reached()
    return new Promise(resolve => (answer = () => resolve({ result: { text: 'picked a' } })))
  })
  on('classic.PermissionRequest', () => ({}))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('store.get', () => ({ value: true }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const working = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(true) })
    expect(await working.find({ type: 'Text', text: 'Working' })).toBeDefined()
    await working.unmount()

    const idle = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(false) })
    expect(await idle.find({ type: 'Text', text: 'Your turn' })).toBeDefined()
    await idle.unmount()
  }

  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await asked
  for (const surface of ['terminal', 'desktop'] as const) {
    const asking = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(true) })
    expect(await asking.find({ type: 'Text', text: 'Needs you' })).toBeDefined()
    await asking.unmount()
  }
  answer()
  await call

  const after = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...BAND(true) })
  expect(await after.find({ type: 'Text', text: 'Working' })).toBeDefined()
  await after.unmount()

  // a permission dialog blocks until that tool's call resolves
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  const dialog = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...BAND(true) })
  expect(await dialog.find({ type: 'Text', text: 'Needs you' })).toBeDefined()
  await dialog.unmount()
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const ran = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...BAND(true) })
  expect(await ran.find({ type: 'Text', text: 'Working' })).toBeDefined()
  await ran.unmount()
})

test('points at the Pet option once while it is off', async ($, on) => {
  mock.store(on)
  const toasts: string[] = []
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/Users/test' }))

  const start = () => $.session.start({ cwd: '/Users/test', surface: 'terminal', isInteractive: true })
  await start()
  await start()
  expect(toasts.filter(t => t.includes('Pet option')).length).toBe(1)
})

test('reads the context with the usage bars off, and draws the hint', { options: { pet: true } }, async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 720_000, window: 1_000_000, percent: 72 }, rateLimits: [] },
  }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{}' }))
  on('store.get', () => ({ value: true }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(false) })
    expect(await band.find({ type: 'Text', text: 'Context 72% full: try /compact or /clear' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '5-hour limit' })).toBeUndefined() // no usage bars
    await band.unmount()
  }
})
