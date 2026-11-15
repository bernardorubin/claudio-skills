// The whole backend of the phone page: the Mac's mod saves and cleans up drafts,
// the page reads them and records Sent and delete taps for the mod to act on, and a browser
// signs in with the owner's GitHub account or a six-digit code from the Mac.
// Storage is one Upstash Redis hash (`drafts`: file name -> Row) plus short-lived sign-in keys, over its REST API.
// No Node types needed: Web Crypto and TextEncoder are globals in Vercel's runtime, and this is all of process it reads.
declare const process: { env: Record<string, string | undefined> }

export type Row = { name: string; md: string; savedAt: number; state: 'open' | 'sent' | 'deleted'; actedAt: number }

const KEY = 'drafts'
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.md$/
const MAX_MD = 64_000
const PAIR_SECONDS = 300
const PAIR_TRIES = 10
const GITHUB_STATE_MS = 10 * 60_000
const HANDOFF_SECONDS = 60

const bytes = new TextEncoder()

// Compares in constant time, so the response time says nothing about how much of a guess was right.
const same = (a: string, b: string) => {
  const given = bytes.encode(a)
  const want = bytes.encode(b)
  if (given.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= (given[i] ?? 0) ^ (want[i] ?? 0)
  return diff === 0
}

export const authorized = (header: string | null, token: string | undefined) =>
  !!token && !!header?.startsWith('Bearer ') && same(header.slice(7), token)

// A save from the Mac. It never reopens a draft the phone acted on, unless the Mac saved it again after the tap.
export const merge = (old: Row | undefined, name: string, md: string, savedAt: number): Row | null =>
  old && old.state !== 'open' && savedAt <= old.actedAt ? null : { name, md, savedAt, state: 'open', actedAt: 0 }

// A tap on the phone; the Mac's mod moves the file when it next reads the list.
export const act = (old: Row | undefined, action: string, now: number): Row | null =>
  old && (action === 'sent' || action === 'delete') ? { ...old, state: action === 'sent' ? 'sent' : 'deleted', actedAt: now } : null

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

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } })

// ── GitHub sign-in: only the GitHub account GITHUB_USER_ID (its numeric id, which a rename can't take) gets in ──

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const hmac = async (text: string) => {
  const key = await crypto.subtle.importKey('raw', bytes.encode(process.env.GITHUB_CLIENT_SECRET ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.encode(text))))
}

// The OAuth state is its own proof: when it was made, signed with the app's secret, so the round trip needs no store.
export const makeState = async (now: number) => `${now}.${await hmac(String(now))}`
export const stateOk = async (state: string, now: number) => {
  const [at = '', sig = ''] = state.split('.')
  const made = Number(at)
  return Number.isFinite(made) && now - made >= 0 && now - made < GITHUB_STATE_MS && same(sig, await hmac(at))
}

// GitHub's callback is /api/github, rewritten here by vercel.json. Without ?code it starts the sign-in; with one
// it finishes it. The page gets a one-time handoff in the URL fragment, never the token itself.
const github = async (req: Request) => {
  const url = new URL(req.url)
  const fail = (why: string) => redirect(`/#signin-error=${why}`)
  const client = process.env.GITHUB_CLIENT_ID
  const secret = process.env.GITHUB_CLIENT_SECRET
  const owner = process.env.GITHUB_USER_ID
  if (!client || !secret || !owner) return fail('not-set-up')
  if (url.searchParams.get('error')) return fail('cancelled')
  const now = Date.now()
  const code = url.searchParams.get('code')
  if (!code) return redirect(`https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: client, state: await makeState(now), allow_signup: 'false' })}`)
  if (!(await stateOk(url.searchParams.get('state') ?? '', now))) return fail('expired')
  const traded = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: client, client_secret: secret, code }),
  })
  const { access_token } = (await traded.json().catch(() => ({}))) as { access_token?: unknown }
  if (typeof access_token !== 'string') return fail('github')
  const user = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'slack-drafts-mobile' },
  })
  if (!user.ok) return fail('github')
  const { id } = (await user.json().catch(() => ({}))) as { id?: unknown }
  if (String(id) !== owner) return fail('not-allowed')
  const once = b64u(crypto.getRandomValues(new Uint8Array(32)))
  await redis('SET', `signin:${once}`, '1', 'EX', HANDOFF_SECONDS)
  return redirect(`/#signin=${once}`)
}

const rowOf = (raw: unknown): Row | undefined => {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw) as Row
  } catch {
    return undefined
  }
}

const nameOf = (req: Request) => {
  const name = new URL(req.url).searchParams.get('name') ?? ''
  return NAME.test(name) ? name : null
}

// Every route but the sign-in ones (GitHub, pair, signin) needs the token, so a page or mod without it learns nothing.
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
    const url = new URL(req.url)
    // a GitHub or store failure mid-redirect lands back on the page with a message, not raw JSON
    if (url.searchParams.get('action') === 'github' || url.pathname === '/api/github')
      return github(req).catch(() => redirect('/#signin-error=github'))
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

// ?action=sent|delete&name= (a tap), ?action=pair-start (the setup skill asks for a code), and two
// unauthenticated sign-ins: ?action=pair with { code } (trades the Mac's code for the token) and
// ?action=signin with { once } (trades GitHub's one-time handoff for it).
export function POST(req: Request) {
  return handle(req, async () => {
    const action = new URL(req.url).searchParams.get('action') ?? ''
    if (action === 'signin') {
      const body = (await req.json().catch(() => null)) as { once?: unknown } | null
      const once = typeof body?.once === 'string' && /^[\w-]{43}$/.test(body.once) ? body.once : ''
      if (!once || (await redis('GETDEL', `signin:${once}`)) !== '1') return json({ error: 'that sign-in expired; sign in with GitHub again' }, 403)
      return json({ token: process.env.DRAFTS_TOKEN })
    }
    if (action === 'pair') {
      // the window is made before counting, so a failed call can't leave a counter that never expires
      await redis('SET', 'pairtries', 0, 'EX', PAIR_SECONDS, 'NX')
      const tries = Number(await redis('INCR', 'pairtries'))
      if (tries > PAIR_TRIES) return json({ error: 'too many tries; wait five minutes' }, 429)
      const body = (await req.json().catch(() => null)) as { code?: unknown } | null
      const code = String(body?.code ?? '').replace(/\D/g, '')
      if (code.length !== 6 || (await redis('GETDEL', `pair:${code}`)) !== '1') return json({ error: 'wrong or expired code' }, 403)
      return json({ token: process.env.DRAFTS_TOKEN })
    }
    const denied = guard(req)
    if (denied) return denied
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
