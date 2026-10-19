// The usage band's drawing helpers; its hooks live in register.tsx.

const WIDTH = 20
export const GREEN = '#a3be8c'
const YELLOW = '#ebcb8b'
const ORANGE = '#d08770'
const RED = '#bf616a'

export const bar = (pct: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * WIDTH)
  return '■'.repeat(filled) + '□'.repeat(WIDTH - filled)
}

export const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

export const timeLeft = (resetsAt: string | undefined, now: number) => {
  const ms = resetsAt ? Date.parse(resetsAt) - now : NaN
  if (!(ms > 0)) return 'resetting'
  const m = Math.ceil(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export const tone = (pct: number, caution: number, warn: number, crit: number) =>
  pct >= crit ? RED : pct >= warn ? ORANGE : pct >= caution ? YELLOW : GREEN

export const BAR_PX = 160
export const ROW_PX = 18
export const svgBar = (pct: number, color: string) => {
  const fill = Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR_PX)
  const rect = (w: number, opacity: number) =>
    `<rect x="0" y="${(ROW_PX - 6) / 2}" width="${w}" height="6" rx="3" fill="${color}" fill-opacity="${opacity}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_PX}" height="${ROW_PX}" viewBox="0 0 ${BAR_PX} ${ROW_PX}">${rect(BAR_PX, 0.22)}${fill > 0 ? rect(Math.max(fill, 6), 1) : ''}</svg>`
}
