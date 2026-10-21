---
name: jira-cli
description: Use when the user mentions a Jira ticket, pastes a Jira URL (e.g. https://yourorg.atlassian.net/browse/ABC-123), pastes a ticket key (ACME-1234, WEB-456, ABC-789), or asks to read, update, comment on, transition, assign, link, or search Jira issues. Triggers on phrases like "work on this jira ticket", "update the description in jira", "add a comment to ABC-123", "what's the status of WEB-456", "move this to in progress", "find tickets assigned to me". Wraps the `jira-curl` CLI.
allowed-tools: Bash(jira-curl:*), Bash(jq:*), Bash(cat:*), Bash(command:*), Bash(bash:*), Bash(python3:*), Bash(ls:*)
---

# Jira CLI

Talk to Jira from the shell via `jira-curl`, an authenticated wrapper around the Jira REST API v3. Supports multiple Jira instances per machine.

> ## ⛔️ Non-negotiable writing rule
>
> **NEVER use an em dash (`—`, U+2014) or en dash (`–`, U+2013) in ANYTHING you POST or PUT to Jira.** Not in descriptions, not in comments, not in summaries, not in headings, not in code-block captions, not in inline parentheticals. Use a comma, colon, period, or parentheses instead. If you reach for an em dash to join two clauses, split them into two sentences.
>
> This rule has zero exceptions. The author types on a standard US keyboard and never produces these characters naturally; their presence is an immediate tell that an LLM drafted the text sloppily and didn't proofread.
>
> Before every `POST /rest/api/3/issue`, `PUT /rest/api/3/issue/<KEY>`, or `POST /rest/api/3/issue/<KEY>/comment`, **you MUST run this check on the payload file** and only proceed if it returns zero:
>
> ```bash
> python3 -c "import sys; data = open('PAYLOAD_FILE').read(); print(sum(data.count(c) for c in ['—','–']))"
> ```
>
> If the result is non-zero, rewrite the offending text before sending. Do not relax the rule. Do not ship the payload. See the full "Output style" section below for the rationale and rewrite examples.

> **Note on examples**: the API examples below use `acme` and `work` as placeholder instance names. When you set up your own with `jira-curl init <name>`, pick whatever names make sense (`work`, `personal`, etc.) and substitute them throughout — the actual API URLs and JSON payloads are identical.

## ⚠️ Preflight — run BEFORE any `jira-curl <instance>` API call

You MUST resolve binary + instance before making any API call. Skipping this and falling back on retry-after-failure produces confusing errors. Run these two checks in order, every time:

### 1. Make sure `jira-curl` is on PATH

```bash
command -v jira-curl >/dev/null 2>&1 || bash "$(ls -dt ~/.claude/plugins/cache/*/claudio/*/skills/jira-cli/scripts/jira-curl 2>/dev/null | head -1)" install
```

This is idempotent. The script self-symlinks into `~/.local/bin/jira-curl`. If it warns `~/.local/bin` isn't on `$PATH`, relay that message to the user — they need to update their shell rc and reopen the shell before `jira-curl` resolves from a fresh terminal. (Within this session, invoke via the absolute path `~/.local/bin/jira-curl …` to keep working.)

### 2. Pick the right instance for THIS request

```bash
jira-curl list 2>/dev/null || true
```

| Output | What to do next |
|--------|----------------|
| Empty / "No instances configured" | The user has nothing set up. Ask them to run `jira-curl init <name>` themselves (the API token is sensitive — never have them paste it into chat). Suggest a name based on their URL/org, but let them confirm. |
| One or more instances listed | Match the URL host the user pasted (e.g. `acme.atlassian.net`) against the URL column. If a single match exists, use that instance name. If multiple match or none match, **ask the user** which instance — don't guess from prior conversation memory. |

Only after both checks pass do you call `jira-curl <instance> <METHOD> <path>`.

## How the user will ask

Plain-language requests should "just work" — recognize a Jira URL, key, or any of the trigger phrases in the description above, then translate to `jira-curl` calls.

| User says | What to do |
|-----------|------------|
| "Work on ACME-1234 next" / pastes URL | `GET /rest/api/3/issue/<KEY>` to load context |
| "Update the description on ABC-123 to …" | `PUT /rest/api/3/issue/<KEY>` with ADF body |
| "Add a comment: …" | `POST /rest/api/3/issue/<KEY>/comment` with ADF body |
| "What's the status of WEB-456?" | `GET …?fields=status,summary,assignee` |
| "Move it to In Progress" / "transition to Done" | `GET …/transitions` to get id, then `POST …/transitions` |
| "Assign ACME-1234 to me" | `PUT …` with `{"fields":{"assignee":{"accountId":"<me>"}}}` |
| "Find my open tickets" | `GET /rest/api/3/search/jql?jql=…` |

## Quick reference

```bash
jira-curl <instance> <METHOD> <path> [extra curl args...]
jira-curl list                        # show configured instances
jira-curl init [name]                 # set up a new instance interactively
jira-curl install [dest]              # symlink onto PATH (default: ~/.local/bin/jira-curl)
```

The instance name is the lowercased label the user picked at setup (e.g. `acme`, `work`). One credentials file (`~/.config/jira/credentials`, mode 600) holds all instances. Multiple project keys (ACME-, WEB-, ABC-) within the same Atlassian site share one instance — only the host matters for routing.

## Adding more instances later

```bash
jira-curl init acme            # first instance
jira-curl init work            # second instance — repeat for each
jira-curl init personal        # any name; lowercase recommended
jira-curl list                 # confirm
```

Each `init` prompts for base URL (`https://yourorg.atlassian.net`), email, and API token (create one at https://id.atlassian.com/manage-profile/security/api-tokens). Re-running `init <name>` updates an existing instance. Verify with `jira-curl <name> GET /rest/api/3/myself`.

## Cookbook

### Read a ticket

```bash
jira-curl acme GET /rest/api/3/issue/ACME-1234?fields=summary,status,assignee,description
```

For just a few fields, always pass `?fields=…` — the default response is huge.

### Update the description

Descriptions use **ADF (Atlassian Document Format)** — plain strings won't work. Wrap text in the ADF envelope:

```bash
jira-curl acme PUT /rest/api/3/issue/ACME-1234 -d '{
  "fields": {
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "New description body."}]}
      ]
    }
  }
}'
```

For multi-paragraph or formatted descriptions, build the ADF in a temp file and pass `-d @file.json`.

### Add a comment

```bash
jira-curl acme POST /rest/api/3/issue/ACME-1234/comment -d '{
  "body": {
    "type": "doc", "version": 1,
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Deployed in v1.42.0."}]}]
  }
}'
```

### Transition a ticket (e.g. "move to In Progress")

Two-step: list available transitions for the issue, then POST the chosen `id`.

```bash
# 1. find the id for "In Progress"
jira-curl acme GET /rest/api/3/issue/ACME-1234/transitions | jq '.transitions[] | {id, name}'

# 2. apply it
jira-curl acme POST /rest/api/3/issue/ACME-1234/transitions -d '{"transition":{"id":"21"}}'
```

Transition IDs vary per project workflow — always look them up; never hardcode.

### Assign / unassign

```bash
# assign to a specific user (need their accountId)
jira-curl acme PUT /rest/api/3/issue/ACME-1234 -d '{"fields":{"assignee":{"accountId":"5b10ac8d82e05b22cc7d4ef5"}}}'

# unassign
jira-curl acme PUT /rest/api/3/issue/ACME-1234 -d '{"fields":{"assignee":null}}'

# look up your own accountId
jira-curl acme GET /rest/api/3/myself | jq '.accountId'
```

### Search with JQL

```bash
jira-curl acme GET '/rest/api/3/search/jql?jql=assignee=currentUser()+AND+statusCategory!=Done&fields=summary,status&maxResults=20'
```

URL-encode JQL spaces as `+` or `%20`. Quote the path so the shell doesn't expand `&`.

### Create a ticket

```bash
jira-curl acme POST /rest/api/3/issue -d '{
  "fields": {
    "project": {"key": "ACME"},
    "summary": "Fix login redirect on Safari",
    "issuetype": {"name": "Task"},
    "description": {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Repro: …"}]}]}
  }
}'
```

The other fields come from the project's conventions (the repo `CLAUDE.md`, memory, vault), not from habit:

- **Sprint**: only when the conventions say the board runs sprints. A Kanban board has none, and a team that stopped using sprints may leave the last one open, so finding an active sprint is no reason to add a ticket to it.
- **Priority**: set it whenever the conventions say the board is ordered by it. A ticket left on the default priority sinks below everything that has one.

### Add / remove labels, change priority

```bash
# add labels (replaces full list)
jira-curl acme PUT /rest/api/3/issue/ACME-1234 -d '{"fields":{"labels":["frontend","p1"]}}'

# change priority
jira-curl acme PUT /rest/api/3/issue/ACME-1234 -d '{"fields":{"priority":{"name":"High"}}}'
```

## Multi-instance disambiguation

If the user has multiple instances configured and their request doesn't include a URL, ask which one:

> You have `acme` and `work` configured — which Jira is ACME-1234 in?

If the user pastes a full URL, the host tells you the instance directly — match it against `jira-curl list`.

## Output style for ADF content (descriptions, comments, summaries)

The author of this skill has strong style preferences for any prose you write into Jira via `description`, `comment.body`, or a `summary` field. Follow these every time — they apply to ALL text the skill emits into a ticket, not just user-visible chat.

### 1. Never use em dashes (—) or en dashes (–)

Not in descriptions, not in comments, not in summaries, not in headings, not anywhere. The author types on a standard US keyboard and will never produce these characters naturally, so seeing one in a ticket they "wrote" is an immediate tell that an LLM drafted it sloppily.

Use commas, colons, periods, or parentheses instead. If you find yourself reaching for an em dash to join two clauses, the clauses probably want to be two sentences anyway.

```
❌ Bad:  Fast-follow for ACME-5688 — surfaced 2026-05-26 on Eric's order.
✅ Good: Fast-follow for ACME-5688. Surfaced 2026-05-26 on Eric's order.
✅ Good: Fast-follow for ACME-5688 (surfaced 2026-05-26 on Eric's order).
```

### 2. Always link Jira ticket references with `inlineCard`, never plain text

When a description, comment, or any ADF body mentions another Jira ticket key (e.g. `ACME-5688`, `WEB-456`), render it as an `inlineCard` ADF node pointing at the full ticket URL — Jira expands those to a clickable smart card showing the ticket's key + summary + status. Plain-text ticket keys are dead weight: the reader has to copy-paste them to follow up.

This rule applies to EVERY occurrence of a ticket key in the body, not just the first mention. Also applies to the parent epic, "fast-follow for X", "sibling to Y", "blocks Z" call-outs, comment threads, and any sub-task lists.

```jsonc
// ❌ Bad — plain text key
{"type": "paragraph", "content": [
  {"type": "text", "text": "Fast-follow for ACME-5688. Sibling to ACME-5895."}
]}

// ✅ Good — inlineCard expands to clickable smart card
{"type": "paragraph", "content": [
  {"type": "text", "text": "Fast-follow for "},
  {"type": "inlineCard", "attrs": {"url": "https://yourorg.atlassian.net/browse/ACME-5688"}},
  {"type": "text", "text": ". Sibling to "},
  {"type": "inlineCard", "attrs": {"url": "https://yourorg.atlassian.net/browse/ACME-5895"}},
  {"type": "text", "text": "."}
]}
```

The host (`yourorg.atlassian.net`) is the same Atlassian site as the instance you're posting against — pull it from the instance's `base_url` in `~/.config/jira/credentials` or from the URL the user pasted, never hardcode.

**Fallback** if you need a clickable link in a context where `inlineCard` doesn't render (rare — almost never the case in modern Jira Cloud): use a `link` mark on a `text` node:

```jsonc
{"type": "text", "text": "ACME-5688", "marks": [{"type": "link", "attrs": {"href": "https://yourorg.atlassian.net/browse/ACME-5688"}}]}
```

Default to `inlineCard`. Only use the `link`-mark fallback if you've confirmed the rendering context strips smart cards.

### 3. MANDATORY pre-POST self-check

Before you submit any `POST /rest/api/3/issue`, `PUT /rest/api/3/issue/<KEY>`, or `POST /rest/api/3/issue/<KEY>/comment`, you MUST grep your payload:

```bash
# Replace PAYLOAD with your file path or heredoc-piped JSON.
python3 -c "
import sys, json
data = open('PAYLOAD_FILE').read()
dashes = sum(data.count(c) for c in ['—','–'])
if dashes: sys.exit(f'BLOCKED: payload contains {dashes} em/en dashes — rewrite before POSTing')
print('OK: no em/en dashes')
"
```

- Any `—` (em dash, U+2014) or `–` (en dash, U+2013) in the JSON? **STOP. Rewrite. Do not POST.**
- Any bare ticket key (`[A-Z]+-\d+`) sitting inside a `"text"` node that isn't already wrapped by an `inlineCard`? Convert it.

The check is mandatory because the author has had to delete + repost comments multiple times to scrub em dashes that slipped through. Treat it as a precondition, not a polish step.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Sending plain text for `description` or comment `body` | Wrap in ADF (`{type:"doc", version:1, content:[…]}`) |
| Using em dashes (—) or en dashes (–) in any ADF text | See the "Output style" section above. Use commas, colons, or parens. |
| Referencing another ticket as plain `ACME-1234` text in ADF | Render as `inlineCard` with the full browse URL. See "Output style" §2. |
| Hardcoding transition IDs from one project in another | Always `GET …/transitions` first |
| Calling `/search` (deprecated) | Use `/search/jql` |
| Forgetting `?fields=` and getting a 200KB response | Always scope reads to the fields you need |
| Editing creds file by hand to add an instance | Run `jira-curl init <name>`, it handles quoting and chmod 600 |
| URL-encoding JQL incorrectly | Quote the path; encode spaces as `+`; encode `=` only inside values |

## Sensitive data

`~/.config/jira/credentials` contains live API tokens. Never `cat` it in conversation, never commit it, never paste its contents anywhere. The script reads it via `source` — let the script handle it.
