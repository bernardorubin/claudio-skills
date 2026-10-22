---
name: weekly-summary
description: >-
  Use when the user wants a weekly summary of a project: what shipped, releases cut,
  what's open, and where things stand, as one living page with a meeting brief that
  updates itself every day. Triggers on "weekly summary", "week in review", "what
  shipped this week", "summary for the weekly meeting", "weekly update page", "week
  ending summary", "refresh the weekly summary". The first run in a project sets up
  the page and its daily update; later runs refresh it. Reads GitHub, Jira, the vault
  and the worklog. For one day's standup notes, use standup.
---

# Weekly Summary

One living page per project, at one link that never changes. It opens on the last 7
days and lets the reader pick any dates (presets for this week, last week and the last
30 days, or a custom range), then filter by person, repo, section and free text. It
shows a **meeting brief**, a **day strip** with activity counts, then **Releases**,
**Shipped** and **Open** ledgers.

The page is the fixed template in `assets/template.html`. It keeps its records in its
own database as one **day document** per date, and a daily scheduled run of this skill
adds the new days. New data never republishes the page. It is a plain artifact with
the `db` capability, not the Dashboard artifact type: its content is a brief and
ledgers gathered through local CLIs, not live connector queries, so don't run an
Artifact quickstart for it.

**Every line must trace to a source read this run** (a PR, a ticket, a release, a
worklog or vault entry). No source, no line. Never pad the brief from memory.

`$SKILL_DIR` below is this skill's directory (the one holding this SKILL.md); `$TMP` is a
fresh `mktemp -d` folder.

## Modes

Read `~/.config/claudio/weekly-summary.json` (missing = empty). Resolve the project
(Step 1's first bullet), then:

- **No entry for the project → Set up** (Step 1), then Refresh.
- **An entry → Refresh** (Steps 2 to 6). A scheduled run passes `refresh <project>`;
  take the project from that instead of the cwd.

```json
{ "projects": { "acme": {
  "url": "https://claude.ai/artifact/...",
  "repos": ["acme-co/acme-web", "acme-co/acme-api"],
  "vault": "/path/to/AcmeVault",
  "jira": { "instance": "acme", "projects": ["ACME"] },
  "people": ["Dana", "Sam"],
  "releases": "jira",
  "prodBranch": "main",
  "task": "weekly-summary-acme",
  "lastRun": "2026-10-21T08:04:00-06:00"
} } }
```

`url` is null in local mode; `vault`, `jira`, `people` and `task` may be null.
`people` null means everyone. `releases` is one of `jira`, `github`, `changelog`,
`deploys` (Step 3).

## Step 1: Set up (once per project)

1. **Project**: detect from cwd exactly like `/save-session-to-worklog` (its Project
   Map, else the repo directory name). **Repos** = the cwd repo, or every child git repo
   when cwd is a parent folder, plus sibling repos under the same parent that map to
   the same project. Resolve each with `gh repo view --json nameWithOwner`.
   **Vault** with the registry walk:

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

2. **Jira** (via the `jira-cli` preflight): the instance and project key(s) from the
   ticket keys in recent PR titles and branches, or the vault's
   `wiki/integrations/jira.md`. A Jira access block: stop and ask per the access rule.
3. **Release source**, first that applies: `jira` (the project has released fix
   versions), `github` (GitHub releases), `changelog` (a `CHANGELOG.md` with version
   headings), `deploys` (none of those, typical for a web app: each merge into the
   production branch is a release). For `deploys`, `prodBranch` comes from the repo's
   CLAUDE.md.
4. **People**: if the user, their CLAUDE.md or a memory limits summaries to certain
   people, record them. Otherwise null.
5. **Publish the page** (Artifact tool available):
   ```bash
   python3 -I "$SKILL_DIR/scripts/weekly_store.py" render "$SKILL_DIR/assets/template.html" "<Project> Weekly Summary" "$TMP/page.html"
   ```
   Publish `$TMP/page.html` with `icon: "calendar"`, a description naming the
   project, and
   `capabilities: {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}]}}`
   (everyone the page is shared with reads; only editors write). Save the returned
   `url`, then `ArtifactData set` collection `meta`, doc `run`:
   `{"project": "<Project>", "url": "<url>"}`.
   **No Artifact tool** → local mode: `url` null, records in
   `~/Desktop/weekly-summaries/<project>.json`, page at
   `~/Desktop/weekly-summaries/<project>.html`.
6. **History**: if pages from the old weekly version exist
   (`~/Desktop/weekly-summaries/<project>-week-ending-*.html`), convert them:
   ```bash
   python3 -I "$SKILL_DIR/scripts/weekly_store.py" migrate "$TMP/old" ~/Desktop/weekly-summaries/<project>-week-ending-*.html
   ```
   and write those day documents (Step 6). The first refresh window then starts the day
   before the newest migrated date; with no old pages it is the last 30 days.
7. **Schedule the daily refresh.**
   - **Desktop app** (the `scheduled-tasks` tools exist): `create_scheduled_task` with
     `taskId` `weekly-summary-<project>`, `cronExpression` `0 8 * * *` unless the user
     names a time, and this prompt:
     > Refresh the weekly summary page for project `<project>`: run the
     > `claudio:weekly-summary` skill with args `refresh <project>`. Its settings are in
     > `~/.config/claudio/weekly-summary.json`. Read-only everywhere except that page's
     > database and that config file: no Jira or GitHub writes, no messages, no
     > republishing the page. If a source is blocked by auth, finish the rest and name
     > the exact access needed in your final message.

     Tell the user it runs while the Claude app is open and a missed run fires on the
     next launch. After setup, start it once with `run_scheduled_task` and confirm with
     `list_task_runs` that it finished without stopping on an approval prompt. If it
     stopped, name the tool that needs allowing.
   - **Anywhere else**: say the page updates whenever they ask for the summary, and
     that `/loop 1d weekly-summary refresh <project>` keeps it fresh while one session
     stays open. Never a cloud routine: it can't reach `gh`, `jira-curl`, their
     credentials or the vault.
8. Save the entry to `~/.config/claudio/weekly-summary.json`.

## Step 2: Window and what's stored

- **Window**: `from` = the later of (the day before `lastRun`'s date) and (today − 29);
  `to` = today (`date +%F`). The overlap lets a missed day catch up.
- **Read the store** for `min(from, today − 6)` onwards: `ArtifactData query`
  collection `days`, `query: {"where": [["date", ">=", "<that date>"]], "limit": 1000}`.
  Keep each document's `version` (for Step 6) and the earlier days' events (for the
  brief). Local mode: read the same dates from the JSON file.

## Step 3: Gather the window

Always pass `-R <owner>/<repo>` to `gh`. Run independent reads in parallel.

1. **PRs** per repo: opened (`gh pr list -R X --state all --search "created:FROM..TO" --json number,title,author,createdAt,mergedAt,state,isDraft,url,headRefName --limit 200`)
   and merged (same with `merged:FROM..TO`).
2. **Jira**: `project in (K) AND (created >= FROM OR updated >= FROM)` with
   `expand=changelog` and fields `summary,status,assignee,created,resolutiondate,priority`.
   Each status change in the changelog dated in the window is an event on that date.
   For the brief, also `project in (K) AND statusCategory != Done AND priority in (Highest, High)`.
3. **Releases** in the window, by the configured source:
   - `jira`: `GET /rest/api/3/project/K/versions`, `released == true` with
     `releaseDate` in the window, then `fixVersion = "<name>"` for its tickets.
   - `github`: `gh release list -R X`, the body for the items.
   - `changelog`: the version headings added to `CHANGELOG.md` in the window
     (`git log --since --until -p -- CHANGELOG.md`), `url` = that commit.
   - `deploys`: PRs merged into `prodBranch` in the window (the promotion PRs), source
     "Production deploy", `version` = `#<number>`, `url` = the PR, `items` = the tickets
     it carried.
4. **Worklog** (for the brief): the day entries for the 7 days ending today from every
   `{vault}/raw/work-logs/*/<month>-<year>-<project>-worklog.md` (or the Desktop copy
   with no vault), both months when the week spans two.
5. **Vault** (for the brief): `wiki/log.md` lines from those 7 days, then the
   `wiki/projects/`, `wiki/tickets/` and `wiki/integrations/` pages they touch, for
   status, deadlines, stalls and who owes what. The vault is a map; confirm in the PR
   or ticket anything they can confirm.

**People scope**: with `people` set, keep only PRs authored by and tickets assigned to
them, everywhere (events, counts, releases, brief). Someone else's work can be named in
the brief as a dependency ("waits on the eligibility endpoint") but not credited.

**Who**: first name only (the page uppercases it), mapped from GitHub logins and Jira
assignees via `{vault}/wiki/people/`, `gh api users/<login> --jq .name`, or the Jira
`displayName`. Unassigned → `null`.

## Step 4: Day documents

One document per date in the window, every date, empty days included:

```json
{
  "date": "2026-10-21",
  "counts": [[3, "PRs opened"], [1, "Jira ticket"], [1, "prod deploy"]],
  "events": [{ "kind": "done", "key": "ACME-387", "url": "https://...", "who": "Dana",
               "title": "Plain-language summary", "repo": "acme-web", "state": "Done" }],
  "releases": [{ "repo": "acme-web", "source": "Jira", "version": "1.69.0", "url": "https://...",
                 "items": [{ "key": "ACME-418", "url": "https://...", "who": "Dana", "what": "One sentence on what shipped." }] }],
  "updatedAt": "2026-10-21T08:04:00-06:00"
}
```

- **Events**: `opened` (a PR opened or a ticket created that day), `active` (a ticket
  moved to a status outside Done that day), `done` (a PR merged or a ticket moved to
  Done that day). At most one event per key and kind per day.
- **One item per ticket**: a PR whose title or branch names a ticket records under
  the ticket's key and URL; a PR with no ticket is its own item, `key` `<repo>#<n>`,
  linking the PR.
- `title` / `what`: one plain sentence of behavior, not the raw Jira or PR title.
  `state`: the Jira status name, or `Merged` / `Draft` / `In review` for a PR-only item.
  `repo`: the repo's short name, or `Jira` for a ticket with no PR.
- `counts`: only non-zero kinds (PRs opened, Jira tickets created, releases or prod
  deploys), singular when 1.

The page derives everything else: an item is **shipped** in a date range when it has a
`done` event in it, otherwise **open**; its row shows the latest snapshot in the range.

## Step 5: The brief (today's document only)

Add `"brief": {"shipped": [...], "upcoming": [...]}` to today's document, covering the
7 days ending today: the store's earlier days from Step 2 plus this run's, the worklog,
the vault and the open high-priority tickets. Each day keeps the brief written on it, so
any past date still has its own.

Two lists, about 3 to 6 bullets each, one or two sentences per bullet.

- **Shipped**: outcomes a non-engineer in the meeting cares about, grouped by feature,
  not per ticket. Say what now works and any caveat that changes how it's used ("off
  until a store activates a test", "merged, waiting on the next release"). The first
  bullet carries the release or deploy count. No ticket keys, PR numbers or file names.
- **In progress / upcoming**: what's actively moving, what's queued behind it, what's
  stalled and on what, hard deadlines, and who owes what. Only from open tickets,
  worklog and vault entries in those 7 days.

Plain words, no em dashes, no hype. If a bullet can't name its source, cut it.

## Step 6: Write

**Artifact mode.** Save each document as JSON in a temp dir, then `ArtifactData batch`
on the project's `url` (up to 50 writes per batch):

- a date the store already has → `update` with `if_version` = its version from Step 2
  (an update replaces `counts`, `events` and `releases` and keeps a brief an earlier run
  wrote);
- a new date → `set`, no `if_version`.

If a pinned write fails because the document changed since Step 2, re-read that one and
redo it. Then `ArtifactData get` `meta/run` and `update` it with `{"lastRun": "<now ISO>"}`
and its `if_version`. On the very first write, check the page's readers can see the
records: one `ArtifactData list` of `days` with `as_level: "view"`.

**Local mode.**
```bash
python3 -I "$SKILL_DIR/scripts/weekly_store.py" merge ~/Desktop/weekly-summaries/<project>.json "$TMP"/days/*.json
python3 -I "$SKILL_DIR/scripts/weekly_store.py" render "$SKILL_DIR/assets/template.html" "<Project> Weekly Summary" ~/Desktop/weekly-summaries/<project>.html ~/Desktop/weekly-summaries/<project>.json
```
then `open` the page.

Finally set `lastRun` in `~/.config/claudio/weekly-summary.json`.

## Step 7: Reply

The link, one counts line for the last 7 days (releases / shipped / open), and anything
that was blocked or skipped. A scheduled run ends with the same reply, which becomes the
run's summary.

## Changing the page's design

The records live in the database, so a new template never loses data: render it
without data (Step 1.5) and publish it to the project's `url`. Read the artifact first,
and omit `capabilities` so the page keeps them.

## What "done" looks like

The page at its `url` holds a day document for every date in the window, today's with a
brief, every line tracing to PRs, tickets, releases, worklog or vault entries read this
run; `meta/run.lastRun` and the config's `lastRun` say when; and the reply names any
source that was blocked rather than silently thin.
