// Markdown to Slack HTML, only for the vocabulary write-slack-message emits
// (links, inline code, fences, blockquotes, lists, paragraphs). Slack reads the HTML
// flavor on paste, which is what keeps [label](url) links working.

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g
const CODE_SPAN = /`([^`]+)`/

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inline = (text: string) =>
  text
    .split(CODE_SPAN)
    .map((part, i) =>
      i % 2
        ? `<code>${escape(part)}</code>`
        : escape(part).replace(LINK, (_, label: string, url: string) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`),
    )
    .join('')

export const toHtml = (md: string) => {
  const out: string[] = []
  let listTag: 'ol' | 'ul' | null = null
  let inCode = false
  let code: string[] = []
  const closeList = () => {
    if (listTag) out.push(`</${listTag}>`)
    listTag = null
  }
  const flushCode = () => out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode()
        code = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(raw)
      continue
    }
    // a blank line does not close a list: a loose list is still one list
    if (!line.trim()) continue
    if (line.startsWith('>')) {
      closeList()
      out.push(`<blockquote>${inline(line.replace(/^[> ]+/, ''))}</blockquote>`)
      continue
    }
    const item = /^\d+\.\s+(.*)/.exec(line) ?? /^[-*]\s+(.*)/.exec(line)
    if (item) {
      const want = /^\d/.test(line) ? 'ol' : 'ul'
      if (listTag !== want) {
        closeList()
        out.push(`<${want}>`)
        listTag = want
      }
      out.push(`<li>${inline(item[1] ?? '')}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  if (inCode) flushCode()
  closeList()
  return out.join('')
}

// Pane display only: a typed @name pastes into Slack as plain text, not a tag, so the pane
// colors each one to be re-tagged after pasting. Markdown cannot color a word, so a line
// with a mention becomes Text runs (its list or quote marker as `prefix`) and every other
// line stays Markdown. Emails, code spans and fences are left alone.
const MENTION = /(?<=^|[\s(])(@\w+(?:[.-]\w+)*)/
const MARKER = /^(\s*(?:\d+\.\s+|[-*]\s+|>\s?))?(.*)$/
export type Run = { text: string; kind?: 'mention' | 'code' | 'link'; href?: string }
export type Block = { md: string } | { prefix: string; runs: Run[] }

const runsOf = (line: string): Run[] =>
  line
    .split(CODE_SPAN)
    .flatMap((part, i): Run[] => {
      if (i % 2) return [{ text: part, kind: 'code' }]
      const bits = part.split(LINK) // text, label, url, text, ...
      return bits.flatMap((bit, j): Run[] =>
        j % 3 === 1
          ? [{ text: bit, kind: 'link', href: bits[j + 1] ?? '' }]
          : j % 3 === 2
            ? []
            : bit.split(MENTION).map((text, k): Run => (k % 2 ? { text, kind: 'mention' } : { text })),
      )
    })
    .filter(r => r.text !== '')

const bullet = (mark: string) => {
  const m = mark.trim()
  return m === '' ? '' : m === '>' ? '│ ' : /\d/.test(m) ? `${m} ` : '• '
}

export const mentionBlocks = (md: string): Block[] => {
  const out: Block[] = []
  let buf: string[] = []
  let inCode = false
  const flush = () => {
    if (buf.join('').trim()) out.push({ md: buf.join('\n') })
    buf = []
  }
  for (const line of md.split(/\r?\n/)) {
    const fence = line.trimStart().startsWith('```')
    if (fence) inCode = !inCode
    if (inCode || fence || !line.split(CODE_SPAN).some((p, i) => i % 2 === 0 && MENTION.test(p))) {
      buf.push(line)
      continue
    }
    flush()
    const [, mark = '', rest = ''] = MARKER.exec(line) ?? []
    out.push({ prefix: bullet(mark), runs: runsOf(rest) })
  }
  flush()
  return out
}

// Markdown to plain text, for a plain-text paste (the phone), where iOS Slack
// converts nothing. Links collapse to the bare URL, fence/quote markers and backticks go.
export const toPlain = (md: string) => {
  const out: string[] = []
  let inCode = false
  for (const raw of md.split(/\r?\n/)) {
    if (raw.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push(raw)
      continue
    }
    const line = raw.replace(/^(\s*)>\s?/, '$1')
    out.push(
      line
        .split(CODE_SPAN)
        .map((part, i) => (i % 2 ? part : part.replace(LINK, (_, _label: string, url: string) => url)))
        .join(''),
    )
  }
  return out.join('\n').trim() + '\n'
}

// write-slack-message may open a draft with where to post it and who to tag:
//   ---
//   post_in: [#hpy-api thread on PR 2886](https://x.slack.com/archives/C1/p1760467200123456)
//   tag: [Nick Conn](https://x.slack.com/team/U081C53KT0T)
//   ---
// `where` is those lines as Markdown for the pane and the phone page; `body` is the
// message alone, the only part a copy takes.
const HEADER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
export const splitDraft = (md: string) => {
  const m = HEADER.exec(md)
  if (!m) return { body: md, where: '' }
  const where = (m[1] ?? '')
    .split(/\r?\n/)
    .flatMap(line => {
      const kv = /^(post_in|tag):\s*(.+)$/.exec(line.trim())
      return kv ? [`${kv[1] === 'tag' ? 'Tag' : 'Post in'} ${kv[2]}`] : []
    })
    .join('\n\n')
  return { body: md.slice(m[0].length).replace(/^\s*\n/, ''), where }
}

const hex = (s: string) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, '0')).join('')

const literal = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '" & linefeed & "') + '"'

// Sets the clipboard's HTML flavor (for Slack) and its plain string together.
export const clipboardScript = (md: string) =>
  `set the clipboard to {«class HTML»:«data HTML${hex(toHtml(md))}», string:${literal(md)}}`

// "dmytro-1008-1320.md" -> { who: "dmytro", when: "Oct 8, 13:20" }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const labelOf = (name: string) => {
  const m = /^(.*)-(\d{2})(\d{2})-(\d{2})(\d{2})\.md$/.exec(name)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month
    ? { who: m[1] ?? name, when: `${month} ${Number(m[3])}, ${m[4]}:${m[5]}` }
    : { who: name.replace(/\.md$/, ''), when: '' }
}
