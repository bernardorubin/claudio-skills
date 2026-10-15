import type { SlackTarget } from '../types'

// write-slack-message adds this front matter when the Slack MCP is connected, so
// the pane can send the draft itself:
//
//   ---
//   slack_server: 9d6ac2ae-94d5-4dc8-b91f-2e941e95e9e3   (as the MCP tool names spell it)
//   slack_channel: C0123ABCD                            (or a user ID, for a DM)
//   slack_thread: 1760467200.123456                     (optional: reply in that thread)
//   slack_to: #hpy-eng, thread on PR 2886               (what the pane shows)
//   slack_mentions: @Nick=U0456DEF, @Grace=U0789GHI
//   ---
export const parseDraft = (raw: string): { body: string; slack?: SlackTarget } => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  if (!m) return { body: raw }
  const body = raw.slice(m[0].length).replace(/^\s*\n/, '')
  const f: Record<string, string> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) f[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const { slack_server: server, slack_channel: channel, slack_thread: thread } = f
  if (!server || !channel) return { body }
  const mentions: Record<string, string> = {}
  for (const pair of (f.slack_mentions ?? '').split(',')) {
    const [name = '', id = ''] = pair.split('=').map(s => s.trim())
    if (name && id) mentions[name.startsWith('@') ? name : `@${name}`] = id
  }
  return { body, slack: { server, channel, ...(thread ? { thread } : {}), to: f.slack_to || channel, mentions } }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// "@Nick" -> "<@U0456DEF>", the only spelling Slack turns into a real (blue) mention.
// Leaves "@Nicky" and "nick@x.com" alone.
export const withMentions = (body: string, mentions: Record<string, string>) =>
  Object.entries(mentions).reduce(
    (text, [name, id]) => text.replace(new RegExp(`(?<![\\w.])${escapeRe(name)}(?![\\w-])`, 'g'), `<@${id}>`),
    body,
  )
