import type { EngineInterface, HttpResponse, Register } from 'claude-code'

// Syncs ~/Desktop/slack-drafts (the folder /write-slack-message saves to) with the
// phone page on the user's own Vercel deployment, over plain HTTPS, so it works in
// every session whatever Claude tools it has. The page never reaches the Mac: a tap
// there only marks the draft, and this mod moves the file when it next reads the list.
// The page's link and token live in the macOS keychain, written by /slack-drafts-mobile.

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

// The session's own state: the link it read, whether a tick is running, the warnings it gave.
type Sync = { link: Link | null; busy: boolean; warned: Set<string> }

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

export const register: Register = on => {
  const s: Sync = { link: null, busy: false, warned: new Set() }

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await checkLink($, s).catch(() => undefined)
    if (s.link === null && !(await $.store.get('nudged'))) {
      $.ui.toast('slack-drafts-mobile: run /slack-drafts-mobile to put your Slack drafts on your phone', { timeoutMs: 15_000 })
      await $.store.set('nudged', true)
    }
    // set up later (or the token rotated): the next minute's check picks it up, no reload needed
    $.clock.every(LINK_MS, () => void checkLink($, s).catch(() => undefined))
    $.clock.every(PUSH_MS, () => void tick($, s, 'push').catch(() => undefined))
    $.clock.every(PULL_MS, () => void tick($, s, 'pull').catch(() => undefined))
    return ran
  })
}
