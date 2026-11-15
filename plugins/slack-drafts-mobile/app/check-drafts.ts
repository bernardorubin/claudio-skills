// node --test plugins/slack-drafts-mobile/app/check-drafts.ts (Node 22.18+; 22.6 to 22.17 need --experimental-strip-types)
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { act, authorized, b64u, derToRaw, merge, POST, type Row } from './api/drafts.ts'

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
      : cmd === 'DEL' ? ([...kv.keys()].filter(k => k === key || k.startsWith(`${key}.`)).forEach(k => kv.delete(k)), 1)
      : cmd === 'HSET' ? (kv.set(`${key}.${val}`, String(rest[0])), 1)
      : cmd === 'HGET' ? (kv.get(`${key}.${val}`) ?? null)
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

// A passkey made with Web Crypto, signing the way a browser does: DER signature over authenticatorData || SHA-256(clientDataJSON).
const rawToDer = (raw: Uint8Array) => {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    const v = b.subarray(i)
    return (v[0] ?? 0) & 0x80 ? [0x02, v.length + 1, 0, ...v] : [0x02, v.length, ...v]
  }
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))]
  return new Uint8Array([0x30, body.length, ...body])
}
const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b))
const makePasskey = async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spki = b64u.encode(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)))
  const sign = async (challenge: string, { origin = 'https://x.test', flags = 0x05 } = {}) => {
    const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }))
    const auth = new Uint8Array([...(await sha(new TextEncoder().encode('x.test'))), flags, 0, 0, 0, 1])
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new Uint8Array([...auth, ...(await sha(clientData))])))
    return { clientDataJSON: b64u.encode(clientData), authenticatorData: b64u.encode(auth), signature: b64u.encode(rawToDer(sig)) }
  }
  return { spki, sign }
}
const call = (action: string, body?: unknown, signedIn = false) =>
  POST(new Request(`https://x.test/api/drafts?action=${action}`, { method: 'POST', headers: signedIn ? { authorization: 'Bearer secret' } : {}, body: body === undefined ? undefined : JSON.stringify(body) }))
const challenge = async () => ((await (await call('passkey-challenge', {})).json()) as { challenge: string }).challenge

test('a DER signature with padded or short integers comes out as 64 raw bytes', () => {
  const raw = new Uint8Array(64).map((_, i) => (i === 0 ? 0 : i === 32 ? 0x80 : i))
  assert.deepEqual(derToRaw(rawToDer(raw)), raw)
})

test('a passkey a signed-in device added signs a browser in, once per challenge, and only on this page', async () => {
  fakeRedis()
  const key = await makePasskey()
  assert.equal((await call('passkey-add', { id: 'k1', spki: key.spki, alg: -7 })).status, 401)
  assert.equal((await call('passkey-add', { id: 'k1', spki: 'bm90IGEga2V5', alg: -7 }, true)).status, 400)
  assert.equal((await call('passkey-add', { id: 'k1', spki: key.spki, alg: -7 }, true)).status, 200)

  const c = await challenge()
  const good = await key.sign(c)
  const ok = await call('passkey-signin', { id: 'k1', ...good })
  assert.equal(((await ok.json()) as { token?: string }).token, 'secret')
  assert.equal((await call('passkey-signin', { id: 'k1', ...good })).status, 403) // the challenge is spent
  assert.equal((await call('passkey-signin', { id: 'k1', ...(await key.sign(await challenge(), { origin: 'https://evil.test' })) })).status, 403)
  assert.equal((await call('passkey-signin', { id: 'k1', ...(await key.sign(await challenge(), { flags: 0x01 })) })).status, 403) // no Face ID
  assert.equal((await call('passkey-signin', { id: 'k2', ...(await key.sign(await challenge())) })).status, 403)
  assert.equal((await call('passkey-signin', { id: 'k1', ...(await (await makePasskey()).sign(await challenge())) })).status, 403) // another key

  await pairStart() // the owner's code request clears the tries the failures used
  assert.equal((await call('passkeys-forget', {}, true)).status, 200)
  assert.equal((await call('passkey-signin', { id: 'k1', ...(await key.sign(await challenge())) })).status, 403)
})
