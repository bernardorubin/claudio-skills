import { expect, mock, test } from 'claude-code/testing'

import { lookOf, petFrame, petSvg } from './pet'
import { isNewer, publishedVersion } from './update-check'

const BAND = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('compares versions numerically and reads the published one', async () => {
  expect(isNewer('4.17.10', '4.17.9')).toBe(true)
  expect(isNewer('5.0.0', '4.99.99')).toBe(true)
  expect(isNewer('4.17.2', '4.17.2')).toBe(false)
  expect(isNewer('4.16.9', '4.17.0')).toBe(false)
  expect(isNewer(true, '4.17.2')).toBe(false)
  expect(isNewer('4.17.3', undefined)).toBe(false)
  expect(publishedVersion(JSON.stringify({ plugins: [{ name: 'other', version: '9.9.9' }, { name: 'claudio', version: '4.18.0' }] }))).toBe('4.18.0')
  expect(publishedVersion('not json')).toBeNull()
})

test('the angry look: red, frowning, with a flashing anger mark', async () => {
  const angry = { ...lookOf(10, 10, null), angry: true }
  expect(petSvg('waiting', angry)).toContain('#bf616a')
  expect(petSvg('waiting', angry)).toContain('class="x"')
  expect(petSvg('waiting', angry)).not.toContain('class="t"') // no blink
  expect(petFrame('waiting', angry, 0)).toContain('ò‸ó')
  // only your turn turns angry
  expect(petSvg('working', angry)).not.toContain('.x{animation')
})

test('a newer published claudio shows under Your turn once a day, with one toast', { options: { pet: true } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const toasts: string[] = []
  let fetches = 0
  on('http.fetch', () => {
    fetches++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ plugins: [{ name: 'claudio', version: '99.0.0' }] }) } }
  })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('/.claude-plugin/plugin.json') ? '{"version":"4.17.2"}' : '{}' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({ value: [] }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const start = () => $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  await start()

  const note = 'claudio 99.0.0 is out: run /update-claudio, or turn on auto-update in /plugin'
  for (const surface of ['terminal', 'desktop'] as const) {
    const idle = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(false) })
    expect(await idle.find({ type: 'Text', text: 'Your turn' })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: note })).toBeDefined()
    await idle.unmount()
    // while Claude works, the band says nothing about it
    const working = await $.ui.mount({ plugin: 'claudio', surface, ...BAND(true) })
    expect(await working.find({ type: 'Text', text: note })).toBeUndefined()
    await working.unmount()
  }

  // a second session the same day neither fetches nor toasts again
  await start()
  expect(fetches).toBe(1)
  expect(toasts.filter(t => t === note).length).toBe(1)
})
