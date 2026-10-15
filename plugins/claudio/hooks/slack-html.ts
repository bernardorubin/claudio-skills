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
