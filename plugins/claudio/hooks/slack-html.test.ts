import { expect, test } from 'claude-code/testing'

import { clipboardScript, labelOf, toHtml } from './slack-html'

test('converts the skill vocabulary to Slack HTML', async () => {
  const got = toHtml('see [HPY-1](https://x.test) and `a<b`\n\n- one\n- two\n\n```\nx=1\n```')
  expect(got).toContain('<a href="https://x.test">HPY-1</a>')
  expect(got).toContain('<code>a&lt;b</code>')
  expect(got).toContain('<ul><li>one</li><li>two</li></ul>')
  expect(got).toContain('<pre><code>x=1</code></pre>')
  expect(toHtml('`[x](https://y.test)`')).not.toContain('<a')
  expect(toHtml('1. first\n\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>')
  expect(toHtml('- a\n\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
  expect(toHtml('1. a\n\nafter')).toBe('<ol><li>a</li></ol><p>after</p>')
  expect(toHtml('[q](https://x.test/?a=1&b=2)')).toBe('<p><a href="https://x.test/?a=1&amp;b=2">q</a></p>')
})

test('builds the clipboard script and labels', async () => {
  const s = clipboardScript('say "hi"\nthere')
  expect(s).toContain('«data HTML3c703e')
  expect(s).toContain('string:"say \\"hi\\"" & linefeed & "there"}')
  expect(labelOf('dmytro-1008-1320.md')).toEqual({ who: 'dmytro', when: 'Oct 8, 13:20' })
  expect(labelOf('notes.md')).toEqual({ who: 'notes', when: '' })
})
