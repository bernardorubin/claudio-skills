import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Draft, UsageSnap } from '../types'
import { clipboardScript, labelOf, splitDraft } from './slack-html'
import { CAPTION, PET_PX, moodOf, petColor, petFrame, petSvg } from './pet'
import { BAR_PX, BLUE, ROW_PX, bar, svgBar, timeLeft, tokens, tone } from './usage-bars'

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

// ponytail: moved to ~/.Trash, not unlinked, so a misclick is recoverable from Finder
const moveToTrash = async ($: EngineInterface, d: Draft) =>
  $.process.run(['mv', d.path, `${await home($)}/.Trash/${d.name.replace(/\.md$/, '')} ${Date.now()}.md`])

const trash = async ($: EngineInterface, d: Draft, url: string) => {
  const r = await moveToTrash($, d)
  $.ui.toast(r.exitCode === 0 ? `Moved ${d.name} to the Trash` : `Could not delete: ${r.stderr.trim()}`)
  await syncPhone($, url, await refresh($))
}

// A delete on the phone page adds a tombstone marked from: 'phone'. The Mac trashes
// the file, and the tombstone syncPhone then writes tells the page to tidy both away.
// `quiet` (the background poll) skips the read when it would open a permission dialog.
const PULL_MS = 30_000
const pullPhoneDeletes = async ($: EngineInterface, url: string, quiet: boolean) => {
  if (!url) return
  // every session polls; the shared stamp keeps it to about one read per interval in all
  const now = await $.clock.now()
  if (quiet && now - Number((await $.store.get('phonePulledAt')) ?? 0) < PULL_MS - 1_000) return
  await $.store.set('phonePulledAt', now)
  const input = { action: 'query' as const, url, collection: 'drafts', query: { where: [['from', '==', 'phone']], limit: 1000 } }
  if (quiet && (await $.tool.check({ tool: 'ArtifactData', input })).decision !== 'allow') return
  const r = await $.tool.call({ tool: 'ArtifactData', ...input })
  if (r.deny !== undefined || r.isError) return
  // the read comes back as one JSON document per line between two marker lines
  const deletedAt = new Map<string, number>()
  for (const line of (r.text ?? '').split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const { data } = JSON.parse(line) as { data?: { name?: unknown; deleted?: unknown; savedAt?: unknown } }
      if (data?.deleted === true && typeof data.name === 'string') deletedAt.set(data.name, Math.max(deletedAt.get(data.name) ?? 0, Number(data.savedAt) || 0))
    } catch {
      continue
    }
  }
  // a draft saved again on the Mac after the phone deleted it stays
  const doomed = (await refresh($)).filter(d => (deletedAt.get(d.name) ?? -1) >= d.mtimeMs)
  if (doomed.length === 0) return
  const moved = (await Promise.all(doomed.map(d => moveToTrash($, d)))).filter(r => r.exitCode === 0).length
  if (moved > 0) $.ui.toast(`Moved ${moved} draft${moved === 1 ? '' : 's'} deleted on the phone to the Trash`)
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

// Returns what happened, for /slack-drafts to say; failures also toast.
const syncPhone = async ($: EngineInterface, url: string, list: Draft[]): Promise<string> => {
  if (!url) return 'phone page off (set its URL in /config)'
  const synced = ((await $.store.get('synced')) ?? {}) as Record<string, number>
  const now = Date.now()
  const changed = list.filter(d => synced[d.name] !== d.mtimeMs)
  const gone = Object.keys(synced).filter(name => !list.some(d => d.name === name))
  if (changed.length === 0 && gone.length === 0) return 'phone page up to date'
  const writes = [
    ...changed.map(d => ({ op: 'set' as const, collection: 'drafts', doc_id: docId(d.name, now), data: { name: d.name, md: d.text, savedAt: d.mtimeMs } })),
    ...gone.map(name => ({ op: 'set' as const, collection: 'drafts', doc_id: docId(name, now), data: { name, deleted: true, savedAt: now } })),
  ]
  const r = await $.tool.call({ tool: 'ArtifactData', action: 'batch', url, writes })
  if (r.deny !== undefined || r.isError) {
    const why = (r.deny ?? r.text ?? 'no reason given').slice(0, 160)
    $.ui.toast(`Phone sync failed: ${why}`)
    return `phone sync failed: ${why}`
  }
  const next = Object.fromEntries(list.map(d => [d.name, d.mtimeMs]))
  await $.store.set('synced', next)
  return `sent ${writes.length} change${writes.length === 1 ? '' : 's'} to the phone page`
}

const open = ($: EngineInterface, focus: boolean) =>
  $.ui.open({ id: PANE, title: 'Slack drafts', closeOnEscape: true, ...(focus ? { focus: true as const } : {}) })

const startSlackDrafts = async ($: EngineInterface, url: string) => {
  await $.command.register({ name: 'slack-drafts', description: 'Show your Slack drafts in a pane and send new ones to the phone page' })
  await refresh($)
  // Each session holds its own list, so a save or delete made in another session
  // shows here on the next tick. ponytail: a 3s poll of one small folder; a file
  // watcher if the engine ever grows one
  $.clock.every(3_000, () => void refresh($).catch(() => undefined))
  // ponytail: a 30s read of the phone page's tombstones; a push if the db ever offers one to a mod
  $.clock.every(PULL_MS, () => void pullPhoneDeletes($, url, true).catch(() => undefined))
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
  const phoneUrl = String(options.phoneUrl ?? '')
  const showUsage = options.usageBars === true
  const showPet = options.pet === true

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    // one mod failing to start must not keep the others from starting
    const failed = (
      await Promise.allSettled([startSlackDrafts($, phoneUrl), showUsage && startUsageBars($), showPet && startPet($), nudgeVault($)])
    ).find(r => r.status === 'rejected')
    if (failed) throw failed.reason
    return ran
  })

  on('command.run', { command: 'slack-drafts' }, async $ => {
    await pullPhoneDeletes($, phoneUrl, false).catch(() => undefined)
    const list = await refresh($)
    await open($, true)
    const phone = await syncPhone($, phoneUrl, list)
    return { text: `${list.length} draft${list.length === 1 ? '' : 's'} in the pane, ${phone}.` }
  })

  // The one unmatched tool.call hook the engine allows, for both mods. The pet:
  // a question or a plan to approve blocks until its call resolves, and any call
  // clears a permission dialog's block on its tool. Slack drafts: a draft written
  // by any tool (Write, Edit, a Bash heredoc) refreshes the list, and a new or
  // changed one opens the pane.
  on('tool.call', async ($, e, next) => {
    const isDraft = e.tool !== 'ArtifactData' && JSON.stringify(e).includes('slack-drafts')
    if (!showPet && !isDraft) return next(e)
    if (showPet && (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode')) await block($, e.tool)
    // read before the tool runs, or the poll could see the new draft first and keep the pane shut
    const newest = isDraft ? ((await read($, drafts))[0]?.mtimeMs ?? 0) : 0
    let ran
    try {
      ran = await next(e)
    } finally {
      if (showPet) await unblock($, e.tool)
    }
    if (!isDraft) return ran
    const list = await refresh($)
    if ((list[0]?.mtimeMs ?? 0) > newest) void open($, false)
    await syncPhone($, phoneUrl, list)
    return ran
  }).catch(($, e, next) => next(e)) // never block a tool call; next replays its result

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
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
          const { body, where } = splitDraft(d.text)
          return (
            <Box key={`draft-${i}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
              <Box gap={2}>
                <Text bold wrap="truncate-end">{who}</Text>
                {when !== '' && <Text dimColor wrap="truncate-end">{when}</Text>}
              </Box>
              {where !== '' && <Markdown key={`where-${d.name}`} text={where} dimColor />}
              <Markdown text={body} />
              <Box gap={1} flexWrap="wrap">
                <Button key={`copy-${d.name}`} label="Copy for Slack" variant="primary" onPress={() => copyForSlack($, d)} />
                <Button key={`del-${d.name}`} label="Delete" plain dimColor onPress={() => trash($, d, phoneUrl)} />
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
      if (e.agentId === undefined) await unblock($)
      return next(e)
    })
  }

  // ponytail: off unless usageBars or pet is on; another plugin's band may own that spot
  if (showUsage) {
    on('session.measure', async ($, e, next) => {
      await saveUsage($, e)
      return next(e)
    })
  }

  if (showUsage || showPet) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)
      const s = showUsage ? await read($, snap) : null
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
        const used = s.fiveHour?.percentUsed ?? 0
        const left = Math.round(100 - used)
        const ctxTone = tone(ctxPct, 60, 85)
        const fiveTone = tone(used, 75, 90)
        const alert = (c: string) => (c === BLUE ? undefined : c)
        const fiveDetail =
          s.fiveHour === null ? 'no reading yet' : `left · resets in ${timeLeft(s.fiveHour.resetsAt, s.now)}`

        // ponytail: columns, not rows, so labels and bars line up on any font
        return (
          <Box gap={2}>
            <Box flexDirection="column">
              <Text dimColor>Context</Text>
              <Text dimColor>5-hour limit</Text>
            </Box>
            <Box flexDirection="column">
              {meter(ctxPct, ctxTone, `context ${ctxPct}% used`)}
              {meter(s.fiveHour === null ? 0 : left, fiveTone, `5-hour window ${left}% left`)}
            </Box>
            <Box flexDirection="column" alignItems="flex-end">
              <Text bold color={alert(ctxTone)}>
                {ctxPct}%
              </Text>
              <Text bold color={alert(fiveTone)}>
                {s.fiveHour === null ? '—' : `${left}%`}
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

      // ponytail: the pet gives way when the band is too narrow for both
      const petFits = mood !== null && (s === null || e.props.bodyColumns >= 84)
      // read only on the terminal, so the desktop's band never redraws on the tick
      const tick = petFits && Svg === null ? await read($, petTick) : 0

      return (
        <Box gap={2}>
          {s !== null && usage(s)}
          {petFits && (
            <Box key="pet" flexGrow={1} justifyContent="flex-end" alignItems="center" gap={1}>
              <Text bold={mood === 'blocked'} color={mood === 'blocked' ? petColor(mood) : undefined} dimColor={mood !== 'blocked'}>
                {CAPTION[mood]}
              </Text>
              {Svg ? (
                <Svg source={petSvg(mood)} alt={`Claude: ${CAPTION[mood].toLowerCase()}`} width={PET_PX.width} height={PET_PX.height} isInteractive />
              ) : (
                <Text color={petColor(mood)}>{petFrame(mood, tick)}</Text>
              )}
            </Box>
          )}
        </Box>
      )
    })
  }
}
