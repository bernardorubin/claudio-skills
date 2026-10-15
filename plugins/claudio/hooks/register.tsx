import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Draft, UsageSnap } from '../types'
import { clipboardScript, labelOf } from './slack-html'
import { parseDraft, withMentions } from './slack-send'
import { BAR_PX, BLUE, ROW_PX, bar, svgBar, timeLeft, tokens, tone } from './usage-bars'

// Two mods in one module: the engine loads one hooks module per plugin, allows
// one unmatched session.start hook, and never follows $ across an import, so
// every hook and every helper that takes $ lives here.

// ── slack-drafts: the /slack-drafts pane ──

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
    mds.map(async f => {
      const { body, slack } = parseDraft(await $.fs.read(`${dir}/${f.name}`))
      return { name: f.name, path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs, text: body, ...(slack ? { slack } : {}) }
    }),
  )
  await update($, drafts, () => list)
  return list
}

const copyForSlack = async ($: EngineInterface, d: Draft) => {
  const rich = await $.process.run(['osascript', '-e', clipboardScript(d.text)]).catch(() => null)
  if (rich?.exitCode === 0) return $.ui.toast(`Copied ${labelOf(d.name).who} draft for Slack`)
  await $.process.run(['pbcopy'], { stdin: d.text })
  $.ui.toast('Copied as plain text (the Slack-safe copy failed)')
}

// ponytail: moved to ~/.Trash, not unlinked, so a misclick is recoverable from Finder
// sentTo: where the draft just went, so one toast says both
const trash = async ($: EngineInterface, d: Draft, sentTo?: string) => {
  const to = `${await home($)}/.Trash/${d.name.replace(/\.md$/, '')} ${Date.now()}.md`
  const r = await $.process.run(['mv', d.path, to])
  const head = sentTo ? `Sent to ${sentTo}` : ''
  $.ui.toast(
    r.exitCode === 0
      ? head || `Moved ${d.name} to the Trash`
      : `${head ? `${head}, but could` : 'Could'} not move ${d.name} to the Trash: ${r.stderr.trim()}`,
  )
  await refresh($)
}

// Paths already sent, so a second press (or a draft the Trash refused) never posts twice.
// ponytail: module memory, so a mod reload forgets it; the sent draft is in the Trash by then
const sent = new Set<string>()

// The click asks for the send; the person's permission rules decide it. A
// `permissions.ask` rule on slack_send_message puts it to a dialog in every mode;
// without one, auto mode's classifier refuses it (no prompt asked for it) and the
// toast says so.
const sendToSlack = async ($: EngineInterface, d: Draft) => {
  const s = d.slack
  if (!s) return
  if (sent.has(d.path)) return $.ui.toast(`Already sent to ${s.to}`)
  sent.add(d.path)
  const r = await $.mcp
    .call(s.server, 'slack_send_message', {
      channel_id: s.channel,
      message: withMentions(d.text, s.mentions),
      ...(s.thread ? { thread_ts: s.thread } : {}),
    })
    .catch((err: unknown) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }))
  if (r.isError) {
    sent.delete(d.path)
    const why = r.content.map(b => b.text ?? '').join(' ').trim()
    return $.ui.toast(
      /classifier/i.test(why)
        ? 'Not sent: auto mode cannot approve a send from the pane. Add the Slack ask rule (write-slack-message offers it) and Send will ask you instead.'
        : `Not sent: ${why.slice(0, 160) || 'no reason given'}. Copy for Slack still works.`,
    )
  }
  await trash($, d, s.to)
}

const open = ($: EngineInterface, focus: boolean) =>
  $.ui.open({ id: PANE, title: 'Slack drafts', closeOnEscape: true, ...(focus ? { focus: true as const } : {}) })

const startSlackDrafts = async ($: EngineInterface) => {
  await $.command.register({ name: 'slack-drafts', description: 'Show your Slack drafts in a pane' })
  await refresh($)
  // Each session holds its own list, so a save or delete made in another session
  // shows here on the next tick. ponytail: a 3s poll of one small folder; a file
  // watcher if the engine ever grows one
  $.clock.every(3_000, () => void refresh($).catch(() => undefined))
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

export const register: Register = (on, options) => {
  const showUsage = options.usageBars === true

  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    // one mod failing to start must not keep the others from starting
    const failed = (await Promise.allSettled([startSlackDrafts($), showUsage && startUsageBars($), nudgeVault($)])).find(r => r.status === 'rejected')
    if (failed) throw failed.reason
    return ran
  })

  on('command.run', { command: 'slack-drafts' }, async $ => {
    const list = await refresh($)
    await open($, true)
    return { text: `${list.length} draft${list.length === 1 ? '' : 's'} in the pane.` }
  })

  // A draft written by any tool (Write, Edit, a Bash heredoc) refreshes the list,
  // and a new or changed one opens the pane.
  on('tool.call', async ($, e, next) => {
    if (!JSON.stringify(e).includes('slack-drafts')) return next(e)
    // read before the tool runs, or the poll could see the new draft first and keep the pane shut
    const newest = (await read($, drafts))[0]?.mtimeMs ?? 0
    const ran = await next(e)
    const list = await refresh($)
    if ((list[0]?.mtimeMs ?? 0) > newest) void open($, false)
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
          return (
            <Box key={`draft-${i}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
              <Box gap={2}>
                <Text bold wrap="truncate-end">{who}</Text>
                {when !== '' && <Text dimColor wrap="truncate-end">{when}</Text>}
              </Box>
              {d.slack && <Text dimColor wrap="truncate-end">To {d.slack.to}</Text>}
              <Markdown text={d.text} />
              <Box gap={1} flexWrap="wrap">
                {d.slack && <Button key={`send-${d.name}`} label="Send to Slack" variant="primary" onPress={() => sendToSlack($, d)} />}
                <Button key={`copy-${d.name}`} label="Copy for Slack" {...(d.slack ? {} : { variant: 'primary' as const })} onPress={() => copyForSlack($, d)} />
                <Button key={`del-${d.name}`} label="Delete" plain dimColor onPress={() => trash($, d)} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  // ponytail: off unless the usageBars option is on; another plugin's band may own that spot
  if (showUsage) {
    on('session.measure', async ($, e, next) => {
      await saveUsage($, e)
      return next(e)
    })

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const s = await read($, snap)
      if (e.props.hasSurvey || s === null) return next(e)

      const els = $.ui.resolve(e)
      const { Box, Text } = els
      const meter = (pct: number, color: string, alt: string) =>
        'Svg' in els ? (
          <els.Svg source={svgBar(pct, color)} alt={alt} width={BAR_PX} height={ROW_PX} />
        ) : (
          <Text color={color}>{bar(pct)}</Text>
        )

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
    })
  }
}
