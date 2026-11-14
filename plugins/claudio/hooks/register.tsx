import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Draft, UsageSnap } from '../types'
import { clipboardScript, labelOf, mentionBlocks, splitDraft } from './slack-html'
import { captionOf, lookOf, moodOf, petColor, petFrame, petPx, petSvg, signatureOf } from './pet'
import { MARKET_URL, isNewer, publishedVersion, updateNote } from './update-check'
import { BAR_PX, GREEN, ROW_PX, bar, svgBar, timeLeft, tokens, tone } from './usage-bars'

// Two mods in one module: the engine loads one hooks module per plugin, allows
// one unmatched session.start hook, and never follows $ across an import, so
// every hook and every helper that takes $ lives here.

// ── slack-drafts: the /slack-drafts pane and the phone page copy ──

const PANE = 'slack-drafts'
const drafts = atom({ plugin: 'claudio', key: 'drafts' } as const, [])

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''
const dirOf = async ($: EngineInterface) =>
  (await $.env.get('SLACK_DRAFTS_DIR')) ?? `${await home($)}/Desktop/slack-drafts`

const signature = (files: { name: string; mtimeMs: number }[]) => files.map(f => `${f.name}@${f.mtimeMs}`).join('|')

// Reads the files only when the folder's names or mtimes moved, so polling it is cheap.
const refresh = async ($: EngineInterface) => {
  const dir = await dirOf($)
  const entries = await $.fs.list(dir).catch(() => [])
  const mds = entries.filter(f => f.kind === 'file' && f.name.endsWith('.md')).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const held = await read($, drafts)
  if (signature(mds) === signature(held)) return held
  const list: Draft[] = await Promise.all(
    mds.map(async f => ({ name: f.name, path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs, text: await $.fs.read(`${dir}/${f.name}`) })),
  )
  await update($, drafts, () => list)
  return list
}

// Copies the message alone; the where-to-post header stays behind.
const copyForSlack = async ($: EngineInterface, d: Draft) => {
  const { body } = splitDraft(d.text)
  const rich = await $.process.run(['osascript', '-e', clipboardScript(body)]).catch(() => null)
  if (rich?.exitCode === 0) return $.ui.toast(`Copied ${labelOf(d.name).who} draft for Slack`)
  await $.process.run(['pbcopy'], { stdin: body })
  $.ui.toast('Copied as plain text (the Slack-safe copy failed)')
}

// Selects the file in Finder, ready to drag into the Slack message.
const revealAttachment = async ($: EngineInterface, path: string) => {
  const full = path.replace(/^~(?=\/)/, await home($))
  const r = await $.process.run(['open', '-R', full])
  $.ui.toast(r.exitCode === 0 ? `Showing ${full.split('/').pop()} in Finder: drag it into Slack` : `Could not find ${full}`)
}

// ponytail: moved to ~/.Trash, not unlinked, so a misclick is recoverable from Finder
const moveToTrash = async ($: EngineInterface, d: Draft) =>
  $.process.run(['mv', d.path, `${await home($)}/.Trash/${d.name.replace(/\.md$/, '')} ${Date.now()}.md`])

const trash = async ($: EngineInterface, d: Draft, url: string) => {
  const r = await moveToTrash($, d)
  $.ui.toast(r.exitCode === 0 ? `Moved ${d.name} to the Trash` : `Could not delete: ${r.stderr.trim()}`)
  await syncPhone($, url, await refresh($))
}

// Sent keeps the draft in sent/ so a skill can tell a sent message from a
// discarded one; touch stamps the send time the prune reads.
const sentDirOf = async ($: EngineInterface) => `${await dirOf($)}/sent`
const moveToSent = async ($: EngineInterface, d: Draft) => {
  const dir = await sentDirOf($)
  const made = await $.process.run(['mkdir', '-p', dir])
  if (made.exitCode !== 0) return made
  const to = `${dir}/${d.name}`
  const r = await $.process.run(['mv', d.path, to])
  if (r.exitCode === 0) await $.process.run(['touch', to])
  return r
}

const markSent = async ($: EngineInterface, d: Draft, url: string) => {
  const r = await moveToSent($, d)
  $.ui.toast(r.exitCode === 0 ? `Marked the ${labelOf(d.name).who} draft as sent` : `Could not mark it sent: ${r.stderr.trim()}`)
  await syncPhone($, url, await refresh($))
}

// ponytail: one pass per session start, to the Trash like a discard; a timer if sessions ever run for weeks
const DAY_MS = 86_400_000
const pruneSent = async ($: EngineInterface, days: number) => {
  if (!(days > 0)) return
  const dir = await sentDirOf($)
  const cutoff = (await $.clock.now()) - days * DAY_MS
  const old = (await $.fs.list(dir).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.md') && f.mtimeMs < cutoff)
  await Promise.all(old.map(f => moveToTrash($, { name: f.name, path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs, text: '' })))
}

// A delete or a Sent on the phone page adds a tombstone marked from: 'phone' (Sent
// adds sent: true). The Mac trashes the file or moves it to sent/, and the tombstone
// syncPhone then writes tells the page to tidy both away.
// `quiet` (the poll) skips the read when it would open a permission dialog. Core
// asks before every ArtifactData call; the tool.check hook below allows this read
// only while one of this mod's hooks runs (tool.call, /slack-drafts): a timer's calls skip it.
const PULL_MS = 30_000
// `approved` (the idleSync option) skips that check: the plugin's PreToolUse hook
// (hooks/phone-page-allow.py) approves the read and the sync after it, which a mod's
// $.tool.check never asks.
// Resolves 'gone' when the page no longer opens for this account (deleted, or another account's page).
const pullPhoneDeletes = async ($: EngineInterface, url: string, quiet: boolean, approved = false): Promise<'gone' | undefined> => {
  if (!url) return
  // every session polls; the shared stamp keeps it to about one read per interval in all
  const now = await $.clock.now()
  if (quiet && now - Number((await $.store.get('phonePulledAt')) ?? 0) < PULL_MS - 1_000) return
  const input = { action: 'query' as const, url, collection: 'drafts', query: { where: [['from', '==', 'phone']], limit: 1000 } }
  // stamped after the check, so a refused pass leaves the slot to one that can read
  if (quiet && !approved && (await $.tool.check({ tool: 'ArtifactData', input })).decision !== 'allow') return
  await $.store.set('phonePulledAt', now)
  const r = await $.tool.call({ tool: 'ArtifactData', ...input })
  if (r.deny !== undefined) return
  if (r.isError) return /no such artifact/i.test(r.text ?? '') ? 'gone' : undefined
  // the read comes back as one JSON document per line between two marker lines
  const latest = new Map<string, { at: number; sent: boolean }>()
  for (const line of (r.text ?? '').split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const { data } = JSON.parse(line) as { data?: { name?: unknown; deleted?: unknown; sent?: unknown; savedAt?: unknown } }
      if (data?.deleted !== true || typeof data.name !== 'string') continue
      const at = Number(data.savedAt) || 0
      if (at >= (latest.get(data.name)?.at ?? -1)) latest.set(data.name, { at, sent: data.sent === true })
    } catch {
      continue
    }
  }
  // a draft saved again on the Mac after the phone deleted it stays
  const doomed = (await refresh($)).filter(d => (latest.get(d.name)?.at ?? -1) >= d.mtimeMs)
  if (doomed.length === 0) return
  const done = await Promise.all(doomed.map(async d => ({ sent: latest.get(d.name)?.sent === true, r: await (latest.get(d.name)?.sent ? moveToSent($, d) : moveToTrash($, d)) })))
  const sent = done.filter(x => x.sent && x.r.exitCode === 0).length
  const trashed = done.filter(x => !x.sent && x.r.exitCode === 0).length
  const parts = [sent > 0 && `${sent} marked sent`, trashed > 0 && `${trashed} moved to the Trash`].filter(Boolean)
  if (parts.length > 0) $.ui.toast(`From the phone page: ${parts.join(', ')}`)
  await syncPhone($, url, await refresh($))
}

// The phone page (an artifact with a db) gets an append-only copy: a new row per
// save and a tombstone per delete; the page shows the newest row per draft and
// tidies the rest. Every row id carries the push time, so a re-push (a fresh
// install starts with an empty `synced` record) adds a duplicate the page folds
// away instead of colliding with an existing row, which the store refuses
// without its version.
const docId = (name: string, at: number) =>
  `${name.replace(/\.md$/, '').replace(/[^A-Za-z0-9_.~:@+-]/g, '_')}-${Math.round(at)}`

// Returns what happened, for /slack-drafts to say; failures also toast unless `quiet` (the idle push).
const syncPhone = async ($: EngineInterface, url: string, list: Draft[], quiet = false): Promise<string> => {
  if (!url) return 'no phone page yet'
  // a new page starts empty, so the record of what was sent counts only for the page it was sent to
  const synced = ((await $.store.get('syncedUrl')) === url ? ((await $.store.get('synced')) ?? {}) : {}) as Record<string, number>
  const now = Date.now()
  const changed = list.filter(d => synced[d.name] !== d.mtimeMs)
  const gone = Object.keys(synced).filter(name => !list.some(d => d.name === name))
  if (changed.length === 0 && gone.length === 0) return 'phone page up to date'
  const writes = [
    ...changed.map(d => ({ op: 'set' as const, collection: 'drafts', doc_id: docId(d.name, now), data: { name: d.name, md: d.text, savedAt: d.mtimeMs } })),
    ...gone.map(name => ({ op: 'set' as const, collection: 'drafts', doc_id: docId(name, now), data: { name, deleted: true, savedAt: now } })),
  ]
  // A session can run without the artifact tools (seen with Remote Control on), and the call
  // then throws; another session's idle push sends the draft instead (startSlackDrafts).
  const r = await $.tool
    .call({ tool: 'ArtifactData', action: 'batch', url, writes })
    .catch((e: unknown) => ({ deny: `this session can't reach artifacts (${e instanceof Error ? e.message : String(e)})` }))
  if (r.deny !== undefined || r.isError) {
    const why = (r.deny ?? r.text ?? 'no reason given').slice(0, 160)
    if (!quiet) $.ui.toast(`Phone sync failed: ${why}`)
    return `phone sync failed: ${why}`
  }
  const next = Object.fromEntries(list.map(d => [d.name, d.mtimeMs]))
  await $.store.set('synced', next)
  await $.store.set('syncedUrl', url)
  return `sent ${writes.length} change${writes.length === 1 ? '' : 's'} to the phone page`
}

const open = ($: EngineInterface, focus: boolean) =>
  $.ui.open({ id: PANE, title: 'Slack drafts', closeOnEscape: true, ...(focus ? { focus: true as const } : {}) })

// The mod cannot publish the page itself (an artifact's files must sit in the working
// directory or Claude's scratchpad), so Claude does, and the tool.call hook saves the link.
const newPagePrompt = (root: string) =>
  `Publish a new Slack Drafts phone page for the claudio plugin, as a new artifact. ` +
  `Copy ${root}/slack-drafts-phone/index.html and ${root}/slack-drafts-phone/slack-html.js into a folder named slack-drafts-phone in your scratchpad, read both, ` +
  `then publish with file_path set to the full path of that index.html (no root, no url), files {"slack-html.js": <the copied slack-html.js>}, capabilities {"db": {"rules": [{"path": "drafts", "read": "owner", "write": "owner"}]}, "user": {}}, ` +
  `icon "message" and pin: true. The plugin saves the new link and sends the drafts there itself, so just give me the link.`

// ponytail: a 2-minute hold between publish requests; a declined or failed publish can be retried after it
const ASK_MS = 120_000

// Each replaced link (or '' for none) -> its replacement, shared by every session (the store), so a
// session still holding a dead link, or none, follows the new page instead of publishing a second one.
const followMoves = async ($: EngineInterface, url: string) => {
  const moves = ((await $.store.get('phoneMoves')) ?? {}) as Record<string, string>
  for (let hops = 0; moves[url] !== undefined && hops < 20; hops++) url = moves[url] ?? url
  return url
}

// Saves the phoneUrl option; resolves why it could not, or undefined once written.
const saveLink = async ($: EngineInterface, url: string) =>
  (await $.config.set({ key: `${$.plugin.name}.phoneUrl`, value: url }).catch((e: unknown) => ({ deny: e instanceof Error ? e.message : String(e) }))).deny

// The setting can lag the page (one republish's save never landed, leaving it on a deleted page
// that write-slack-message handed out as the phone link), so each start re-saves where the moves lead.
const healLink = async ($: EngineInterface, url: string) => {
  const live = await followMoves($, url)
  if (live === url) return url
  const why = await saveLink($, live)
  if (why !== undefined) $.ui.toast(`claudio: the phone page moved to ${live}, but the setting still holds the old link: ${why}`, { timeoutMs: 15_000 })
  return live
}

// "Published <file> at <url> (Version 1, ...)": the link of a publish of the phone page, or null.
const PUBLISHED = /^Published .* at (https:\/\/claude\.ai\/\S*artifact\/[\w-]+)/
const publishedPhoneUrl = (filePath: unknown, text: string | undefined) =>
  /slack-drafts-phone\/index\.html$/.test(String(filePath ?? '')) ? (PUBLISHED.exec(text ?? '')?.[1] ?? null) : null

const startSlackDrafts = async ($: EngineInterface, phone: () => string, sentDays: number, idleSync: boolean) => {
  await $.command.register({ name: 'slack-drafts', description: 'Show your Slack drafts in a pane and send new ones to the phone page' })
  await pruneSent($, sentDays).catch(() => undefined)
  await refresh($)
  // Each session holds its own list, so a save or delete made in another session
  // shows here on the next tick. ponytail: a 3s poll of one small folder; a file
  // watcher if the engine ever grows one
  $.clock.every(3_000, () => void refresh($).catch(() => undefined))
  // ponytail: a 30s read of the phone page's tombstones (core decides it here, see
  // pullPhoneDeletes; the tool.call hook reads them too); a push if the db ever offers one to a mod
  $.clock.every(PULL_MS, () => void pullPhoneDeletes($, phone(), true, idleSync).catch(() => undefined))
  // With idleSync, the same tick pushes drafts no session has sent yet, so a draft saved in a
  // session that can't reach artifacts reaches the phone through any other session open on the
  // Mac. The record of what was sent is shared, so the first session to manage it stops the rest.
  if (idleSync) $.clock.every(PULL_MS, () => void refresh($).then(list => syncPhone($, phone(), list, true)).catch(() => undefined))
}

// ── first run: point a new install at /vault-init ──

// Most skills read or write the project's vault, and a new install has none.
// ponytail: one toast per install, and only while no vault registry exists at all
const nudgeVault = async ($: EngineInterface) => {
  if (await $.store.get('vaultNudged')) return
  const registry = await $.fs.read(`${await home($)}/.config/claudio/vaults.json`).catch(() => null)
  if (registry !== null) return
  $.ui.toast('claudio: run /vault-init in your project so its skills keep a memory', { timeoutMs: 15_000 })
  await $.store.set('vaultNudged', true)
}

// An update skips the install screen that lists new options, so the pet says so once.
// ponytail: one toast per install, and only while the Pet option is off
const nudgePet = async ($: EngineInterface) => {
  if (await $.store.get('petNudged')) return
  $.ui.toast('claudio: turn on the new Pet option in /config to see whether Claude is working, waiting on you, or needs you', {
    timeoutMs: 15_000,
  })
  await $.store.set('petNudged', true)
}

// ── update check: a newer published claudio than this install ──

// The newer published version, or null; the pet shows it on your turn.
const outdated = atom({ plugin: 'claudio', key: 'outdated' } as const, null)
const HOUR_MS = 3_600_000

// One fetch a day across every session (the stamp is in the shared store); the
// hourly tick only re-reads it, so a session left open for days still hears.
const checkForUpdate = async ($: EngineInterface, showPet: boolean) => {
  const now = await $.clock.now()
  const checkedAt = await $.store.get('updateCheckedAt')
  if (typeof checkedAt !== 'number' || now - checkedAt >= DAY_MS) {
    const r = await $.http.fetch(MARKET_URL).catch(() => null)
    const found = r?.ok ? publishedVersion(r.text) : null
    if (found !== null) {
      await $.store.set('latestVersion', found)
      await $.store.set('updateCheckedAt', now)
    }
  }
  const latest = await $.store.get('latestVersion')
  const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '{}')
  const installed = (JSON.parse(manifest) as { version?: unknown }).version
  const next = isNewer(latest, installed) ? (latest as string) : null
  if ((await read($, outdated)) !== next) await update($, outdated, () => next)
  if (!showPet) $.ui.status(next === null ? undefined : updateNote(next))
  if (next !== null && (await $.store.get('updateToasted')) !== next) {
    $.ui.toast(updateNote(next), { timeoutMs: 15_000 })
    await $.store.set('updateToasted', next)
  }
}

const startUpdateCheck = async ($: EngineInterface, showPet: boolean) => {
  await checkForUpdate($, showPet).catch(() => undefined)
  $.clock.every(HOUR_MS, () => void checkForUpdate($, showPet).catch(() => undefined))
}

// ── usage-bars: the context and 5-hour limit band above the prompt ──

const snap = atom({ plugin: 'claudio', key: 'snap' } as const, null)

const saveUsage = async (
  $: EngineInterface,
  u: { context: SessionContextUsage; rateLimits: SessionRateLimit[] },
) => {
  const next: UsageSnap = {
    context: u.context,
    fiveHour: u.rateLimits.find(r => r.kind === 'five_hour') ?? null,
    now: await $.clock.now(),
  }
  await update($, snap, () => next)
}

const startUsageBars = async ($: EngineInterface) => {
  await saveUsage($, await $.session.usage())
  // ponytail: 60s tick only so the reset countdown moves while idle
  $.clock.every(60_000, () => void $.session.usage().then(u => saveUsage($, u)))
}

// ── pet: the band's right side, showing whether Claude works, waits on you, or is blocked ──

// The tool whose call waits on the person (a permission dialog, a question, a
// plan to approve), or null.
const blockedOn = atom({ plugin: 'claudio', key: 'blocked' } as const, null)
const petTick = atom({ plugin: 'claudio', key: 'tick' } as const, 0)
// The tool running now, which picks the pet's prop (glasses and a book, a pencil, a hammer).
const runningTool = atom({ plugin: 'claudio', key: 'tool' } as const, null)
// Tools ended so far, which picks what the pet plays between them.
const plays = atom({ plugin: 'claudio', key: 'plays' } as const, 0)
// The claudio skill with a signature (shipit sails) running this turn, shown between its tools.
const runningSkill = atom({ plugin: 'claudio', key: 'skill' } as const, null)

const block = async ($: EngineInterface, tool: string) => {
  if ((await read($, blockedOn)) !== tool) await update($, blockedOn, () => tool)
}
// ponytail: cleared by tool name, so two parallel calls of one tool both blocked clear together
const unblock = async ($: EngineInterface, tool?: string) => {
  const held = await read($, blockedOn)
  if (held !== null && (tool === undefined || held === tool)) await update($, blockedOn, () => null)
}

// ponytail: steps the terminal's text sprite; the desktop's Svg animates itself and never reads it
const startPet = async ($: EngineInterface) => {
  $.clock.every(500, () => void update($, petTick, n => n + 1))
}

export const register: Register = (on, options) => {
  // replaced when the page is published anew (the tool.call hook below)
  let phoneUrl = String(options.phoneUrl ?? '')
  const showUsage = options.usageBars === true
  const showPet = options.pet === true
  const sentDays = Number(options.sentDays ?? 1)
  const idleSync = options.idleSync === true

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    phoneUrl = await healLink($, phoneUrl).catch(() => phoneUrl)
    // one mod failing to start must not keep the others from starting
    const failed = (
      await Promise.allSettled([
        startSlackDrafts($, () => phoneUrl, sentDays, idleSync),
        (showUsage || showPet) && startUsageBars($),
        showPet && startPet($),
        nudgeVault($),
        startUpdateCheck($, showPet),
        !showPet && nudgePet($),
      ])
    ).find(r => r.status === 'rejected')
    if (failed) throw failed.reason
    return ran
  })

  // This mod's own reads and syncs of its own phone page are allowed, so a draft
  // reaches the phone while nobody is at the Mac to approve the write. The model's
  // calls, any other page and a settings deny stay as core decides.
  on('tool.check', { tool: 'ArtifactData' }, async ($, e, next) => {
    const r = await next(e)
    const { action, url } = e.input as { action?: unknown; url?: unknown }
    const own = phoneUrl !== '' && next.origin.plugin === $.plugin.name && url === phoneUrl && (action === 'query' || action === 'batch')
    return own && r.decision === 'ask' ? { decision: 'allow' as const } : r
  })

  // With no phone page set, or one that no longer opens, Claude publishes a new one.
  // The .catch answers when anything else fails, so the command never goes unanswered.
  on('command.run', { command: 'slack-drafts' }, async $ => {
    phoneUrl = await followMoves($, phoneUrl)
    const pulled = await pullPhoneDeletes($, phoneUrl, false).catch(() => undefined)
    const list = await refresh($)
    await open($, true)
    const count = `${list.length} draft${list.length === 1 ? '' : 's'} in the pane`
    if (phoneUrl === '' || pulled === 'gone') {
      // one request at a time across sessions, so a second run before the publish lands makes no second page
      const now = await $.clock.now()
      const askedAt = await $.store.get('phoneAskedAt')
      if (typeof askedAt === 'number' && now - askedAt < ASK_MS) return { text: `${count}; Claude is already publishing a phone page.` }
      await $.store.set('phoneAskedAt', now)
      // a command.run hook cannot submit (the turn would wait on this hook), so it goes once the hook returns
      $.clock.after(0, () => void $.prompt.submit({ text: newPagePrompt($.plugin.root) }).catch(() => undefined))
      return { text: `${count}; ${phoneUrl === '' ? 'no phone page yet' : 'the phone page no longer opens'}, so Claude is publishing one.` }
    }
    return { text: `${count}, ${await syncPhone($, phoneUrl, list)}.` }
  }).catch(async $ => {
    const list = await refresh($).catch(() => [])
    return { text: `${list.length} draft${list.length === 1 ? '' : 's'} in ~/Desktop/slack-drafts; the pane or the phone page could not be updated from this session.` }
  })

  // The one unmatched tool.call hook the engine allows, for both mods. The pet:
  // the running tool picks its prop, a question or a plan to approve blocks until
  // its call resolves, and any call clears a permission dialog's block on its
  // tool. Slack drafts: a draft written
  // by any tool (Write, Edit, a Bash heredoc) refreshes the list, and a new or
  // changed one opens the pane; any call reads the phone page's Sent and trash
  // taps (at most every 30s), alongside the tool.
  on('tool.call', async ($, e, next) => {
    const pulling = followMoves($, phoneUrl)
      .then(url => pullPhoneDeletes($, (phoneUrl = url), true))
      .catch(() => undefined)
    const isDraft = e.tool !== 'ArtifactData' && JSON.stringify(e).includes('slack-drafts')
    if (!showPet && !isDraft) return next(e).finally(() => pulling)
    if (showPet && (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode')) await block($, e.tool)
    if (showPet) await update($, runningTool, () => e.tool)
    // read before the tool runs, or the poll could see the new draft first and keep the pane shut
    const newest = isDraft ? ((await read($, drafts))[0]?.mtimeMs ?? 0) : 0
    let ran
    try {
      ran = await next(e)
    } finally {
      if (showPet) {
        await unblock($, e.tool)
        // ponytail: parallel calls hand the prop to whichever started last, and the first to end puts it down
        if ((await read($, runningTool)) === e.tool) {
          await update($, plays, n => n + 1)
          await update($, runningTool, () => null)
        }
      }
    }
    await pulling
    if (!isDraft) return ran
    // a publish of the phone page (the /slack-drafts republish, or one by hand) becomes the page drafts go to
    const published = e.tool === 'Artifact' ? publishedPhoneUrl(e.file_path, ran.text) : null
    if (published !== null && published !== phoneUrl) {
      await $.store.set('phoneMoves', { ...(((await $.store.get('phoneMoves')) ?? {}) as Record<string, string>), [phoneUrl]: published })
      phoneUrl = published
      // A publish arms a comment watch in this session. The page needs none, and a session
      // resumed without the artifact tools reports every watch it can't resume.
      await $.tool.call({ tool: 'ArtifactComments', action: 'watch', url: published, on: false }).catch(() => undefined)
      const why = await saveLink($, published)
      $.ui.toast(why === undefined ? 'New phone page saved; drafts go there now' : `Could not save the new phone page link: ${why}`)
    }
    const list = await refresh($)
    if ((list[0]?.mtimeMs ?? 0) > newest) void open($, false)
    await syncPhone($, phoneUrl, list)
    return ran
  }).catch(($, e, next) => next(e)) // never block a tool call; next replays its result

  // On the phone (the mobile app, a Remote Control session), a draft shows as a card under the
  // Write that saved it, so it can be read there even when the phone page can't be synced.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Write' } }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'mobile' || e.props.isErrored) return row
    const { file_path, content } = (e.props.input ?? {}) as { file_path?: unknown; content?: unknown }
    const dir = await dirOf($)
    const path = String(file_path ?? '')
    if (typeof content !== 'string' || !path.startsWith(`${dir}/`) || path.slice(dir.length + 1).includes('/') || !path.endsWith('.md')) return row
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const { body, where } = splitDraft(content)
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
        {row}
        <Text dimColor>{`Slack draft for ${labelOf(path.split('/').pop() ?? '').who}`}</Text>
        {where !== '' && <Markdown text={where} dimColor />}
        <Markdown text={body} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)
    const list = await read($, drafts)

    if (list.length === 0) {
      return <Text dimColor>No drafts yet. /write-slack-message saves them to ~/Desktop/slack-drafts.</Text>
    }

    // ponytail: three rows per draft (who and when, the message, the actions) so a
    // narrow pane never squeezes the date into a column beside the buttons
    return (
      <Box flexDirection="column" gap={1}>
        {list.map((d, i) => {
          const { who, when } = labelOf(d.name)
          const { body, where, attachments } = splitDraft(d.text)
          return (
            <Box key={`draft-${i}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
              <Box gap={2}>
                <Text bold wrap="truncate-end">{who}</Text>
                {when !== '' && <Text dimColor wrap="truncate-end">{when}</Text>}
              </Box>
              {where !== '' && <Markdown key={`where-${d.name}`} text={where} dimColor />}
              {attachments.length > 0 && (
                <Box gap={1} flexWrap="wrap">
                  {attachments.map(p => (
                    <Button key={`attach-${d.name}-${p}`} label={`\u{1F4CE} ${p.split('/').pop()}`} onPress={() => revealAttachment($, p)} />
                  ))}
                </Box>
              )}
              <Box flexDirection="column" gap={1}>
                {mentionBlocks(body).map(b =>
                  'md' in b ? (
                    <Markdown text={b.md} />
                  ) : (
                    <Text>
                      {b.prefix}
                      {b.runs.map(r =>
                        r.kind === 'mention' ? (
                          <Text color="merged">{r.text}</Text>
                        ) : r.kind === 'code' ? (
                          <Text mono>{r.text}</Text>
                        ) : r.kind === 'link' ? (
                          <Link href={r.href ?? ''} label={r.text} />
                        ) : (
                          r.text
                        ),
                      )}
                    </Text>
                  ),
                )}
              </Box>
              <Box gap={1} flexWrap="wrap">
                <Button key={`copy-${d.name}`} label="Copy for Slack" variant="primary" onPress={() => copyForSlack($, d)} />
                <Button key={`sent-${d.name}`} label="Sent" onPress={() => markSent($, d, phoneUrl)} />
                {/* ponytail: a one-glyph label is the icon; Button has no icon prop */}
                <Button key={`del-${d.name}`} label={'\u{1F5D1}'} plain dimColor onPress={() => trash($, d, phoneUrl)} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  // A permission dialog blocks until its call resolves (tool.call above clears
  // it); a turn that ends (an interrupt, a rejection) clears whatever is left.
  // ponytail: no event marks the moment a dialog is approved, so an approved
  // command still shows "Needs you" until it finishes
  if (showPet) {
    on('classic.PermissionRequest', async ($, e, next) => {
      const r = await next(e)
      // a settings hook that decided means no dialog is shown
      if (r.decision === undefined) await block($, e.tool_name)
      return r
    }).catch(($, e, next) => next(e))

    on('turn.complete', async ($, e, next) => {
      if (e.agentId === undefined) {
        await unblock($)
        if ((await read($, runningSkill)) !== null) await update($, runningSkill, () => null)
      }
      return next(e)
    })

    // ponytail: a skill without a signature (or a helper one loads) leaves the running one's in place
    on('skill.prompt', async ($, e, next) => {
      if (signatureOf(e.skill) !== null) await update($, runningSkill, () => e.skill)
      return next(e)
    })
  }

  // ponytail: off unless usageBars or pet is on; another plugin's band may own that spot
  if (showUsage || showPet) {
    on('session.measure', async ($, e, next) => {
      await saveUsage($, e)
      return next(e)
    })
  }

  if (showUsage || showPet) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)
      const snapped = await read($, snap)
      const s = showUsage ? snapped : null
      const mood = showPet ? moodOf((await read($, blockedOn)) !== null, e.props.isWorking) : null
      if (s === null && mood === null) return next(e)

      const els = $.ui.resolve(e)
      const { Box, Text } = els
      // checked by surface too: the test kit's terminal table carries an Svg the real terminal lacks
      const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
      const meter = (pct: number, color: string, alt: string) =>
        Svg ? (
          <Svg source={svgBar(pct, color)} alt={alt} width={BAR_PX} height={ROW_PX} />
        ) : (
          <Text color={color}>{bar(pct)}</Text>
        )

      const usage = (s: UsageSnap) => {
        const ctxPct = Math.round(s.context.percent ?? 0)
        const ctxTokens = s.context.tokens === undefined ? '—' : tokens(s.context.tokens)
        const used = Math.round(s.fiveHour?.percentUsed ?? 0)
        const ctxTone = tone(ctxPct, 40, 60, 85)
        const fiveTone = tone(used, 50, 75, 90)
        const alert = (c: string) => (c === GREEN ? undefined : c)
        const fiveDetail =
          s.fiveHour === null ? 'no reading yet' : `used · resets in ${timeLeft(s.fiveHour.resetsAt, s.now)}`

        // ponytail: columns, not rows, so labels and bars line up on any font
        return (
          <Box gap={2}>
            <Box flexDirection="column">
              <Text dimColor>Context</Text>
              <Text dimColor>5-hour limit</Text>
            </Box>
            <Box flexDirection="column">
              {meter(ctxPct, ctxTone, `context ${ctxPct}% used`)}
              {meter(used, fiveTone, `5-hour window ${used}% used`)}
            </Box>
            <Box flexDirection="column" alignItems="flex-end">
              <Text bold color={alert(ctxTone)}>
                {ctxPct}%
              </Text>
              <Text bold color={alert(fiveTone)}>
                {s.fiveHour === null ? '—' : `${used}%`}
              </Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>
                used · {ctxTokens} of {tokens(s.context.window)}
              </Text>
              <Text dimColor>{fiveDetail}</Text>
            </Box>
          </Box>
        )
      }

      // The pet grows with the context and tires as the 5-hour window runs low.
      const ctxPct = Math.round(snapped?.context.percent ?? 0)
      const tool = mood === 'working' ? await read($, runningTool) : null
      const played = mood === 'working' && tool === null ? await read($, plays) : 0
      const skill = mood === 'working' && tool === null ? await read($, runningSkill) : null
      const newer = mood === 'waiting' ? await read($, outdated) : null
      const note = newer === null ? '' : updateNote(newer)
      const look = { ...lookOf(ctxPct, snapped?.fiveHour?.percentUsed ?? 0, tool, played, skill === null ? null : signatureOf(skill)), angry: note !== '' }
      const caption = mood === null ? '' : captionOf(mood, ctxPct)
      const captionColor = mood === 'blocked' ? petColor(mood) : caption.includes('/compact') ? tone(ctxPct, 40, 60, 85) : undefined
      // ponytail: the pet gives way when the band is too narrow for both
      const petFits = mood !== null && (s === null || e.props.bodyColumns >= 70 + Math.max(caption.length, note.length))
      // read only on the terminal, so the desktop's band never redraws on the tick
      const tick = petFits && Svg === null ? await read($, petTick) : 0

      return (
        <Box gap={2}>
          {s !== null && usage(s)}
          {petFits && (
            <Box key="pet" flexGrow={1} justifyContent="flex-end" alignItems="center" gap={1}>
              <Box flexDirection="column" alignItems="flex-end">
                <Text bold={captionColor !== undefined} color={captionColor} dimColor={captionColor === undefined}>
                  {caption}
                </Text>
                {note !== '' && (
                  <Text bold color={petColor(mood, true)}>
                    {note}
                  </Text>
                )}
              </Box>
              {Svg ? (
                <Svg source={petSvg(mood, look)} alt={`Claude: ${caption}${note === '' ? '' : `. ${note}`}`} {...petPx(look)} isInteractive />
              ) : (
                <Text color={petColor(mood, look.angry)}>{petFrame(mood, look, tick)}</Text>
              )}
            </Box>
          )}
        </Box>
      )
    })
  }
}
