import { expect, test } from 'claude-code/testing'

import { bar, timeLeft, tokens, tone } from './usage-bars'

test('bars, token counts and countdown format', async () => {
  expect(bar(0)).toBe('□'.repeat(20))
  expect(bar(9)).toBe('■■' + '□'.repeat(18))
  expect(bar(150)).toBe('■'.repeat(20))
  expect(tokens(90_100)).toBe('90.1K')
  expect(tokens(1_000_000)).toBe('1.0M')
  const now = Date.parse('2026-10-08T12:00:00Z')
  expect(timeLeft('2026-10-08T16:56:00Z', now)).toBe('4h 56m')
  expect(timeLeft('2026-10-08T12:05:00Z', now)).toBe('5m')
  expect(timeLeft(undefined, now)).toBe('resetting')
})

test('goes green, yellow, orange, red as each fills', async () => {
  // context: 40 / 60 / 85
  expect(tone(39, 40, 60, 85)).toBe('#a3be8c')
  expect(tone(40, 40, 60, 85)).toBe('#ebcb8b')
  expect(tone(60, 40, 60, 85)).toBe('#d08770')
  expect(tone(85, 40, 60, 85)).toBe('#bf616a')
  // 5-hour window, by % used: 50 / 75 / 90
  expect(tone(49, 50, 75, 90)).toBe('#a3be8c')
  expect(tone(50, 50, 75, 90)).toBe('#ebcb8b')
  expect(tone(75, 50, 75, 90)).toBe('#d08770')
  expect(tone(92, 50, 75, 90)).toBe('#bf616a')
})
