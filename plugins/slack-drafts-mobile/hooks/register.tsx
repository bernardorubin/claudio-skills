import type { EngineInterface, HttpResponse, Register } from 'claude-code'

// Syncs ~/Desktop/slack-drafts (the folder /write-slack-message saves to) with a phone
// page, one of two the user picks in /slack-drafts-mobile (the `page` option):
// - artifact (the default): their own pinned "Slack Drafts" Artifact, found by listing in
//   every session and never stored, so each claude.ai account finds its own page or none;
// - vercel: a page on their own Vercel deployment, over plain HTTPS, so it works in every
//   session whatever Claude tools it has. Its link and token live in the macOS keychain.
// Neither page reaches the Mac: a tap there only marks the draft, and this mod moves the
// file when it next reads the page.

const SERVICE = 'claudio-slack-drafts-mobile'
const PUSH_MS = 3_000
// 15 s keeps an always-on Mac to about 173K Upstash commands a month; the free plan allows 500K
const PULL_MS = 15_000
const LINK_MS = 60_000

type File = { name: string; path: string; mtimeMs: number }
type Link = { url: string; token: string }
type Row = { name: string; state: 'open' | 'sent' | 'deleted'; actedAt: number }

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''
const dirOf = async ($: EngineInterface) =>
  (await $.env.get('SLACK_DRAFTS_DIR')) ?? `${await home($)}/Desktop/slack-drafts`

const secret = async ($: EngineInterface, account: 'url' | 'token') => {
  const r = await $.process.run(['security', 'find-generic-password', '-s', SERVICE, '-a', account, '-w']).catch(() => null)
  return r?.exitCode === 0 ? r.stdout.trim() : ''
}

const readLink = async ($: EngineInterface, s: Sync): Promise<Link | null> => {
  const [raw, token] = await Promise.all([secret($, 'url'), secret($, 'token')])
  const url = raw.replace(/\/+$/, '')
  if (/^https:\/\/[^\s/]+$/.test(url) && token !== '') return { url, token }
  if (raw !== '' || token !== '') warn($, s, 'the keychain holds half a link or a URL that is not https://. Run /slack-drafts-mobile.')
  return null
}

// null when the folder can't be read: a tick then skips, rather than reading it as empty and deleting every row on the page
const listFiles = async ($: EngineInterface): Promise<File[] | null> => {
  const dir = await dirOf($)
  const entries = await $.fs.list(dir).catch(() => null)
  if (entries === null) return null
  return entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    .map(f => ({ name: f.name, path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs }))
}

// ponytail: moved to ~/.Trash, not unlinked, so a misclick on the phone is recoverable from Finder
const moveToTrash = async ($: EngineInterface, f: File) =>
  $.process.run(['mv', f.path, `${await home($)}/.Trash/${f.name.replace(/\.md$/, '')} ${Date.now()}.md`])

// Same as claudio's pane: sent/ tells a skill the message went out, and touch stamps the send time its prune reads.
const moveToSent = async ($: EngineInterface, f: File) => {
  const dir = `${await dirOf($)}/sent`
  const made = await $.process.run(['mkdir', '-p', dir])
  if (made.exitCode !== 0) return made
  const to = `${dir}/${f.name}`
  const r = await $.process.run(['mv', f.path, to])
  if (r.exitCode === 0) await $.process.run(['touch', to])
  return r
}

// What this Mac has put on the page: name -> the mtime it pushed. Shared by every session (the store).
const pushedOf = async ($: EngineInterface) => ((await $.store.get('pushed')) ?? {}) as Record<string, number>

// The session's own state: the Vercel link it read or the Artifact page it found, whether a tick is running, the warnings it gave.
type Sync = { link: Link | null; page: string | null; busy: boolean; warned: Set<string> }

// one toast per kind per session (the text, unless a kind is given), never a block on anything
const warn = ($: EngineInterface, s: Sync, text: string, kind = text) => {
  if (s.warned.has(kind)) return
  s.warned.add(kind)
  $.ui.toast(`slack-drafts-mobile: ${text}`, { timeoutMs: 15_000 })
}

const call = async ($: EngineInterface, s: Sync, l: Link, method: string, query: string, body?: unknown): Promise<HttpResponse> => {
  const r = await $.http
    .fetch(`${l.url}/api/drafts${query}`, {
      method,
      headers: { Authorization: `Bearer ${l.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    .catch((e: unknown) => ({ status: 0, ok: false, headers: {}, text: e instanceof Error ? e.message : String(e) }))
  if (r.status === 401) {
    // a rotated token: read the keychain again on the next minute's check
    s.link = null
    warn($, s, 'the phone page refused this Mac. Run /slack-drafts-mobile to set it up again.')
  } else if (!r.ok && r.status !== 400) {
    const why = r.status === 0 ? r.text : `HTTP ${r.status} ${r.text.slice(0, 120)}`
    warn($, s, `the phone page failed (${why}). Drafts stay on the Mac and sync once it answers.`, 'failed')
  }
  return r
}

const push = async ($: EngineInterface, s: Sync, l: Link) => {
  const files = await listFiles($)
  if (files === null) return
  const pushed = await pushedOf($)
  const changed = files.filter(f => pushed[f.name] !== f.mtimeMs)
  const gone = Object.keys(pushed).filter(name => !files.some(f => f.name === name))
  if (changed.length === 0 && gone.length === 0) return
  const next = { ...pushed }
  for (const f of changed) {
    const md = await $.fs.read(f.path).catch(() => null)
    if (md === null) continue
    const r = await call($, s, l, 'PUT', `?name=${encodeURIComponent(f.name)}`, { md, savedAt: f.mtimeMs })
    // a 400 (a name or size the page refuses) is recorded too, so it isn't retried every 3 s
    if (r.ok || r.status === 400) next[f.name] = f.mtimeMs
    if (r.status === 400) warn($, s, `${f.name} was not sent to the phone page (${r.text.slice(0, 120)}).`)
  }
  for (const name of gone) {
    const r = await call($, s, l, 'DELETE', `?name=${encodeURIComponent(name)}`)
    if (r.ok || r.status === 400) delete next[name]
  }
  await $.store.set('pushed', next)
}

// Reads the phone's taps every 15 s while a pushed draft is on the page, one session at a time (the shared stamp).
const pull = async ($: EngineInterface, s: Sync, l: Link) => {
  if (Object.keys(await pushedOf($)).length === 0) return
  const now = await $.clock.now()
  if (now - Number((await $.store.get('pulledAt')) ?? 0) < PULL_MS - 500) return
  await $.store.set('pulledAt', now)
  const r = await call($, s, l, 'GET', '')
  if (!r.ok) return
  let rows: Row[] = []
  try {
    rows = ((JSON.parse(r.text) as { drafts?: Row[] }).drafts ?? []).filter(x => x.state === 'sent' || x.state === 'deleted')
  } catch {
    return
  }
  if (rows.length === 0) return
  const files = await listFiles($)
  if (files === null) return
  const next = { ...(await pushedOf($)) }
  let sent = 0
  let trashed = 0
  for (const row of rows) {
    const f = files.find(x => x.name === row.name)
    // saved again on the Mac after the tap: the next push reopens it on the page
    if (f && f.mtimeMs > row.actedAt) continue
    if (f) {
      const moved = row.state === 'sent' ? await moveToSent($, f) : await moveToTrash($, f)
      if (moved.exitCode !== 0) {
        // the row stays marked, so the next pull tries again
        warn($, s, `could not move ${f.name} after the phone's tap (${moved.stderr.trim().slice(0, 120) || `exit ${moved.exitCode}`}).`)
        continue
      }
      if (row.state === 'sent') sent++
      else trashed++
    }
    const done = await call($, s, l, 'DELETE', `?name=${encodeURIComponent(row.name)}`)
    if (done.ok) delete next[row.name]
  }
  await $.store.set('pushed', next)
  const parts = [sent > 0 && `${sent} marked sent`, trashed > 0 && `${trashed} moved to the Trash`].filter(Boolean)
  if (parts.length > 0) $.ui.toast(`From the phone: ${parts.join(', ')}`)
}

// A tick that finds the last one still running skips, so a slow network never stacks requests.
const tick = async ($: EngineInterface, s: Sync, kind: 'push' | 'pull') => {
  const l = s.link
  if (s.busy || l === null) return
  s.busy = true
  try {
    await (kind === 'push' ? push($, s, l) : pull($, s, l))
  } finally {
    s.busy = false
  }
}

// read every minute, so a session picks up a rotated token or a new link
const checkLink = async ($: EngineInterface, s: Sync) => {
  s.link = await readLink($, s)
}

const nudge = async ($: EngineInterface) => {
  if (await $.store.get('nudged')) return
  $.ui.toast('slack-drafts-mobile: run /slack-drafts-mobile to put your Slack drafts on your phone', { timeoutMs: 15_000 })
  await $.store.set('nudged', true)
}

// ── the Artifact page ──
// Both sides only add rows: the Mac a row per save and a tombstone per draft it no longer
// holds, the page a tombstone `from: 'phone'` per Sent or delete tap. The page shows the
// newest row per draft and tidies the rest. Every row id carries the push time, so a push
// never meets a row that exists (a write to one needs its version).

const ART_PULL_MS = 30_000
const LIST_MS = 5 * 60_000
const BATCH = 50

// One listing line per page: "- (mine, pinned) Slack Drafts <dash> <url> <dash> updated <date>"
const LISTED = /^- \(mine(, pinned)?\) Slack Drafts \S (https:\/\/claude\.ai\/\S*artifact\/[\w-]+)/gm

// The account's own Slack Drafts pages, pinned first; null when this session can't list them
// (no Artifact tools, as on an account with Artifacts off, a refused call, or a tool error).
// ponytail: one listing of 200, most recent first; follow page_token if the page is ever missed
const listPages = async ($: EngineInterface): Promise<string[] | null> => {
  const r = await $.tool.call({ tool: 'Artifact', action: 'list', scope: 'mine', limit: 200 }).catch(() => null)
  if (r === null || r.deny !== undefined || r.isError) return null
  const found = [...(r.text ?? '').matchAll(LISTED)].map(m => ({ url: m[2] ?? '', pinned: m[1] !== undefined }))
  return [...found.filter(f => f.pinned), ...found.filter(f => !f.pinned)].map(f => f.url)
}

// The page in use while the listing still shows it, else the first listed. A failed listing keeps
// what the session holds: only a successful one that shows no page means there is none.
const findPage = async ($: EngineInterface, s: Sync) => {
  const pages = await listPages($)
  if (pages === null) return warn($, s, "this session can't list your Artifacts, so drafts stay on the Mac until one that can is open.", 'list')
  s.page = s.page !== null && pages.includes(s.page) ? s.page : (pages[0] ?? null)
  if (s.page === null) await nudge($)
}

const docId = (name: string, at: number) =>
  `${name.replace(/\.md$/, '').replace(/[^A-Za-z0-9_.~:@+-]/g, '_')}-${Math.round(at)}`

// A read of the page comes back as one JSON document per line between two marker lines.
type Tomb = { name: string; deleted?: unknown; sent?: unknown; savedAt?: unknown }
const rowsOf = (text: string): Tomb[] =>
  text.split('\n').flatMap(line => {
    if (!line.startsWith('{')) return []
    try {
      const { data } = JSON.parse(line) as { data?: Partial<Tomb> }
      return typeof data?.name === 'string' ? [{ ...data, name: data.name }] : []
    } catch {
      return []
    }
  })

// What this Mac put on each page: page url -> name -> the mtime it pushed. Kept per page, so a
// page it goes back to gets tombstones for exactly the drafts it put there, and shared (the store).
const syncedOf = async ($: EngineInterface) => ((await $.store.get('artifactSynced')) ?? {}) as Record<string, Record<string, number>>

// An answer that is no success: says why once, and drops a page that no longer opens so the next listing finds it again.
const failed = ($: EngineInterface, s: Sync, r: { deny?: string; isError?: boolean; text?: string }) => {
  if (r.deny === undefined && !r.isError) return false
  const why = (r.deny ?? r.text ?? 'no reason given').slice(0, 160)
  if (/no such artifact|not found/i.test(why)) {
    s.page = null
    $.clock.after(0, () => void findPage($, s).catch(() => undefined))
  } else warn($, s, `the phone page failed (${why}). Drafts stay on the Mac and sync once it answers.`, 'failed')
  return true
}

const pushPage = async ($: EngineInterface, s: Sync, url: string) => {
  const files = await listFiles($)
  if (files === null) return
  const synced = (await syncedOf($))[url] ?? {}
  const changed = files.filter(f => synced[f.name] !== f.mtimeMs)
  const gone = Object.keys(synced).filter(name => !files.some(f => f.name === name))
  if (changed.length === 0 && gone.length === 0) return
  const now = Date.now()
  const next = { ...synced }
  const writes: { op: 'set'; collection: string; doc_id: string; data: Record<string, unknown> }[] = []
  for (const f of changed) {
    const md = await $.fs.read(f.path).catch(() => null)
    if (md === null) continue
    writes.push({ op: 'set', collection: 'drafts', doc_id: docId(f.name, now), data: { name: f.name, md, savedAt: f.mtimeMs } })
    next[f.name] = f.mtimeMs
  }
  for (const name of gone) {
    writes.push({ op: 'set', collection: 'drafts', doc_id: docId(name, now), data: { name, deleted: true, savedAt: now } })
    delete next[name]
  }
  for (let i = 0; i < writes.length; i += BATCH) {
    const r = await $.tool
      .call({ tool: 'ArtifactData', action: 'batch', url, writes: writes.slice(i, i + BATCH) })
      .catch((e: unknown) => ({ deny: e instanceof Error ? e.message : String(e) }))
    if (failed($, s, r)) return
  }
  await $.store.set('artifactSynced', { ...(await syncedOf($)), [url]: next })
}

// Reads the phone's taps every 30 s while this Mac has a draft on the page, one session at a time (the shared stamp).
const pullPage = async ($: EngineInterface, s: Sync, url: string) => {
  if (Object.keys((await syncedOf($))[url] ?? {}).length === 0) return
  const now = await $.clock.now()
  if (now - Number((await $.store.get('artifactPulledAt')) ?? 0) < ART_PULL_MS - 500) return
  await $.store.set('artifactPulledAt', now)
  const r = await $.tool
    .call({ tool: 'ArtifactData', action: 'query', url, collection: 'drafts', query: { where: [['from', '==', 'phone']], limit: 1000 } })
    .catch((e: unknown) => ({ deny: e instanceof Error ? e.message : String(e) }))
  if (failed($, s, r)) return
  const latest = new Map<string, { at: number; sent: boolean }>()
  for (const row of rowsOf(('text' in r && r.text) || '')) {
    if (row.deleted !== true) continue
    const at = Number(row.savedAt) || 0
    if (at >= (latest.get(row.name)?.at ?? -1)) latest.set(row.name, { at, sent: row.sent === true })
  }
  const files = await listFiles($)
  if (files === null) return
  // a draft saved again on the Mac after the tap stays, and its next push reopens it on the page
  const doomed = files.filter(f => (latest.get(f.name)?.at ?? -1) >= f.mtimeMs)
  let sent = 0
  let trashed = 0
  for (const f of doomed) {
    const isSent = latest.get(f.name)?.sent === true
    const moved = isSent ? await moveToSent($, f) : await moveToTrash($, f)
    if (moved.exitCode !== 0) {
      warn($, s, `could not move ${f.name} after the phone's tap (${moved.stderr.trim().slice(0, 120) || `exit ${moved.exitCode}`}).`)
      continue
    }
    if (isSent) sent++
    else trashed++
  }
  const parts = [sent > 0 && `${sent} marked sent`, trashed > 0 && `${trashed} moved to the Trash`].filter(Boolean)
  if (parts.length === 0) return
  $.ui.toast(`From the phone: ${parts.join(', ')}`)
  // the moved files' tombstones tell the page to tidy the tapped rows away
  await pushPage($, s, url)
}

const pageTick = async ($: EngineInterface, s: Sync, kind: 'push' | 'pull') => {
  const url = s.page
  if (s.busy || url === null) return
  s.busy = true
  try {
    await (kind === 'push' ? pushPage($, s, url) : pullPage($, s, url))
  } finally {
    s.busy = false
  }
}

export const register: Register = (on, options) => {
  const s: Sync = { link: null, page: null, busy: false, warned: new Set() }

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    if (options.page === 'vercel') {
      await checkLink($, s).catch(() => undefined)
      if (s.link === null) await nudge($)
      // set up later (or the token rotated): the next minute's check picks it up, no reload needed
      $.clock.every(LINK_MS, () => void checkLink($, s).catch(() => undefined))
      $.clock.every(PUSH_MS, () => void tick($, s, 'push').catch(() => undefined))
      $.clock.every(PULL_MS, () => void tick($, s, 'pull').catch(() => undefined))
      return ran
    }
    // on a timer: the listing goes over the network, and session.start holds the session's first turn
    $.clock.after(0, () => void findPage($, s).catch(() => undefined))
    $.clock.every(LIST_MS, () => void findPage($, s).catch(() => undefined))
    $.clock.every(PUSH_MS, () => void pageTick($, s, 'push').catch(() => undefined))
    $.clock.every(ART_PULL_MS, () => void pageTick($, s, 'pull').catch(() => undefined))
    return ran
  })
}
