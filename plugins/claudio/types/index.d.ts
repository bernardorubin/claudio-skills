// Where a draft goes when the pane sends it (see hooks/slack-send.ts)
export type SlackTarget = { server: string; channel: string; thread?: string; to: string; mentions: Record<string, string> }

// text is the message alone, front matter stripped
export type Draft = { name: string; path: string; mtimeMs: number; text: string; slack?: SlackTarget }

export type UsageSnap = {
  context: { tokens?: number; window: number; percent?: number }
  fiveHour: { kind: string; percentUsed: number; resetsAt?: string } | null
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'claudio': { drafts: Draft[]; snap: UsageSnap | null }
  }
}
