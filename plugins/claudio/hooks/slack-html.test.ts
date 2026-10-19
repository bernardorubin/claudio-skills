import { expect, test } from 'claude-code/testing'

import { clipboardScript, labelOf, mentionBlocks, splitDraft, toHtml, toPlain } from './slack-html'

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

test('flattens for a plain-text paste on the phone', async () => {
  const flat = toPlain('see [HPY-1](https://x.test) now\n\n> quoted\n\n```\nx=1\n```\n- a `tok`')
  expect(flat).toContain('https://x.test')
  expect(flat).not.toContain('[HPY-1]')
  expect(flat).toContain('quoted')
  expect(flat).not.toContain('>')
  expect(flat).toContain('x=1')
  expect(flat).not.toContain('```')
  expect(flat).not.toContain('`')
  expect(flat).toContain('- a tok')
  expect(toPlain('`[x](https://y.test)`').trim()).toBe('[x](https://y.test)')
})

test('splits @mention lines into colored runs for the pane', async () => {
  expect(mentionBlocks('no tags, mail bern@x.test or `@kept`')).toEqual([{ md: 'no tags, mail bern@x.test or `@kept`' }])
  expect(mentionBlocks('@chuy see [HPY-1](https://x.test), `pay` (@jesus.garcia).')).toEqual([
    {
      prefix: '',
      runs: [
        { text: '@chuy', kind: 'mention' },
        { text: ' see ' },
        { text: 'HPY-1', kind: 'link', href: 'https://x.test' },
        { text: ', ' },
        { text: 'pay', kind: 'code' },
        { text: ' (' },
        { text: '@jesus.garcia', kind: 'mention' },
        { text: ').' },
      ],
    },
  ])
  const blocks = mentionBlocks('intro\n\n2. waiting on @Dmytro\n> @here hi\n```\n@inside\n```')
  expect(blocks.map(b => ('md' in b ? b.md : b.prefix))).toEqual(['intro\n', '2. ', '│ ', '```\n@inside\n```'])
})

test('splits where to post from the message', async () => {
  const md = '---\npost_in: [#eng thread](https://x.test/p1)\ntag: [Nick](https://x.test/team/U1)\n---\n\n@Nick fixed'
  expect(splitDraft(md)).toEqual({ body: '@Nick fixed', where: 'Post in [#eng thread](https://x.test/p1)\n\nTag [Nick](https://x.test/team/U1)' })
  expect(splitDraft('no header')).toEqual({ body: 'no header', where: '' })
})
