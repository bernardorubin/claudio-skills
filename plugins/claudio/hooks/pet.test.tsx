import { expect, mock, test } from 'claude-code/testing'

import { moodOf, petFrame, petSvg } from './pet'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('mood, frames and sprite', async () => {
  expect(moodOf(true, true)).toBe('blocked')
  expect(moodOf(false, true)).toBe('working')
  expect(moodOf(false, false)).toBe('waiting')
  expect(petFrame('working', 0)).not.toBe(petFrame('working', 1))
  expect(petFrame('waiting', 7)).toBe('(-‿-) ')
  expect(petSvg('blocked')).toContain('class="x"')
  expect(petSvg('waiting')).not.toContain('class="x"')
  expect(petSvg('working')).toContain('prefers-reduced-motion')
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
