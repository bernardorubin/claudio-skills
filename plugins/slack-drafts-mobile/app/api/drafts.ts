// The whole backend of the phone page: the Mac's mod saves and cleans up drafts,
// the page reads them and records Sent and delete taps for the mod to act on.
// Storage is one Upstash Redis hash (`drafts`: file name -> Row), over its REST API.
// No Node types needed: Web Crypto and TextEncoder are globals in Vercel's runtime, and this is all of process it reads.
declare const process: { env: Record<string, string | undefined> }

export type Row = { name: string; md: string; savedAt: number; state: 'open' | 'sent' | 'deleted'; actedAt: number }

const KEY = 'drafts'
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.md$/
const MAX_MD = 64_000
const PAIR_SECONDS = 300
const PAIR_TRIES = 10

const PASSKEYS = 'passkeys'
// ES256 (what Apple and Google passkeys use) and RS256 (Windows Hello)
const ALGS = [-7, -257]

const bytes = new TextEncoder()

// Compares in constant time, so the response time says nothing about how much of a guess was right.
export const authorized = (header: string | null, token: string | undefined) => {
  if (!token || !header?.startsWith('Bearer ')) return false
  const given = bytes.encode(header.slice(7))
  const want = bytes.encode(token)
  if (given.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= (given[i] ?? 0) ^ (want[i] ?? 0)
  return diff === 0
}

// A save from the Mac. It never reopens a draft the phone acted on, unless the Mac saved it again after the tap.
export const merge = (old: Row | undefined, name: string, md: string, savedAt: number): Row | null =>
  old && old.state !== 'open' && savedAt <= old.actedAt ? null : { name, md, savedAt, state: 'open', actedAt: 0 }

// A tap on the phone; the Mac's mod moves the file when it next reads the list.
export const act = (old: Row | undefined, action: string, now: number): Row | null =>
  old && (action === 'sent' || action === 'delete') ? { ...old, state: action === 'sent' ? 'sent' : 'deleted', actedAt: now } : null

// ── passkeys: Face ID or Touch ID sign-in for any browser, once a signed-in device adds one ──

export type Passkey = { spki: string; alg: number }
export type Assertion = { clientDataJSON: string; authenticatorData: string; signature: string }

export const b64u = {
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)),
  encode: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
}
const sha256 = async (b: BufferSource) => new Uint8Array(await crypto.subtle.digest('SHA-256', b))

// A passkey signs ECDSA as DER; Web Crypto checks the raw r||s form.
export const derToRaw = (der: Uint8Array) => {
  const out = new Uint8Array(64)
  let i = 2 // past 0x30 and the length, one byte for any P-256 signature
  for (const at of [0, 32]) {
    const len = der[i + 1] ?? 0
    let part = der.subarray(i + 2, i + 2 + len)
    while (part.length > 32 && part[0] === 0) part = part.subarray(1)
    out.set(part, at + 32 - part.length)
    i += 2 + len
  }
  return out
}

const importKey = (key: Passkey) =>
  crypto.subtle.importKey(
    'spki',
    b64u.decode(key.spki),
    key.alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

// True when the browser at `origin` signed `challenge` with this passkey after Face ID, Touch ID or the device passcode.
export const verifyAssertion = async (key: Passkey, origin: string, challenge: string, a: Assertion) => {
  const clientBytes = b64u.decode(a.clientDataJSON)
  const client = JSON.parse(new TextDecoder().decode(clientBytes)) as { type?: unknown; challenge?: unknown; origin?: unknown }
  if (client.type !== 'webauthn.get' || client.challenge !== challenge || client.origin !== origin) return false
  const auth = b64u.decode(a.authenticatorData)
  const rpHash = await sha256(bytes.encode(new URL(origin).hostname))
  if (auth.length < 37 || rpHash.some((b, i) => auth[i] !== b)) return false
  // flags: user present (0x01) and user verified (0x04)
  if (((auth[32] ?? 0) & 0x05) !== 0x05) return false
  const data = new Uint8Array([...auth, ...(await sha256(clientBytes))])
  const sig = b64u.decode(a.signature)
  const algo = key.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }
  return crypto.subtle.verify(algo, await importKey(key), key.alg === -7 ? derToRaw(sig) : sig, data)
}

const redis = async (...command: (string | number)[]): Promise<unknown> => {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new Error('no Redis store is connected to this project')
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command) })
  const body = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string }
  if (!r.ok || body.error) throw new Error(body.error ?? `Redis answered ${r.status}`)
  return body.result
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const rowOf = <T = Row,>(raw: unknown): T | undefined => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

const nameOf = (req: Request) => {
  const name = new URL(req.url).searchParams.get('name') ?? ''
  return NAME.test(name) ? name : null
}

// Every route but pairing needs the token, so a page or mod without it learns nothing.
const guard = (req: Request) =>
  authorized(req.headers.get('authorization'), process.env.DRAFTS_TOKEN) ? null : json({ error: 'unauthorized' }, 401)

const handle = async (req: Request, run: () => Promise<Response>) => {
  try {
    return await run()
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
}

export function GET(req: Request) {
  return handle(req, async () => {
    const denied = guard(req)
    if (denied) return denied
    const flat = ((await redis('HGETALL', KEY)) ?? []) as string[]
    const rows: Row[] = []
    for (let i = 1; i < flat.length; i += 2) {
      const row = rowOf(flat[i])
      if (row) rows.push(row)
    }
    return json({ drafts: rows })
  })
}

// A save from the Mac: { md, savedAt }.
export function PUT(req: Request) {
  return handle(req, async () => {
    const denied = guard(req)
    if (denied) return denied
    const name = nameOf(req)
    const body = (await req.json().catch(() => null)) as { md?: unknown; savedAt?: unknown } | null
    if (!name || typeof body?.md !== 'string' || typeof body.savedAt !== 'number' || body.md.length > MAX_MD)
      return json({ error: 'bad draft' }, 400)
    // shortcut: read then write, so a tap landing between the two is overwritten; a Lua script if that ever bites
    const next = merge(rowOf(await redis('HGET', KEY, name)), name, body.md, body.savedAt)
    if (!next) return json({ kept: 'acted' })
    await redis('HSET', KEY, name, JSON.stringify(next))
    return json({ saved: name })
  })
}

// The Mac removing a draft: gone from its folder, or acted on after a tap.
export function DELETE(req: Request) {
  return handle(req, async () => {
    const denied = guard(req)
    if (denied) return denied
    const name = nameOf(req)
    if (!name) return json({ error: 'bad name' }, 400)
    await redis('HDEL', KEY, name)
    return json({ removed: name })
  })
}

// A code try or a passkey challenge counts, PAIR_TRIES per five minutes; a passkey answer needs an
// unspent challenge, so it is capped by them. The window is made before counting, so a failed call
// can't leave a counter that never expires.
const tooMany = async () => {
  await redis('SET', 'pairtries', 0, 'EX', PAIR_SECONDS, 'NX')
  return Number(await redis('INCR', 'pairtries')) > PAIR_TRIES
}

const str = (v: unknown, max = 4096) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

// ?action=sent|delete&name= (a tap), ?action=pair-start (the setup skill asks for a code),
// ?action=passkey-add with { id, spki, alg } and ?action=passkeys-forget (a signed-in device),
// and the three unauthenticated sign-in routes: ?action=pair with { code } (trades the code for the
// token), ?action=passkey-challenge and ?action=passkey-signin with the browser's assertion.
export function POST(req: Request) {
  return handle(req, async () => {
    const action = new URL(req.url).searchParams.get('action') ?? ''
    if (action === 'pair' || action === 'passkey-challenge' || action === 'passkey-signin') {
      if (action !== 'passkey-signin' && (await tooMany())) return json({ error: 'too many tries; wait five minutes' }, 429)
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (action === 'pair') {
        const code = String(body?.code ?? '').replace(/\D/g, '')
        if (code.length !== 6 || (await redis('GETDEL', `pair:${code}`)) !== '1') return json({ error: 'wrong or expired code' }, 403)
        return json({ token: process.env.DRAFTS_TOKEN })
      }
      if (action === 'passkey-challenge') {
        const challenge = b64u.encode(crypto.getRandomValues(new Uint8Array(32)))
        await redis('SET', `pkchal:${challenge}`, '1', 'EX', PAIR_SECONDS)
        return json({ challenge })
      }
      const id = str(body?.id, 512)
      const a = { clientDataJSON: str(body?.clientDataJSON), authenticatorData: str(body?.authenticatorData), signature: str(body?.signature) }
      if (!id || !a.clientDataJSON || !a.authenticatorData || !a.signature) return json({ error: 'bad sign-in' }, 400)
      const assertion = a as Assertion
      // the challenge the browser signed must be one this page handed out and not yet used
      const challenge = (() => {
        try {
          const c = (JSON.parse(new TextDecoder().decode(b64u.decode(assertion.clientDataJSON))) as { challenge?: unknown }).challenge
          return typeof c === 'string' && c.length <= 64 ? c : ''
        } catch {
          return ''
        }
      })()
      const key = rowOf<Passkey>(await redis('HGET', PASSKEYS, id))
      const fresh = challenge !== '' && (await redis('GETDEL', `pkchal:${challenge}`)) === '1'
      if (!key || !fresh || !(await verifyAssertion(key, new URL(req.url).origin, challenge, assertion).catch(() => false)))
        return json({ error: 'that passkey did not sign in' }, 403)
      return json({ token: process.env.DRAFTS_TOKEN })
    }
    const denied = guard(req)
    if (denied) return denied
    if (action === 'passkey-add') {
      const body = (await req.json().catch(() => null)) as { id?: unknown; spki?: unknown; alg?: unknown } | null
      const id = str(body?.id, 512)
      const spki = str(body?.spki)
      const alg = Number(body?.alg)
      if (!id || !spki || !ALGS.includes(alg)) return json({ error: 'bad passkey' }, 400)
      const ok = await importKey({ spki, alg }).then(() => true, () => false)
      if (!ok) return json({ error: 'bad passkey' }, 400)
      await redis('HSET', PASSKEYS, id, JSON.stringify({ spki, alg }))
      return json({ added: id })
    }
    if (action === 'passkeys-forget') {
      await redis('DEL', PASSKEYS)
      return json({ forgot: 'all passkeys' })
    }
    if (action === 'pair-start') {
      const code = String((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000).padStart(6, '0')
      await redis('SET', `pair:${code}`, '1', 'EX', PAIR_SECONDS)
      // the owner asking for a code clears tries someone else used up
      await redis('DEL', 'pairtries')
      return json({ code, expiresIn: PAIR_SECONDS })
    }
    const name = nameOf(req)
    if (!name) return json({ error: 'bad name' }, 400)
    const next = act(rowOf(await redis('HGET', KEY, name)), action, Date.now())
    if (!next) return json({ error: 'no such draft or action' }, 404)
    await redis('HSET', KEY, name, JSON.stringify(next))
    return json({ marked: next.state })
  })
}
