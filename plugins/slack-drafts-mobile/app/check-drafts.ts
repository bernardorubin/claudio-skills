// node --test plugins/slack-drafts-mobile/app/check-drafts.ts (Node 22.18+; 22.6 to 22.17 need --experimental-strip-types)
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { act, authorized, GET, makeState, merge, POST, stateOk, type Row } from './api/drafts.ts'

const open: Row = { name: 'jose-1114-2132.md', md: 'hi', savedAt: 100, state: 'open', actedAt: 0 }

test('the token must match exactly', () => {
  assert.equal(authorized('Bearer abc', 'abc'), true)
  assert.equal(authorized('Bearer abd', 'abc'), false)
  assert.equal(authorized('Bearer ab', 'abc'), false)
  assert.equal(authorized('abc', 'abc'), false)
  assert.equal(authorized(null, 'abc'), false)
  assert.equal(authorized('Bearer ', undefined), false)
})

test('a save never reopens a draft the phone acted on, unless the Mac saved it again after the tap', () => {
  const sent = act(open, 'sent', 200)
  assert.equal(sent?.state, 'sent')
  assert.equal(merge(sent ?? undefined, open.name, 'hi', 150), null)
  assert.equal(merge(sent ?? undefined, open.name, 'hi', 200), null)
  assert.equal(merge(sent ?? undefined, open.name, 'edited', 250)?.state, 'open')
  assert.equal(merge(undefined, open.name, 'new', 1)?.md, 'new')
  assert.equal(merge(open, open.name, 'edited', 300)?.md, 'edited')
})

test('a tap needs a known draft and a known action', () => {
  assert.equal(act(open, 'delete', 5)?.state, 'deleted')
  assert.equal(act(undefined, 'sent', 5), null)
  assert.equal(act(open, 'archive', 5), null)
})

// A fake Upstash: the few commands the sign-ins use, over the same REST shape.
const fakeRedis = () => {
  const kv = new Map<string, string>()
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const [cmd, key, val, ...rest] = JSON.parse(String(init?.body)) as string[]
    const result =
      cmd === 'SET' ? (rest.includes('NX') && kv.has(key!) ? null : (kv.set(key!, String(val)), 'OK'))
      : cmd === 'INCR' ? (kv.set(key!, String(Number(kv.get(key!) ?? 0) + 1)), Number(kv.get(key!)))
      : cmd === 'GETDEL' ? (() => { const v = kv.get(key!) ?? null; kv.delete(key!); return v })()
      : cmd === 'DEL' ? Number(kv.delete(key!))
      : null
    return Response.json({ result })
  }) as typeof fetch
  Object.assign(process.env, { DRAFTS_TOKEN: 'secret', KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'kv' })
}

const pair = (code: string) =>
  POST(new Request('https://x.test/api/drafts?action=pair', { method: 'POST', body: JSON.stringify({ code }) }))
const pairStart = async () =>
  (await (await POST(new Request('https://x.test/api/drafts?action=pair-start', { method: 'POST', headers: { authorization: 'Bearer secret' } }))).json()) as { code: string }

test('a pairing code works once, tries are capped, and a new code clears the cap', async () => {
  fakeRedis()
  const { code } = await pairStart()
  assert.equal(((await (await pair(code)).json()) as { token?: string }).token, 'secret')
  assert.equal((await pair(code)).status, 403)
  for (let i = 0; i < 8; i++) await pair('000000')
  assert.equal((await pair('000000')).status, 429)
  const next = await pairStart()
  assert.equal((await pair(next.code)).status, 200)
  assert.equal((await POST(new Request('https://x.test/api/drafts?action=pair-start', { method: 'POST' }))).status, 401)
})

// GitHub's two endpoints, answering for the account `id`; everything else goes to the fake Upstash.
const fakeGithub = (id: number) => {
  const next = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) =>
    String(url) === 'https://github.com/login/oauth/access_token'
      ? Response.json({ access_token: 'gho_test' })
      : String(url) === 'https://api.github.com/user'
        ? Response.json({ id, login: 'someone' })
        : next(String(url), init)) as typeof fetch
  Object.assign(process.env, { GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'shh', GITHUB_USER_ID: '42' })
}
const get = (path: string) => GET(new Request(`https://x.test${path}`))
const trade = (once: string) => POST(new Request('https://x.test/api/drafts?action=signin', { method: 'POST', body: JSON.stringify({ once }) }))

test('the OAuth state is good for ten minutes and only with its signature', async () => {
  process.env.GITHUB_CLIENT_SECRET = 'shh'
  const state = await makeState(1_000)
  assert.equal(await stateOk(state, 1_000 + 9 * 60_000), true)
  assert.equal(await stateOk(state, 1_000 + 11 * 60_000), false)
  assert.equal(await stateOk(state, 999), false)
  assert.equal(await stateOk(state.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), 1_000), false)
  assert.equal(await stateOk('1000', 1_000), false)
})

test('GitHub sign-in gives the owner a one-time handoff for the token and turns anyone else away', async () => {
  fakeRedis()
  fakeGithub(42)
  const start = await get('/api/github')
  assert.equal(start.status, 302)
  const to = new URL(start.headers.get('location') ?? '')
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(to.searchParams.get('client_id'), 'client')
  assert.equal((await get('/api/drafts?action=github')).status, 302) // the rewritten path lands here too
  const state = encodeURIComponent(to.searchParams.get('state') ?? '')

  const back = await get(`/api/github?code=c1&state=${state}`)
  const once = /^\/#signin=([\w-]+)$/.exec(back.headers.get('location') ?? '')?.[1] ?? ''
  assert.equal(once.length, 43)
  assert.equal(((await (await trade(once)).json()) as { token?: string }).token, 'secret')
  assert.equal((await trade(once)).status, 403) // spent
  assert.equal((await trade('x'.repeat(43))).status, 403)

  assert.equal((await get('/api/github?code=c1&state=1.forged')).headers.get('location'), '/#signin-error=expired')
  assert.equal((await get('/api/github?error=access_denied')).headers.get('location'), '/#signin-error=cancelled')
  fakeGithub(7) // someone else's GitHub account
  assert.equal((await get(`/api/github?code=c2&state=${state}`)).headers.get('location'), '/#signin-error=not-allowed')
  delete process.env.GITHUB_CLIENT_ID
  assert.equal((await get('/api/github')).headers.get('location'), '/#signin-error=not-set-up')
})
