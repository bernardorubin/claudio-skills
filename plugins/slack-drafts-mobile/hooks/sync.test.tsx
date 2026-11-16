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
type Opts = {
  linked?: boolean
  token?: () => string
  files?: () => { name: string; mtimeMs: number }[]
  listFails?: boolean
  mvFails?: boolean
  reply?: (c: Call) => { status: number; text: string }
  tool?: (input: Record<string, unknown>) => { text: string; isError?: boolean }
}
const setup = (on: On, opts: Opts) => {
  const runs: string[][] = []
  const calls: Call[] = []
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', ($, e) => {
    if (opts.listFails) throw new Error('EACCES: permission denied')
    return {
    value: e.path === DIR ? (opts.files?.() ?? []).map(f => ({ ...f, kind: 'file' as const, size: DRAFT.length, isLink: false })) : [],
  }
  })
  on('fs.read', () => ({ value: DRAFT }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'security') {
      if (opts.linked === false) return { value: { ...ok, exitCode: 44, stderr: 'could not be found' } }
      return { value: { ...ok, stdout: e.argv.includes('url') ? `${URL}\n` : `${opts.token?.() ?? 'tok'}\n` } }
    }
    runs.push([...e.argv])
    if (opts.mvFails && e.argv[0] === 'mv') return { value: { ...ok, exitCode: 1, stderr: 'mv: Operation not permitted' } }
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
  const tools: Record<string, unknown>[] = []
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    tools.push(input)
    const r = opts.tool?.(input) ?? { text: '' }
    return r.isError ? { result: {}, isError: true as const, text: r.text } : { result: {}, text: r.text }
  })
  on('session.start', () => ({ cwd: '/Users/test' }))
  return { runs, calls, toasts, tools }
}

const SESSION = { cwd: '/Users/test', surface: 'desktop', isInteractive: true } as const
const VERCEL = { options: { page: 'vercel' } } as const

test('vercel: not set up: one nudge, no requests, and no keychain item read as a link', VERCEL, async ($, on) => {
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

test('vercel: a new draft is pushed once with the token, and a removed one is deleted from the page', VERCEL, async ($, on) => {
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

test('vercel: Sent on the phone moves the file into sent/, deletes it from the page and toasts', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on, { pushed: { [NAME]: 100 } })
  const { runs, calls, toasts } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }],
    reply: c => ({ status: 200, text: c.method === 'GET' ? JSON.stringify({ drafts: [{ name: NAME, state: 'sent', actedAt: 500 }] }) : '{}' }),
  })
  await $.session.start(SESSION)
  await clock.advance(15_000)
  await clock.advance(1_000)
  expect(runs).toContainEqual(['mv', `${DIR}/${NAME}`, `${DIR}/sent/${NAME}`])
  expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith(`?name=${NAME}`))).toBe(true)
  expect(toasts).toContain('From the phone: 1 marked sent')
})

test('vercel: a delete on the phone goes to the Trash, but a draft saved again after the tap stays', VERCEL, async ($, on) => {
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
  await clock.advance(15_000)
  await clock.advance(1_000)
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${NAME}` && String(r[2]).startsWith('/Users/test/.Trash/'))).toBe(true)
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${EDITED}`)).toBe(false)
})

test('vercel: nothing pushed means no reads of the page', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { calls } = setup(on, { files: () => [] })
  await $.session.start(SESSION)
  await clock.advance(20_000)
  expect(calls.filter(c => c.method === 'GET')).toEqual([])
})

test('vercel: a refused token warns once and retries only after the next minute reads the keychain', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { calls, toasts } = setup(on, { files: () => [{ name: NAME, mtimeMs: 100 }], reply: () => ({ status: 401, text: '{"error":"unauthorized"}' }) })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(9_000)
  expect(calls.length).toBe(1)
  await clock.advance(60_000)
  expect(calls.length).toBe(2)
  expect(toasts.filter(t => t.includes('refused this Mac')).length).toBe(1)
})

test('vercel: a rotated token reaches a running session within a minute', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  let token = 'old'
  let files = [{ name: NAME, mtimeMs: 100 }]
  const { calls } = setup(on, { token: () => token, files: () => files })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  token = 'new'
  await clock.advance(60_000)
  files = [{ name: NAME, mtimeMs: 200 }]
  await clock.advance(3_000)
  const puts = calls.filter(c => c.method === 'PUT')
  expect(puts.map(c => c.auth)).toEqual(['Bearer old', 'Bearer new'])
})

test('vercel: a refused draft is pushed once, not every tick, and the toast names it', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { calls, toasts } = setup(on, { files: () => [{ name: NAME, mtimeMs: 100 }], reply: c => ({ status: c.method === 'PUT' ? 400 : 200, text: c.method === 'PUT' ? '{"error":"bad draft"}' : '{"drafts":[]}' }) })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(3_000)
  await clock.advance(3_000)
  expect(calls.filter(c => c.method === 'PUT').length).toBe(1)
  expect(toasts.some(t => t.includes(NAME) && t.includes('bad draft'))).toBe(true)
})

test('vercel: a move that fails keeps the row on the page and says so', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on, { pushed: { [NAME]: 100 } })
  const { calls, toasts } = setup(on, {
    mvFails: true,
    files: () => [{ name: NAME, mtimeMs: 100 }],
    reply: c => ({ status: 200, text: c.method === 'GET' ? JSON.stringify({ drafts: [{ name: NAME, state: 'sent', actedAt: 500 }] }) : '{}' }),
  })
  await $.session.start(SESSION)
  await clock.advance(15_000)
  await clock.advance(1_000)
  expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  expect(toasts.some(t => t.includes(`could not move ${NAME}`))).toBe(true)
})

test('vercel: an unreadable folder deletes nothing from the page', VERCEL, async ($, on) => {
  const clock = mock.clock(on)
  memStore(on, { pushed: { [NAME]: 100 } })
  const { calls } = setup(on, {
    listFails: true,
    reply: c => ({ status: 200, text: c.method === 'GET' ? JSON.stringify({ drafts: [{ name: NAME, state: 'sent', actedAt: 500 }] }) : '{}' }),
  })
  await $.session.start(SESSION)
  await clock.advance(15_000)
  expect(calls.some(c => c.method === 'DELETE')).toBe(false)
})

// ── the Artifact page (the default) ──

const DASH = String.fromCharCode(0x2014)
const PAGE = 'https://claude.ai/artifact/Pinned1'
const listing = (...lines: string[]) => [`${lines.length} published artifacts (most recently opened or updated first):`, ...lines].join('\n')
const LISTED = listing(
  `- (mine) Week Ending October 14 ${DASH} https://claude.ai/artifact/Other1 ${DASH} updated 2026-11-06`,
  `- (mine, pinned) Slack Drafts ${DASH} ${PAGE} ${DASH} updated 2026-11-05`,
)
const tomb = (name: string, savedAt: number, sent: boolean) =>
  `=== BEGIN ARTIFACT DB 1 ===\n${JSON.stringify({ id: `${name}-phone-${savedAt}`, data: { deleted: true, from: 'phone', name, savedAt, sent }, version: 1 })}\n=== END ARTIFACT DB 1 ===`
const dbCalls = (tools: Record<string, unknown>[]) => tools.filter(t => t.tool === 'ArtifactData')

test('artifact: a draft goes to the pinned Slack Drafts page as a new row, and a removed one as a tombstone', async ($, on) => {
  const clock = mock.clock(on)
  const store = memStore(on)
  let files = [{ name: NAME, mtimeMs: 100 }]
  const { tools } = setup(on, { files: () => files, tool: i => ({ text: i.tool === 'Artifact' ? LISTED : 'ok' }) })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(3_000)
  const batches = dbCalls(tools).filter(t => t.action === 'batch')
  expect(batches.length).toBe(1)
  expect(batches[0]?.url).toBe(PAGE)
  const [w] = batches[0]?.writes as { op: string; doc_id: string; data: unknown }[]
  expect(w?.op).toBe('set')
  expect(w?.doc_id.startsWith('jose-1114-2132-')).toBe(true)
  expect(w?.data).toEqual({ name: NAME, md: DRAFT, savedAt: 100 })
  expect(store.get('artifactSynced')).toEqual({ [PAGE]: { [NAME]: 100 } })

  files = []
  await clock.advance(3_000)
  const last = dbCalls(tools).filter(t => t.action === 'batch').at(-1)?.writes as { data: Record<string, unknown> }[]
  expect(last[0]?.data.name).toBe(NAME)
  expect(last[0]?.data.deleted).toBe(true)
  expect(store.get('artifactSynced')).toEqual({ [PAGE]: {} })
})

test('artifact: Sent on the phone moves the file into sent/, but a draft saved again after the tap stays', async ($, on) => {
  const clock = mock.clock(on)
  const EDITED = 'nick-1114-2140.md'
  memStore(on, { artifactSynced: { [PAGE]: { [NAME]: 100, [EDITED]: 900 } } })
  const { runs, toasts } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }, { name: EDITED, mtimeMs: 900 }],
    tool: i => ({ text: i.tool === 'Artifact' ? LISTED : i.action === 'query' ? [tomb(NAME, 500, true), tomb(EDITED, 500, false)].join('\n') : 'ok' }),
  })
  await $.session.start(SESSION)
  await clock.advance(30_000)
  await clock.advance(1_000)
  expect(runs).toContainEqual(['mv', `${DIR}/${NAME}`, `${DIR}/sent/${NAME}`])
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${EDITED}`)).toBe(false)
  expect(toasts).toContain('From the phone: 1 marked sent')
})

test('artifact: a delete on the phone moves the file to the Trash', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on, { artifactSynced: { [PAGE]: { [NAME]: 100 } } })
  const { runs } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }],
    tool: i => ({ text: i.tool === 'Artifact' ? LISTED : i.action === 'query' ? tomb(NAME, 500, false) : 'ok' }),
  })
  await $.session.start(SESSION)
  await clock.advance(31_000)
  expect(runs.some(r => r[0] === 'mv' && r[1] === `${DIR}/${NAME}` && String(r[2]).startsWith('/Users/test/.Trash/'))).toBe(true)
})

test('artifact: no Slack Drafts page in the account means no database calls and one nudge', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const { tools, toasts } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }],
    tool: () => ({ text: listing(`- (mine) Week Ending October 14 ${DASH} https://claude.ai/artifact/Other1 ${DASH} updated 2026-11-06`) }),
  })
  await $.session.start(SESSION)
  await clock.advance(40_000)
  expect(dbCalls(tools)).toEqual([])
  expect(toasts).toEqual(['slack-drafts-mobile: run /slack-drafts-mobile to put your Slack drafts on your phone'])
})

test("artifact: a session that can't list Artifacts keeps the drafts on the Mac and says so once", async ($, on) => {
  const clock = mock.clock(on)
  const store = memStore(on)
  const { tools, toasts } = setup(on, { files: () => [{ name: NAME, mtimeMs: 100 }], tool: () => ({ isError: true, text: 'Artifacts are turned off for this organization' }) })
  await $.session.start(SESSION)
  await clock.advance(10 * 60_000)
  expect(dbCalls(tools)).toEqual([])
  expect(toasts.filter(t => t.includes("can't list your Artifacts")).length).toBe(1)
  expect(store.get('nudged')).toBe(undefined)
})

test('artifact: a page that no longer opens is looked up again, and the drafts go to the one found', async ($, on) => {
  const clock = mock.clock(on)
  memStore(on)
  const NEW = 'https://claude.ai/artifact/Pinned2'
  let listed = LISTED
  const { tools } = setup(on, {
    files: () => [{ name: NAME, mtimeMs: 100 }],
    tool: i => {
      if (i.tool === 'Artifact') return { text: listed }
      if (i.url === PAGE) {
        listed = listing(`- (mine, pinned) Slack Drafts ${DASH} ${NEW} ${DASH} updated 2026-11-15`)
        return { isError: true, text: 'No such artifact, or you cannot open it' }
      }
      return { text: 'ok' }
    },
  })
  await $.session.start(SESSION)
  await clock.advance(3_000)
  await clock.advance(3_000)
  expect(dbCalls(tools).map(t => t.url)).toEqual([PAGE, NEW])
})
