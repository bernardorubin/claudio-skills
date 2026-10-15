import { expect, mock, test } from 'claude-code/testing'

import { activityOf, captionOf, lookOf, moodOf, petFrame, petPx, petSvg } from './pet'

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
