import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const DIR = '/Users/test/Desktop/slack-drafts'
const URL = 'https://drafts-test.vercel.app'
const NAME = 'jose-1114-2132.md'
const DRAFT = 'Review is done on [PR #950](https://example.com/950), merge when ready.'
const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

type Call = { url: string; method: string; body?: string; auth?: string }

// `$.store` in memory, readable by the test.
const memStore = (on: On, entries: Record<string, unknown> = {}) => {
  const m = new Map<string, unknown>(Object.entries(entries))
  on('store.get', ($, e) => ({ value: m.get(e.key) }))
  on('store.set', ($, e) => {
    m.set(e.key, e.value)
    return { value: undefined }
  })
  return m
}

// A Mac with the keychain item (or without it), one drafts folder and a page that answers `reply`.
const setup = (on: On, opts: { linked?: boolean; files?: () => { name: string; mtimeMs: number }[]; reply?: (c: Call) => { status: number; text: string } }) => {
  const runs: string[][] = []
  const calls: Call[] = []
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', ($, e) => ({
    value: e.path === DIR ? (opts.files?.() ?? []).map(f => ({ ...f, kind: 'file' as const, size: DRAFT.length, isLink: false })) : [],
  }))
  on('fs.read', () => ({ value: DRAFT }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'security') {
      if (opts.linked === false) return { value: { ...ok, exitCode: 44, stderr: 'could not be found' } }
      return { value: { ...ok, stdout: e.argv.includes('url') ? `${URL}\n` : 'tok\n' } }
    }
    runs.push([...e.argv])
    return { value: ok }
  })
  on('http.fetch', ($, e) => {
    const c: Call = { url: e.url, method: e.init?.method ?? 'GET', body: typeof e.init?.body === 'string' ? e.init.body : undefined, auth: e.init?.headers?.Authorization }
    calls.push(c)
    const { status, text } = opts.reply?.(c) ?? { status: 200, text: '{}' }
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/Users/test' }))
  return { runs, calls, toasts }
}

const SESSION = { cwd: '/Users/test', surface: 'desktop', isInteractive: true } as const

test('not set up: one nudge, no requests, and no keychain item read as a link', async ($, on) => {
  const clock = mock.clock(on)
  const store = memStore(on)
  const { calls, toasts } = setup(on, { linked: false, files: () => [{ name: NAME, mtimeMs: 1 }] })
  await $.session.start(SESSION)
  await clock.advance(10_000)
  expect(calls).toEqual([])
  expect(toasts).toEqual(['slack-drafts-mobile: run /slack-drafts-mobile to put your Slack drafts on your phone'])
  expect(store.get('nudged')).toBe(true)
  // a second session stays quiet
  await $.session.start(SESSION)
  expect(toasts.length).toBe(1)
})

test('a new draft is pushed once with the token, and a removed one is deleted from the page', async ($, on) => {
  const clock = mock.clock(on)
  const store = memStore(on)
  let files = [{ name: NAME, mtimeMs: 100 }]
  const { calls } = setup(on, { files: () => files, reply: c => ({ status: 200, text: c.method === 'GET' ? '{"drafts":[]}' : '{}' }) })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(3_000)
  const puts = calls.filter(c => c.method === 'PUT')
  expect(puts.length).toBe(1)
  expect(puts[0]?.url).toBe(`${URL}/api/drafts?name=${NAME}`)
  expect(puts[0]?.auth).toBe('Bearer tok')
  expect(JSON.parse(puts[0]?.body ?? '{}')).toEqual({ md: DRAFT, savedAt: 100 })
  expect(store.get('pushed')).toEqual({ [NAME]: 100 })

  files = []
  await clock.advance(3_000)
  expect(calls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual([`${URL}/api/drafts?name=${NAME}`])
  expect(store.get('pushed')).toEqual({})
})

test('Sent on the phone moves the file into sent/, deletes it from the page and toasts', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on, { pushed: { [NAME]: 100 } })
  const { runs, calls, toasts } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }],
    reply: c => ({ status: 200, text: c.method === 'GET' ? JSON.stringify({ drafts: [{ name: NAME, state: 'sent', actedAt: 500 }] }) : '{}' }),
  })
  await $.session.start(SESSION)
  await clock.advance(5_000)
  await clock.advance(1_000)
  expect(runs).toContainEqual(['mv', `${DIR}/${NAME}`, `${DIR}/sent/${NAME}`])
  expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith(`?name=${NAME}`))).toBe(true)
  expect(toasts).toContain('From the phone: 1 marked sent')
})

test('a delete on the phone goes to the Trash, but a draft saved again after the tap stays', async ($, on) => {
  const clock = mock.clock(on)
  const EDITED = 'nick-1114-2140.md'
  memStore(on, { pushed: { [NAME]: 100, [EDITED]: 900 } })
  const { runs } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }, { name: EDITED, mtimeMs: 900 }],
    reply: c => ({
      status: 200,
      text: c.method === 'GET' ? JSON.stringify({ drafts: [{ name: NAME, state: 'deleted', actedAt: 500 }, { name: EDITED, state: 'deleted', actedAt: 500 }] }) : '{}',
    }),
  })
  await $.session.start(SESSION)
  await clock.advance(5_000)
  await clock.advance(1_000)
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${NAME}` && String(r[2]).startsWith('/Users/test/.Trash/'))).toBe(true)
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${EDITED}`)).toBe(false)
})

test('nothing pushed means no reads of the page', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { calls } = setup(on, { files: () => [] })
  await $.session.start(SESSION)
  await clock.advance(20_000)
  expect(calls.filter(c => c.method === 'GET')).toEqual([])
})

test('a refused token warns once and stops until the keychain changes', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { calls, toasts } = setup(on, { files: () => [{ name: NAME, mtimeMs: 100 }], reply: () => ({ status: 401, text: '{"error":"unauthorized"}' }) })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(9_000)
  expect(calls.length).toBe(1)
  expect(toasts.filter(t => t.includes('refused this Mac')).length).toBe(1)
})
