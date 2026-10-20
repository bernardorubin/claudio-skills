// Is a newer claudio published than the one installed? Its hooks live in register.tsx.

export const MARKET_URL = 'https://raw.githubusercontent.com/bernardorubin/claudio-skills/main/.claude-plugin/marketplace.json'

const parts = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0)

// Numeric x.y.z, so 4.17.10 is newer than 4.17.9; anything unreadable is never newer.
export const isNewer = (latest: unknown, installed: unknown) => {
  if (typeof latest !== 'string' || typeof installed !== 'string') return false
  const [a, b] = [parts(latest), parts(installed)]
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

// The claudio entry's version in the published marketplace.json, or null.
export const publishedVersion = (text: string): string | null => {
  try {
    const { plugins } = JSON.parse(text) as { plugins?: { name?: unknown; version?: unknown }[] }
    const v = plugins?.find(p => p.name === 'claudio')?.version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export const updateNote = (version: string) => `claudio ${version} is out: run /update-claudio, or turn on auto-update in /plugin`
