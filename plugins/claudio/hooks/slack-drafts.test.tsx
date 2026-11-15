import { expect, mock, test } from 'claude-code/testing'

import { clipboardScript } from './slack-html'

const DIR = '/Users/test/Desktop/slack-drafts'
const DRAFT = 'Both are on staging.\n\n[HPY-1](https://example.com/HPY-1) is fixed, `pay_today` is `true`.'
const PANE = {
  component: 'Pane' as const,
  requestId: 'slack-drafts',
  props: { title: 'Slack drafts', isFocused: true, bodyColumns: 48, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

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
    expect(await ui.find({ type: 'Text', text: '@Nick' })).toBeDefined()
    await ui.press({ key: `copy-${NAME}` })
    await ui.unmount()
  }
  const script = runs[0]?.join(' ') ?? ''
  expect(script).toContain('@Nick fixed it')
  expect(script).not.toContain('post_in')
  // the pane's mention highlight is display-only: the copy stays exactly the draft
  expect(script).toBe(`osascript -e ${clipboardScript('@Nick fixed it')}`)
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

test('Sent moves the draft into sent/ and stamps it; the trash icon moves it to the Trash', async ($, on) => {
  const NAME = 'dmytro-1008-1320.md'
  const runs: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', ($, e) => ({ value: e.path === DIR ? [{ name: NAME, kind: 'file' as const, size: DRAFT.length, mtimeMs: 1, isLink: false }] : [] }))
  on('fs.read', () => ({ value: DRAFT }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: ok }
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
    expect(await ui.find({ key: `sent-${NAME}` })).toBeDefined()
    expect(await ui.find({ key: `del-${NAME}` })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...PANE })
  await ui.press({ key: `sent-${NAME}` })
  await ui.unmount()
  expect(runs).toContainEqual(['mkdir', '-p', `${DIR}/sent`])
  expect(runs).toContainEqual(['mv', `${DIR}/${NAME}`, `${DIR}/sent/${NAME}`])
  expect(runs).toContainEqual(['touch', `${DIR}/sent/${NAME}`])

  runs.length = 0
  const again = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...PANE })
  await again.press({ key: `del-${NAME}` })
  await again.unmount()
  const mv = runs.find(r => r[0] === 'mv')
  expect(mv?.[1]).toBe(`${DIR}/${NAME}`)
  expect(String(mv?.[2])).toStartWith('/Users/test/.Trash/')
})

test('moves sent drafts older than the option to the Trash at session start', { options: { sentDays: '7' } }, async ($, on) => {
  const clock = mock.clock(on)
  const DAY = 86_400_000
  await clock.advance(30 * DAY)
  const now = clock.now()
  const runs: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', ($, e) => ({
    value:
      e.path === `${DIR}/sent`
        ? [
            { name: 'old-1001-0900.md', kind: 'file' as const, size: 1, mtimeMs: now - 8 * DAY, isLink: false },
            { name: 'new-1018-0900.md', kind: 'file' as const, size: 1, mtimeMs: now - 2 * DAY, isLink: false },
          ]
        : [],
  }))
  on('fs.read', () => ({ value: '' }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: ok }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/Users/test' }))

  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  const moved = runs.filter(r => r[0] === 'mv').map(r => r[1])
  expect(moved).toEqual([`${DIR}/sent/old-1001-0900.md`])
})

test('on the phone, a saved draft shows as a card under its Write row', async ($, on) => {
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/Users/test' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start({ cwd: '/Users/test', surface: 'mobile', isInteractive: true })

  const RAW = '---\npost_in: [DM with Jose](https://x.test/team/U1)\n---\nPR #946 is merged.'
  const row = (file_path: string) => ({
    component: 'ToolUse' as const,
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Write', input: { file_path, content: RAW }, isRunning: false, isErrored: false, isInterrupted: false },
  })
  const phone = await $.ui.mount({ plugin: 'claudio', surface: 'mobile', ...row(`${DIR}/jose-1113-1122.md`) })
  expect(await phone.find({ type: 'Text', text: 'Slack draft for jose' })).toBeDefined()
  expect(await phone.find({ key: 'engine' })).toBeDefined()
  await phone.unmount()

  // the desktop already shows the file; and a write elsewhere is left alone on the phone too
  const desk = await $.ui.mount({ plugin: 'claudio', surface: 'desktop', ...row(`${DIR}/jose-1113-1122.md`) })
  expect(await desk.find({ type: 'Text', text: 'Slack draft for jose' })).toBeUndefined()
  await desk.unmount()
  const other = await $.ui.mount({ plugin: 'claudio', surface: 'mobile', ...row('/Users/test/notes.md') })
  expect(await other.find({ type: 'Text', text: 'Slack draft for jose' })).toBeUndefined()
  await other.unmount()
})

test('/slack-drafts opens the pane and says how many drafts it holds', async ($, on) => {
  const opened: unknown[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', ($, e) => ({ value: e.path === DIR ? [{ name: 'jose-1113-1122.md', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false }] : [] }))
  on('fs.read', () => ({ value: DRAFT }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/Users/test' }))

  await $.session.start({ cwd: '/Users/test', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'slack-drafts', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(JSON.stringify(r)).toContain('1 draft in the pane')
  expect(opened).toEqual(['slack-drafts'])
})
