import { expect, mock, test } from 'claude-code/testing'

const DIR = '/Users/test/Desktop/slack-drafts'
const DRAFT = 'Both are on staging.\n\n[HPY-1](https://example.com/HPY-1) is fixed, `pay_today` is `true`.'
const PANE = {
  component: 'Pane' as const,
  requestId: 'slack-drafts',
  props: { title: 'Slack drafts', isFocused: true, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

test('draws each draft as who and when, the message, then its actions', async ($, on) => {
  // a fake drafts folder beneath the mod
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: [{ name: 'dmytro-1008-1320.md', kind: 'file' as const, size: DRAFT.length, mtimeMs: 1, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: e.path === `${DIR}/dmytro-1008-1320.md` ? DRAFT : '' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: '/Users/test' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'claudio', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'dmytro' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Oct 8, 13:20' })).toBeDefined()
    expect(await ui.find({ key: 'copy-dmytro-1008-1320.md' })).toBeDefined()
    expect(await ui.find({ key: 'del-dmytro-1008-1320.md' })).toBeDefined()
    await ui.unmount()
  }
})

test('shows where to post above the message and copies the message alone', async ($, on) => {
  const NAME = 'nick-1014-1530.md'
  const RAW = '---\npost_in: [#eng thread](https://x.test/p1)\ntag: [Nick](https://x.test/team/U1)\n---\n@Nick fixed it'
  const runs: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: [{ name: NAME, kind: 'file' as const, size: RAW.length, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => ({ value: RAW }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'claudio', surface, ...PANE })
    expect(await ui.find({ key: `where-${NAME}` })).toBeDefined()
    await ui.press({ key: `copy-${NAME}` })
    await ui.unmount()
  }
  const script = runs[0]?.join(' ') ?? ''
  expect(script).toContain('@Nick fixed it')
  expect(script).not.toContain('post_in')
})

test('drops a draft deleted from another session on the next poll', async ($, on) => {
  const clock = mock.clock(on)
  let files = [{ name: 'dmytro-1008-1320.md', kind: 'file' as const, size: DRAFT.length, mtimeMs: 1, isLink: false }]
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: files }))
  on('fs.read', () => ({ value: DRAFT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })

  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  const before = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...PANE })
  expect(await before.find({ key: 'del-dmytro-1008-1320.md' })).toBeDefined()
  await before.unmount()

  files = []
  await clock.advance(3_000)
  const after = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'del-dmytro-1008-1320.md' })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: 'No drafts yet' })).toBeDefined()
  await after.unmount()
})
