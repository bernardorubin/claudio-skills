export type Draft = { name: string; path: string; mtimeMs: number; text: string }

export type UsageSnap = {
  context: { tokens?: number; window: number; percent?: number }
  fiveHour: { kind: string; percentUsed: number; resetsAt?: string } | null
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'claudio': { drafts: Draft[]; snap: UsageSnap | null; blocked: string | null; tick: number; tool: string | null; plays: number }
  }
}
