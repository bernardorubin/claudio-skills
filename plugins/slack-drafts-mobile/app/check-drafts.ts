// node --test plugins/slack-drafts-mobile/app/check-drafts.ts (Node 22.18+; 22.6 to 22.17 need --experimental-strip-types)
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { act, authorized, merge, POST, type Row } from './api/drafts.ts'

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

// A fake Upstash: the few commands pairing uses, over the same REST shape.
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
