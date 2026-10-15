---
name: write-slack-message
description: >-
  Use when the user asks to draft, write, format, or compose a Slack message. Triggers
  on "write a slack message", "draft a slack post", "how should I phrase this for
  slack", "send this on slack", or any request to format text for Slack. Saves a copy-
  paste-ready draft to ~/Desktop/slack-drafts/ (shown in the /slack-drafts pane and
  on the Slack Drafts phone page), falling back to
  ~/Desktop/slack-message-for-<recipient>.md. With the Slack MCP connected it names
  where to post (linked so it opens in Slack) and who to tag; it never posts through
  the MCP. Never puts the draft in the chat.
---

# Write Slack Message

Write a Slack message that can be directly copy-pasted into Slack with proper formatting.

## If No Context Provided

If the user invokes this with no details, ask:
"What message do you want to write? (status update, question, sharing code, request)"

## Instructions

Based on the user's request, write a Slack message following these guidelines:

### Tone & Style
- **Business casual** - friendly but professional
- **Short and to the point** - this is Slack, not email
- **Conversational** - like talking to a coworker
- No "Dear X" or "Best regards" - just get to the point
- Use contractions naturally (I'm, we're, don't)
- Avoid corporate jargon and filler words
- **Never use em dashes (—) or en dashes (–)** - no human types those in Slack. Use commas, colons, or parentheses instead
- **Never use bold** - no `*bold*` / `**bold**` anywhere. Bold reads as corporate in casual Slack. Lean on short sentences and natural emphasis instead
- **Write words out, don't clip them** - "backwards-compatibility" not "back compat", "authentication" not "auth", "configuration" not "config" when you mean the concept. Established short forms that are the normal spoken name are fine (`repo`, `PR`, `API`, `CI`, `env var`). The test is whether you'd say the short form out loud to a coworker, not whether it saves characters. Clipping a word to save three letters reads as sloppy, not brisk
- **Never use `~` as shorthand for "approximately"** - write "about 40%", "around 40%", or just "40%", not `~40%`. The tilde as an approximation symbol is not a character this user would ever type. Strikethrough markdown (`~text~`) is still fine when strikethrough is actually the intent

### Formatting Rules (Slack-compatible)
- Use `` `code` `` for inline code, file names, commands, **and every technical identifier** — event/field/variable names, snake_case or camelCase tokens, repo names, IDs, env vars, template strings (e.g. `event_id`, `user_id`, `in_check`, `acme-api`, `registration_complete_{{DL - foo}}`, `META_CAPI_ACCESS_TOKEN`). Rule of thumb: if it's a token the code/system would recognize rather than a plain English word, backtick it. Leaving identifiers as bare prose is the most common drift — scan every draft for them before saving.
- Use ``` for code blocks (triple backticks)
- Use `>` for quotes only when quoting someone
- Avoid excessive bullet points - Slack is conversational
- No headers or complex markdown - keep it flat
- No bold, no em/en dashes, no `~` as an approximation shorthand (see Tone & Style rules above)
- Emojis are fine but don't overdo it

### Links — ALWAYS use markdown link syntax with descriptive label text

**Never paste a bare URL into a Slack message.** Slack renders markdown links nicely when pasted from a `.md` file, so use them every time. The label should be the recognizable identifier, not the raw URL.

**Jira tickets (most common case):** format as `[TICKET-KEY](full-url)` — the ticket key is the label, the full Atlassian URL is the href. Every occurrence of a ticket key in the message body should be a link, not just the first mention.

```
✅ Good: [ACME-5876](https://yourorg.atlassian.net/browse/ACME-5876) is in Ready for QA
❌ Bad:  ACME-5876 is in Ready for QA (no link, recipient has to copy-paste to find it)
❌ Bad:  https://yourorg.atlassian.net/browse/ACME-5876 is in Ready for QA (ugly raw URL)
❌ Bad:  ticket ACME-5876 https://yourorg.atlassian.net/browse/ACME-5876 (redundant — key AND URL)
```

**Other links** (PRs, docs, dashboards, etc.) — same rule, use descriptive label text:

```
✅ Good: [PR #605](https://github.com/...) is merged
✅ Good: see the [GA4 DebugView](https://analytics.google.com/...) for live events
❌ Bad:  see https://analytics.google.com/analytics/web/?... for live events
```

**The one exception:** if the URL itself is the point (e.g., "send me the staging URL"), pasting it bare is fine. But if there's a meaningful label, use it.

Worth being persnickety about this — bare URLs in Slack look careless, and unlinked ticket keys force the reader to manually search Jira to follow up. The markdown link format is two extra characters of typing for a much better recipient experience.

### Include a link whenever the reader would want to check the claim

The rule above is about *formatting* links you already decided to include. This one is about **including them in the first place**, and it is the half that gets forgotten.

Any claim about a live system carries a link to the thing itself, so the reader can confirm it in one click instead of taking your word for it or hunting for it:

- "X is broken on production" → link the page where it is broken.
- "I fixed X" → link the page where it is now fixed.
- "the value is wrong in Sanity / Vercel / Customer.io / GTM" → link the document, project or dashboard.
- Naming a ticket, a PR, a build or a partner → link it, every occurrence.
- Quoting a number from a dashboard → link the view that shows the number.

This is the difference between a message someone has to trust and a message someone can verify. A reply saying a fix is live is materially weaker without the URL, and asking a teammate to fix a record without linking that record makes them do the lookup you already did.

The test: for each factual claim, ask whether the reader could reasonably want to see it. If yes and a URL exists, it goes in. If no URL exists (a code path, a log line already quoted), say so rather than leaving a claim that looks checkable but isn't.

### Message Structure
- Lead with the key point or ask
- Keep paragraphs to 1-3 sentences max
- If sharing code, put it in a code block with no extra explanation needed
- End with clear next step or question if needed

### Code Snippets
When including code, format exactly like this (copy-pasteable to Slack):
```
code here
```

### Length — content sets it, not a counter

No sentence limit. An incident summary is longer than a question; padding the
question is the same mistake as truncating the summary. Test each sentence, not
the message:

**Would deleting this sentence change what the reader does next?** No → delete it.

Cut on sight, no exceptions:
- Any sentence explaining WHY you did it, unless someone asked
- Any recap of what the reader already knows (the thread, the ticket, yesterday's message)
- Any hedge or softener ("wanted to flag", "just circling back", "let me know if", "happy to")
- Any detail that lives in a linked PR / ticket / doc. Link it instead
- Any supporting evidence for a question. Ask the question; hold the evidence for the reply

**When a companion doc exists** (a handoff, a PR, a ticket, an `.md` file), the
message is a pointer, not a summary. Say what the doc is, plus the two or three
things the recipient needs at a glance. The detail lives in the doc.

**One job per message.** Never hedge a decision to fill space: state what you did,
or ask the question. "I did X, but it's easy to revert if you'd rather Y" is both
at once and reads as wishy-washy. If there's a real open question, ask it plainly,
address it to the one person who can settle it, and let the rest stay short.

### Two registers: tiny (default) and full (on request)

**Tiny is the default.** The ask or the answer, nothing else. No context, no
rationale, no recommendation, no evidence — even when you have all of it and it is
good. A question message is the question. A status message is the status. A
question needs only enough for the reader to know which question it is; the
evidence behind it belongs in your reply to them, not in the ask.

**Full is opt-in.** Switch registers only when the user asks for it in their own
words — "normal", "full", "longer", "detailed", "the long version", "with
context", "explain the why" — or when the message is inherently multi-item (a
multi-ticket ship update, an incident writeup, a release summary).

Full is still concise. It is not tiny plus prose. It is: one sentence naming the
topic, then one line per item, then one @person call-out per paragraph where that
person has to act. No narration between items, no closing summary. Every
cut-on-sight rule above still applies — full buys you more items, not more words
per item.

Past that, it needs a linked doc, not more sentences.

**Before saving, cut it — mandatory, and it always finds something.** Read the
draft and ask, per sentence, whether deleting it changes what the reader does
next. Delete every sentence where the answer is no.

**After saving, list in one line what you cut**, so the user can add anything back
without a redraft. This matters more under the tiny default than it did before:
tiny cuts real content on purpose, and that line is the only way it comes back.
Never preemptively keep something because they might want it.

## Where it goes and who to tag (Slack MCP connected)

When this session has the Slack MCP (`slack_search_users` and friends, loaded or
deferred), use it to read, never to post. The user pastes every message
themselves: anything posted through the MCP (`slack_send_message`,
`slack_schedule_message`, `slack_send_message_draft`, its card) is stamped "Sent
using Claude", which they don't want. Those tools may also be denied in their
settings; don't try them.

**Name the place, never "everyone".** First match wins:
1. A Slack link the user gave for this message: that thread or channel.
2. The thread or channel this conversation is plainly about (a pasted thread).
3. One person and no channel: a DM to them.
4. A channel named: find it with `slack_search_channels`.

Still not sure, ask in one line ("DM Nick, or reply in the #hpy-api thread?").

**Link it, so one click opens it in Slack.** Use the permalinks the read tools
return:
- Thread or message: the link the user gave, or the permalink from
  `slack_search_public`. `slack_search_public_and_private` reaches DMs and private
  channels, but ask the user before using it (its own description requires that).
- Channel: the `Permalink` from `slack_search_channels`.
- DM: the person's `Permalink` from `slack_search_users`. It opens their profile,
  where Message is one click.

**Every `@person` resolves to one real person.** Look each one up with
`slack_search_users`. Several match: keep the one who is in the destination
(`slack_list_channel_members`); still several or none, ask. Write `@` plus the
name Slack autocompletes for them. A pasted `@name` may stay plain text, so the
report line names each person to tag, linked to their profile, and they retype `@`
and pick that person.

## Output

1. **Where to save — the folder decides.** Check once with `test -d`, then:
   - `SLACK_DRAFTS_DIR` is set, or `~/Desktop/slack-drafts/` exists → save to
     `<dir>/<recipient>-<MMDD-HHMM>.md`. Drafts accumulate, so rewriting a
     message never destroys the version it replaces.

     **Then clear what it supersedes.** If this draft replaces an earlier one to
     the same recipient in the folder (a redraft, or a new message that covers
     everything the old one said), move the old file to `~/.Trash/` after
     saving, as the pane's Delete does. Keep drafts on another topic and any the
     user said they already sent. Name each removal in the report line: "Saved
     grace-1008-2353.md, removed grace-1008-2155.md (superseded)".
   - Neither → save to `~/Desktop/slack-message-for-<recipient>.md`, overwriting
     any previous draft for that person. This is the default and needs no setup.

   **Never create the folder yourself.** Its existence IS the user's opt-in;
   creating it silently changes where every future draft lands.

   **In default mode, say so when you overwrite.** If the target file already
   exists you are about to destroy a previous draft, so add one clause to the
   report line: what it replaced, and that `mkdir ~/Desktop/slack-drafts` keeps
   both from here on. This is the only place that hint appears — no prompt, no
   onboarding, no state tracking. It fires when the overwrite actually costs
   something, stays silent on a first draft for that person, and never fires
   again once the folder exists.
2. **`<recipient>`**: first name, lowercase (`dmytro`), or the channel name
   (`hpy-eng`) for a channel or thread post. Several people named? Use the one
   who has to act. `everyone` only when there's no Slack MCP to find the channel.
   No dates, no ticket keys, no full sentences in the filename.
3. The file contains ONLY the Slack message, no preamble or instructions.
4. **The file IS the delivery. Never paste the draft into the chat reply.** Say
   it's saved, give the path, stop. Pasting it inline makes the user read the
   same message twice. With the Slack MCP, the report line also says where to
   post it and who to tag, both linked: "Saved nick-1014-1530.md. Reply in the
   [#hpy-api thread on PR 2886](https://…/p1760467200123456); tag
   [Nick Conn](https://…/team/U081C53KT0T)."
5. **Start nothing.** In folder mode this plugin's `/slack-drafts` pane
   sees the save, opens its pane and sends the draft to the phone page on its
   own. Mention `/slack-drafts` once in the report line only if the user seems
   not to know where drafts show up.
6. Below that, one line naming what you cut, so they can add it back.

### On a phone -- link the Slack Drafts page

The draft never goes in the chat, on any device: no code block, no inline copy.
Saving it is what sends it to the `/slack-drafts` pane on the desktop and to
the Slack Drafts phone page, whose Copy for Slack keeps links and code.

So when the user says they are on their phone, on the road, or away from their
laptop, save exactly as above and change only the report line: link the phone
page instead of giving the path. Its URL is the plugin's `phoneUrl` option:

```bash
jq -r '.pluginConfigs["claudio@claudio"].options.phoneUrl // empty' ~/.claude/settings.json
```

Empty means no phone page is set up: say the draft is saved and that the phone
page needs its one-time setup (the plugin README's Mods section). The page only
receives drafts saved in folder mode.

### Browsing past drafts (optional)

This plugin's `/slack-drafts` pane shows them: it
lists every draft newest first, with Copy for Slack (an HTML
clipboard copy, so `[label](url)` pastes as a real link) and delete. On the phone, its pinned Slack Drafts page does the same. Mention it only if
the user asks how to find an older draft; the drafting flow above must work
unchanged without it.

## Reference examples

### The default shape — short

Most messages look like this. A real review request doing two jobs (a review ask for the engineers, an open question for the analytics owner) in two short paragraphs:

```
@jordan @sam review when you get a chance: [PR #423](https://github.com/org/repo/pull/423), [ACME-6236](https://yourorg.atlassian.net/browse/ACME-6236). Unattributed checkout traffic moves off `house_brand` to the PRD's fallback: `partner_name` `Unknown`, `program` `Direct`, `line_of_business` `DTC`, `partner_id` null. One handler file plus tests, CI green.

@riley one question: the PRD names `partner_name` but not `partner`, its backwards-compatibility alias. Should `partner` move to `Unknown` too, or stay `house_brand` so your saved reports keep matching? One line either way.
```

Why it works: the ask is the first four words. The change is one sentence of concrete values, not a paragraph of narration. The open question is asked plainly instead of pre-answered with a hedge, and it goes to the one person who can settle it. Nothing explains reasoning the reader didn't ask for.

### When a message genuinely carries more

Multi-ticket ship updates, incident summaries, anything with several audiences: it still leads with one sentence naming the topic, then a numbered list of one line per item, then one `@person` call-out per paragraph where that person has to act. No narration between items, no closing summary. Past that, the extra content belongs in a linked doc or ticket, not the message.

There is deliberately no long example here. Long examples get pattern-matched into every draft, which is how messages got verbose in the first place.

