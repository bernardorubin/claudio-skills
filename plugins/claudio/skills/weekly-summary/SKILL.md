---
name: weekly-summary
description: >-
  Use when the user wants a weekly summary of a project: what shipped, releases cut,
  what's open, and where things stand, as a shareable page with a meeting brief.
  Triggers on "weekly summary", "week in review", "what shipped this week", "summary
  for the weekly meeting", "weekly update page", "week ending summary". Reads GitHub,
  Jira, the vault and the worklog. For one day's standup notes, use standup.
---

# Weekly Summary

One page per project per week: a **meeting brief** (Shipped / In progress + upcoming),
a **7-day strip** with activity counts, **person and status filters**, then
**Releases**, **Shipped** and **Open** ledgers. The page is the fixed template in
`assets/template.html`; this skill only gathers facts into a JSON blob and fills it.

**Every line must trace to a source read this run** (a PR, a ticket, a release, a
worklog or vault entry). No source, no line. Never pad the brief from memory.

## Step 1 — Project and period

- **Project**: detect from cwd exactly like `/save-session-to-worklog` (its Project
  Map, else the repo directory name). **Repos** = the cwd repo, or every child git repo
  when cwd is a parent folder, plus sibling repos under the same parent that map to the
  same project. Resolve each to `owner/repo` with `gh repo view --json nameWithOwner`.
- **Vault**: resolve with the registry walk below; empty means no vault.

<!-- Copy of the vault-registry resolver — canonical lives in vault-keeper Step 1. Keep in sync (see repo CLAUDE.md "Shared vault plumbing"). -->
```bash
DIR="$(pwd)"
VAULT=""
if [ -f ~/.config/claudio/vaults.json ]; then
  while [ "$DIR" != "/" ] && [ -z "$VAULT" ]; do
    VAULT=$(jq -r --arg d "$DIR" '.vaults[$d] // empty' ~/.config/claudio/vaults.json 2>/dev/null)
    DIR="$(dirname "$DIR")"
  done
fi
```

- **Period**: always a full week. End = today (`date +%F`) unless the user names a
  week; start = end − 6 days, every run. Never shorten it to start after the previous
  summary: a run on Wednesday covers Thursday to Wednesday even if the last one ended
  Thursday, so the two overlap. `previousEnd` is the end date of the newest
  `~/Desktop/weekly-summaries/<project>-week-ending-*.html` (null when there is none);
  it only feeds the page's "previous summary closed" note.

## Step 2 — Gather (in parallel where independent)

Always pass `-R <owner>/<repo>` to `gh`.

1. **PRs** per repo: opened in the period
   (`gh pr list -R X --state all --search "created:START..END" --json number,title,author,createdAt,mergedAt,state,url,headRefName --limit 200`)
   and merged in the period (same with `merged:START..END`). Merged → `shipped`
   (state "Merged"); still open → `open` (state "Draft" / "In review").
2. **Jira** (via the `jira-cli` preflight; pick the instance by the ticket keys in PR
   titles/branches, or the vault's `wiki/integrations/jira.md`). Project key(s) the same
   way. Then:
   - Tickets created, or moved to Done, in the period:
     `project = K AND (created >= START OR (statusCategory = Done AND resolved >= START))`.
     Done → `shipped`, otherwise `open`. Keep status name as `state`.
   - Still-open work for the brief: `project = K AND statusCategory != Done AND (status changed during (START, END) OR priority in (Highest, High))`.
   - **Releases**: `GET /rest/api/3/project/K/versions`, keep `released == true` with
     `releaseDate` in the period, then `fixVersion = "<name>"` for each one's tickets
     (source "Jira").
   - A ticket with no Jira access: stop and ask per the access rule, don't skip Jira.
3. **Releases without Jira versions**: `gh release list -R X` in the period (source
   "GitHub"), its body for the items. Only when the project has no Jira versions.
   **No Jira versions and no GitHub releases** (typical for a web app): each production
   deploy is a release. Take the PRs merged into the production branch in the period
   (the promotion PRs, e.g. `staging` → `main`; the repo's CLAUDE.md names the branch):
   source "Production deploy", `version` = `#<number>`, `url` = the PR, `date` = its
   merge date, `items` = the tickets it carried. Put the deploy count in the brief's
   first Shipped bullet and in the day strip ("prod deploys").
4. **Worklog**: the period's day entries from every
   `{vault}/raw/work-logs/*/<month>-<year>-<project>-worklog.md` (or the Desktop copy
   when no vault), both months when the period spans two.
5. **Vault**: `wiki/log.md` lines dated in the period, then the `wiki/projects/`,
   `wiki/tickets/` and `wiki/integrations/` pages those lines touch, for status,
   deadlines, stalls and who owes what. The vault is a map; any claim that a PR or
   ticket can confirm gets confirmed there first.

**People scope**: if the user or a memory limits the summary to certain people (e.g.
"only me and Jose"), filter PRs by author and tickets by assignee before anything else,
and apply it to the brief, the day counts and the releases too. Someone else's work can
still be named as a dependency ("waits on the eligibility endpoint") but not credited.

**Who**: first name only, uppercase is done by the page. Map GitHub logins and Jira
assignees to names via `{vault}/wiki/people/`, `gh api users/<login> --jq .name`, or
the Jira `displayName`. Unassigned → `null` (renders "–").

Dedupe: a PR and its ticket are one shipped item; keep the ticket as the item and drop
the PR row, unless the PR has no ticket.

## Step 3 — Write the brief

Two lists, ~3-6 bullets each, one or two sentences per bullet.

- **Shipped**: outcomes a non-engineer in the meeting cares about, grouped by
  feature, not per ticket. Say what now works and any caveat that changes how it's
  used ("off until a store activates a test", "merged, waiting on the next release").
  No ticket keys, no PR numbers, no file names.
- **In progress / upcoming**: what's actively moving, what's queued behind it, what's
  stalled and on what, hard deadlines, and who owes what. Only from open tickets,
  worklog and vault entries in the period.

Plain words, no em dashes, no hype. If a bullet can't name its source, cut it.

## Step 4 — Build the JSON

```json
{
  "title": "Week Ending September 28",
  "start": "2026-09-22", "end": "2026-09-28", "previousEnd": "2026-09-21",
  "brief": { "shipped": ["..."], "upcoming": ["..."] },
  "days": [{ "date": "2026-09-22", "counts": [[2, "PRs opened"], [1, "Jira ticket"]] }],
  "releases": [{ "repo": "acme-web", "source": "Jira", "version": "1.69.0", "date": "2026-09-24", "url": "https://...",
                 "items": [{ "key": "ACME-418", "url": "https://...", "who": "Dana", "what": "One sentence on what shipped." }] }],
  "items": [{ "status": "shipped", "key": "ACME-387", "url": "https://...", "who": "Dana",
              "title": "Plain-language summary", "date": "2026-09-23", "repo": "acme-web", "state": "Done" }]
}
```

- `days`: one entry per date in the period, counts only for kinds that are non-zero
  (PRs opened, Jira tickets created, releases or prod deploys), singular when 1.
- `releases[].url`: optional; when set, the version links to it (the Jira version page,
  the GitHub release, or the promotion PR). Every item row repeats its release's
  version and date.
- `what`/`title`: rewrite ticket summaries into one plain sentence of behavior, not the
  raw Jira title.

## Step 5 — Render and publish

```bash
mkdir -p ~/Desktop/weekly-summaries
OUT=~/Desktop/weekly-summaries/<project>-week-ending-<END>.html
python3 - "$SKILL_DIR/assets/template.html" /path/to/data.json "$OUT" <<'EOF'
import json, sys, html
tpl, data, out = sys.argv[1:]
d = json.load(open(data))
s = open(tpl).read()
s = s.replace("__TITLE__", html.escape(d["title"])).replace("/*__DATA__*/null", json.dumps(d).replace("</", "<\\/"))
open(out, "w").write(s)
EOF
```

`$SKILL_DIR` is this skill's directory (the one holding this SKILL.md). Then publish
`$OUT` with the Artifact tool (private by default; `icon: "calendar"`, description
naming the project and period). The page already follows the artifact page contract,
so no redesign pass. No Artifact tool in this session: `open "$OUT"` instead.

Reply with the link, the counts line (releases / shipped / open), and anything that
was blocked or skipped. The local HTML is also where the next run reads
`previousEnd`, so always write it.

## What "done" looks like

A published page for the period whose brief, strip, and ledgers all trace to PRs,
tickets, releases, worklog or vault entries read this run; a local copy in
`~/Desktop/weekly-summaries/`; and a reply that names any source that was blocked
rather than silently thin.
