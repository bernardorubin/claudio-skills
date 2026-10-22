# claudio

A Claude Code toolkit — **33 skills, no prefix to type**. Shipping pipelines (new app / ticket / release), code reviews (PR / local / full-repo audit), git workflow, Claude meta tasks, external integrations, and per-project knowledge vaults.

> **Heads up**: examples throughout use placeholder names — `acme`/`beacon` projects, `acme`/`work` Jira instances, `ACME-####` ticket prefixes. They're illustrative; the plugin works for any project. Two spots hold config you replace with your own: the **Project Map** in `/save-session-to-worklog` and the vault registry under `~/.config/claudio/vaults.json`.

## Installation

```
/plugin marketplace add bernardorubin/claudio-skills
/plugin install claudio@claudio
/reload-plugins
```

Then, in each project you work on, set up its knowledge vault:

```
/vault-init
```

The vault is the plugin's memory: `vault-keeper` reads it for prior context and files what each session learns, `/save-to-vault` and `/wrap-session` write to it, and `/save-session-to-worklog` keeps your worklogs there for `/standup` and `/weekly-summary` to read. Without one, those skills lose their memory, and the worklogs land on `~/Desktop/` instead. Until you have a vault anywhere, a new session shows a one-time reminder.

## Skills only — no prefix

Every entry below is a **skill** invocable as `/<name>` (no `claudio:` prefix). Skills appear in the slash palette and **auto-trigger** when you describe the task in plain English.

## Shipping pipelines

### `/create-app`
Zero to **first** release. The one-time gauntlet that `/shipit` and `/cut-release` assume is already done: shape the idea into an approved spec (`brainstorming` → `writing-plans`), build it, then survive the seams between services where first releases actually die. It exists for one repeated failure shape — **a dashboard shows a provider "enabled" while its credentials, allowlists, integrations and native app registrations were never copied from dev**, so the app shows no error, just a blank screen or an empty list, and you debug working code for a day. Carries three loaded checklists: `production-auth.md` (the "nothing was copied" audit, plus the client traps where an unauthenticated query returns `[]` and a returning user looks brand new), `foundations.md` (the day-0 calls that later cost a full review cycle — chiefly that **OTA support must be compiled into the binary before the first submission**), and `store-submission.md` (privacy policy, in-app account deletion, App Privacy answers, DSA trader status, and the silent trap of a version keeping an **older** build attached). Holds the same hard line as the other two: builds freely, **never submits, publishes, or ships an OTA** — and "Add for Review" is always your click. Hands off to `/cut-release` the moment v1 is approved. Auto-triggers on "let's build an app", "new app idea", "take this app to the App Store".

### `/shipit`
The full ship pipeline for a Jira ticket (or a described feature/bugfix). Hand it a task with no ticket key and it asks first whether to create the Jira ticket or ship without one, instead of guessing. Then: understand → clarify (hard stop — no code until questions are answered; asked in rounds, each with a recommended answer) → implement on a `--no-track` branch → open the PR (a change visible on screen gets its before/after screenshots embedded in the body, uploaded with `gh image`) → self-review loop (asks first, then runs `/review-cycle`: living PR comment, fix, push, until clean) → wait for CI checks to go green (fixes failures, re-runs a flake once, never treats pending or "no checks" as green) → address external review → log to worklog + vault → draft a Slack update → hand back the deploy command. It's a **conductor** — it chains your other skills (`jira-cli`, `git-ac`, `pr-description`, `pr-review`, `save-session-to-worklog`, `save-to-vault`, `write-slack-message`) in order and holds two lines: do the work yourself instead of deferring it, and stop before anything that deploys. **Project-agnostic by design** — it reads the repo's `CLAUDE.md` for the base branch, quality gates, PR flow, designated reviewer, dashboards, and deploy command, so it adapts per project instead of hardcoding any. Auto-triggers on "ship ABC-123", "take this ticket end to end", "implement ABC-456 and open a PR".

### `/cut-release`
The per-**release** complement to `/shipit` (which is per-**ticket** and stops at a review-ready PR). When you cut a release, this takes the already-merged code to a submittable build: **pre-flight the release gates first** (is the App Store version train open? build slot free? CI green? version bumped?) — the check that kills the "the version train was already released" upload failure — then bump if needed, build the artifact (you allow `eas build` / local builds / `expo export`), **scan the built artifact for dev credentials and wrong-env markers** — the last cheap moment before a stale bundler cache becomes a credential rotation — generate release notes from the merged tickets, log it, draft the ship update, and **hand back the exact submit command**. Holds the same hard line as `/shipit`: Claude builds to ready, **never runs the submit / OTA / store publish** — you run that. Multi-target and project-agnostic: reads the repo's `CLAUDE.md` for the release target(s), version scheme, build vs submit commands, and gate dashboards. Auto-triggers on "cut a release", "ship a build", "prep the release", "new App Store build". Many `/shipit` runs merge → one `/cut-release` cuts the version.

### `/promote-to-prod`
The ladder from a finished branch to **verified** production: PR into staging → wait for checks → merge → **verify on staging** → PR into main → wait for checks → merge → confirm prod is healthy *and* that the fix is actually live (Chrome MCP / `playwright-cli` / `curl`) → capture evidence. It merges both PRs itself, but only on genuinely green checks and only after staging proved the change didn't break anything — the staging gate is the point, not a formality. Holds four lines: green means green (pending ≠ passed, no-checks-configured ≠ passed), **check the deploy, not the merge** (a merged PR is not a deployed change, so confirm the running commit SHA before verifying behavior), the staging→main PR carries everything else sitting on staging so read that diff and say what's riding along, and if prod comes back broken it **reverts immediately** and tells you first. Evidence lands in `~/Desktop/<TICKET>-prod-evidence/` and it asks afterwards whether to post it to the PR, the Jira ticket, both, or nowhere. Then, **when there is a Jira ticket** (given, or in the PR title, branch or body), it comments what shipped and moves the ticket to **Done** or **Ready for QA** depending on the ticket (QA instructions or ACs left for someone else → Ready for QA; every AC proven on prod → Done; asks you when it isn't obvious), listing transitions first and re-reading the status to confirm. No ticket, no step; a failed or reverted prod never moves one. Never submits to a store, pushes an OTA, or runs a migration — those still stop at `/cut-release`'s boundary. Project-agnostic: reads the repo's `CLAUDE.md` for the real branch ladder, hostnames, merge method, and gates. Auto-triggers on "promote to prod", "push it to prod", "get this to prod", "staging then prod".

### `/investigate`
Diagnose a production anomaly, bug report, or "why is X happening" — grounded in real evidence, not a guess. Built for the common shape: paste a Slack thread, get back a reply ready to drop into that same thread. Enforces the investigation discipline — **dashboard metrics → raw logs → code**, make zero assumptions, investigate yourself before asking anyone — and it's strictly **read-only** (surfaces a fix for you to decide; hands off to `/shipit` if you want it built). Reads the repo's `CLAUDE.md` "Dashboards & Data Sources" section to know where the truth lives. Auto-triggers on "investigate X", "look into why Y", "figure out what's going on with Z", or pasting an incident/alert/error.

### `/vercel-triage`
Logs in, suggestions out. Reads a Vercel project's runtime logs since the last check (or the last N hours you pass it; 24 on a first run) on production and staging, groups them into distinct issues, skips the noise (scanner probes, crawler chunk loads, one-off QA-branch rows), then searches Jira for each one: an open ticket that already covers it gets a recurrence comment, one that belongs to an open ticket for the same area is folded into it, anything new becomes a proposed bug with the logs link, verbatim evidence, a labelled suspected cause and acceptance criteria. Copies component, epic and priority conventions off the newest bug in the project, and a sprint only when the board runs sprints. Knows the Vercel MCP's traps (the `warning` level filter misses `warn` rows, `group_by: level` only counts a sample, wide queries time out). Labels what it files `vercel-triage`, then re-checks every open labelled ticket and proposes closing the ones whose error has stopped while the route still got traffic. By default it lists all of this as a numbered list and files, comments or closes only what you pick, like the other triage skills; `--file` does it all without asking, and `--dry` reports without moving the window. On a timer: `/loop 1h vercel-triage`. Ships `scripts/md2adf.py` for the ticket bodies. Auto-triggers on "check the Vercel logs for errors and make tickets", "triage the Vercel errors".

### `/figma-triage`
Comments in, suggestions out (formerly `/figma-to-jira`). Say "I got Figma notifications, please check" and it scans every file in the watched Figma projects (`~/.config/claudio/figma.json`) for open threads with a new comment that mentions you or replies in a thread you're in, with no file or frame to name. For each one it reads the whole thread, sorts it into change request, "I updated the design" (the build has to follow), question or nothing to do, groups related comments into one ticket, and checks Jira first: by thread id, Figma file and node, screen name, the request's words and the open tickets in the frame's epic. A request an open ticket already covers gets a comment there, one that belongs to an open ticket for the same screen is folded into it, and only the rest become new tickets (linked to any Done or related ticket). By default it lists those as a numbered list and files only the ones you pick ("file 2"), like `/slack-triage` and `/inbox-triage`; `--file` files them all without asking. It screenshots where each comment is pinned (cropped around the pin on tall frames) and files each ticket with the comment quoted, the screenshot inline and a deep link that opens the comment, labelled `figma-comment`. Questions come back as a list for you to answer in Figma. The default window is since the last run. Read-only on Figma. Needs a Figma personal access token with four read scopes (the skill's Setup lists them and where to click); since personal tokens can't list a project's files, the project's file list is read once from the logged-in Figma web app and saved in `~/.config/claudio/figma.json`. `--dry` reports without moving the window. On a timer: `/loop 2h figma-triage`. Ships `scripts/figma_comments.py` (the scanner, stdlib only) and `scripts/md2adf.py`.

### `/slack-triage`
Mentions in, suggestions out. Checks your Slack @-mentions, DMs and replies in threads you're part of (found from your own thread messages in the last 7 days, since people often answer without tagging you) since the last run, drops what doesn't need you (bots, threads you already answered, messages addressed to someone else, thanks and FYIs), and comes back with a short numbered list: a reply drafted through `/write-slack-message`, a Jira ticket to file (checked against Jira first: covered, fold in, follow-up or new), or work to do (a PR to review, something to investigate). It suggests only: nothing is filed, and nothing is posted to Slack; you answer "file 2, send 1" and it does those items in the same conversation. It runs inside the conversation you're in, so a message about work that conversation touched gets a reply drafted from what it already knows. `/loop 20m slack-triage` repeats it while the session is open, and a run with nothing new prints one line. State (last run, items already reported) lives in `~/.config/claudio/slack-triage-state.json`. `--dry` reports without drafting or saving. Needs the Slack MCP connected.

### `/inbox-triage`
The Gmail twin of `/slack-triage`. Checks the inbox since the last run, filters hard (most of a work inbox is automated: Jira, Figma and Slack notifications that other skills already triage, marketing, receipts, shared and test inboxes, threads you already answered), and suggests a reply saved as a Gmail draft, a Jira ticket (deduped against Jira) for a person's request or a vendor alert about a system you run (a payment provider reporting failures, a console deadline, a deprecation), or work to investigate. A reply that took on work ("on it") still gets the Jira check, so the work gets a ticket. Suggests only: never sends, archives, labels or marks read; you answer "file 1, send 2". Checks the connected account from the thread links and stops if it's the wrong inbox. `/loop 1h inbox-triage` repeats it while the session is open. State lives in `~/.config/claudio/inbox-triage-state.json`. `--dry` reports without drafting or saving. Needs the Gmail connector.

### `/super-triage`
All four triage skills in one check: runs `/slack-triage`, `/inbox-triage`, `/figma-triage` and `/vercel-triage` in turn and gives back one list, most urgent first, numbered across sources and tagged Slack, Email, Figma or Vercel, so "file 2, send 4" still goes to the right skill. A source that's blocked (a connector signed out, a missing token) gets one line saying what fixes it, and the rest still run. Each source keeps its own window and state file. Suggests only. On a timer: `/loop 1h super-triage`.

### Running the triage skills on a loop
`/slack-triage`, `/inbox-triage`, `/figma-triage`, `/vercel-triage` and `/super-triage` are built for `/loop`. Run them inside the conversation you're working in, each on its own timer, and every check lands in that conversation with its context:

```
/loop 20m slack-triage
/loop 1h inbox-triage
/loop 2h figma-triage
/loop 1h vercel-triage
/loop 1h super-triage
```

Type the skill name without its slash: the desktop app won't send a slash command inside `/loop`, and the bare name runs the same skill (the CLI accepts either form).

- **What each check covers**: everything since the previous check. Slack and Gmail add a 10-minute overlap for search lag and drop what was already reported, so on a 20-minute loop a check covers about the last 30 minutes. The first run ever looks back 24 hours (3 days for Figma). After a gap, like a laptop closed overnight, the next run catches up from the last check.
- **Shared state**: the last check is recorded in `~/.config/claudio/` (`slack-triage-state.json`, `inbox-triage-state.json`, `figma-triage-state.json`, `vercel-triage-state.json`), so a manual run in another conversation moves the window for the loop too. Pass a window (`/slack-triage 1d`) to re-check a stretch, including items already reported.
- **Quiet when quiet**: a check with nothing new prints one line. Checks fire between turns, never mid-task, and the loops stop when the session closes.
- **Suggest only**: nothing is posted, sent or filed until you answer ("file 2, send 1").
- **All four at once**: `/loop 1h super-triage` runs the four checks together and gives back one merged list, numbered across sources and tagged Slack, Email, Figma or Vercel. Each source still keeps its own window, so it mixes with a faster loop for one source (`/loop 20m slack-triage`) without repeating anything.

### `/qa`
QA a ticket or PR and **prove** it — exercise every acceptance criterion against the real running system **through the interface that AC lives behind** (API/CLI with the project's own keys, a data query, or the UI — a browser only when the AC is actually about the UI), capture evidence per AC, then **publish** a pass / fail / **could not verify** report with the evidence embedded inline — to the Jira ticket, the GitHub PR, both, or a Slack thread, **asking you where when it isn't obvious** rather than silently picking. Enforces three lines: evidence per AC or it isn't a pass, a **baseline before you conclude** (so a pre-existing failure never gets called a regression), and never claiming more than you proved. Opens the source spec when the ticket cites one, because a ticket's paraphrase of a PRD is not the PRD. Reports only — never merges or deploys. Auto-triggers on "QA this ticket", "verify the ACs", "test this and show me it works", "can we QA it ourselves before shipping".

### `/qa-video`
Record a QA **video** when a screenshot can't prove the thing — a redirect chain, a state machine, an editor interaction, an async path. Default path is `qavid page <url> [--steps steps.mjs]`, which drives the project's own Playwright **headlessly and records the browser page only**: no terminal, no notifications, no Screen Recording permission, and the user's screen stays free while it runs. Whole-screen capture is the fallback for flows that leave one page (`--region x,y,w,h` / `--display N` keep the rest of the desktop out). Also bundles `setup`, which installs ffmpeg via Homebrew and probes the macOS Screen Recording permission — it fails silently, writing a file with zero frames, so the probe counts frames rather than trusting the exit code — plus `preview` (plays it in QuickTime so the user judges the pacing before anything is posted, then `speed 1.5`/`2`/`0.75` re-times it) and `compress`, which walks the crf ladder until the file is under 9MB (headroom under GitHub's 10MB cap), and `gif` for clips under ten seconds. Knows the routing asymmetry that decides where evidence lands: **Jira takes video through its attachments API (so the skill can finish the job), GitHub has no video upload API at all** (so the PR step is handed back with a paste-ready line rather than claimed as done). Refuses to record real patient data, credentials, or a full screen when a window will do. Auto-triggers on "record a video of this", "a screenshot won't show this", "video QA", "attach a video to the ticket".

## Git

### `/git-ac`
Stage all changes, generate a concise commit message from the diff, commit (no AI co-author lines), **no push**. Use when the remote blocks pushes (branch protection, pre-receive hooks) or when you want to batch commits locally before pushing yourself.

### `/git-pull-reapply`
Bring the current branch up to date with remote while preserving local work. Handles four scenarios:
1. Clean tree + fast-forward → simple `git pull`
2. Uncommitted changes + fast-forward → stash, pull, pop
3. Clean tree + divergent branches → rebase local commits onto remote
4. Uncommitted changes + divergent branches → stash, rebase, pop

Always rebases over merging so history stays linear.

## Claude meta

### `/claude-learn`
Reviews the current session and documents valuable learnings into the right CLAUDE.md files (global, project root, or module). Helps future sessions start smarter.

```
/claude-learn                # Review whole session
/claude-learn <learning>     # Document a specific learning
```

### `/claude-modularize`
Breaks down a large, monolithic CLAUDE.md into smaller, scoped files distributed across the project's directory structure (component-specific guidelines move next to components, etc.).

### `/handoff`
Compacts the current conversation into a self-contained handoff document at `~/Desktop/handoff-<slug>.md` so a fresh `claude` session or another agent can pick up exactly where this one left off. Captures the task, current git/PR state (committed vs pushed vs built vs waiting-to-publish), key decisions and ruled-out approaches, gotchas (confirmed vs suspected), concrete next steps, key files/artifacts by reference, and a suggested-skills list. References other artifacts (PRDs, plans, diffs) instead of restating them, and redacts secrets. Optional argument describes what the next session will focus on. Auto-triggers on "write a handoff doc", "hand this off to a new session", "context is getting long, write a handoff".

### `/session-status`
A status board for the current session, for the long multi-ticket days where work gets started and quietly never finished. Sweeps the whole conversation for every item you asked for — features, bug fixes, tickets, questions you asked, follow-ups Claude promised, things parked for "later" — then verifies each one against real state (`git status`, branch upstreams, `gh pr view`, Jira, whether the gates actually ran) instead of trusting the conversation. Reports each item as Merged / In review / Pushed / Committed / In progress / Blocked / Not started / Dropped, with built-but-unpublished never called shipped, followed by **Blocked on you** (each blocker with the exact ask), **Missing / never confirmed** (claims never verified, ACs never tested, your questions still unanswered), and **Next up** with the skill that does each one. Read-only — it never commits, pushes, fixes, or deploys. Optional freetext filter; `--file` also writes it to the Desktop. Auto-triggers on "where are we", "what's the status of everything", "what's still open", "summarize the work we've done this session", "loose ends".

### `/update-claudio`
Updates this toolkit to its latest published version without you remembering the `/plugin` incantations. Runs the non-interactive `claude plugin` CLI — `marketplace update claudio` then `update claudio@claudio` (the verb that actually upgrades; `install` no-ops when already installed) — reports the old → new version, and reminds you to run `/reload-plugins` (or restart) to apply it in the current session (it's automatic next session; a skill can't run `/reload-plugins` itself since that's interactive UI). Falls back to handing you the manual slash commands if the CLI isn't available. You don't have to remember to run it: once a day (at session start, then hourly in a session left open) the plugin checks the published version, and when yours is behind it toasts once and the Pet says so on your turn (the status line does, with the Pet off). Turning on auto-update for the `claudio` marketplace in `/plugin` (Marketplaces tab) makes all of this unnecessary. Just pulls the newest published build — for changing what a skill *does*, that's an edit to its SKILL.md. Auto-triggers on "update claudio", "update my skills to the latest", "update the toolkit".

## Integrations

### `/prd-to-jira`
Breaks down a PRD, spec, or feature document into a Jira epic with well-structured, right-sized tickets organized by work area. Auto-triggers when you share a PRD or ask to "create tickets", "break this down", "make Jira tasks".

```
/prd-to-jira                          # Expects PRD pasted in conversation
/prd-to-jira <path-or-url-or-key>     # Path, URL, or Jira ticket key
```

### `/save-session-to-worklog`
Logs the current session's work into a monthly worklog file. **Vault-aware**: if the current project is registered in `~/.config/claudio/vaults.json` (via `/vault-init` or the `vault-keeper` skill), the worklog lands in `{vault}/raw/work-logs/<user-slug>/` and an entry is appended to `{vault}/wiki/log.md`. Otherwise falls back to `~/Desktop/`. For standups and invoicing — not git history. Auto-detects the project; multiple repos belonging to the same project share one file.

```
/save-session-to-worklog                       # Auto-detect project
/save-session-to-worklog --project acme        # Force project name
```

### `/standup`
The read-back companion to `/save-session-to-worklog`: it writes daily-standup notes **from the worklog** (the ground truth the worklog skill wrote) to `~/Desktop/standup-YYYY-MM-DD.pdf`, so the update reflects what actually got done rather than what you half-remember. Reads the last working day's entries (vault-aware, same source), optionally confirms ticket status with `jira-cli`, pulls "today" from your in-progress tickets or a quick ask, and keeps it to 3-6 one-line bullets (Yesterday / Today / Blockers). PDF conversion uses macOS's built-in `cupsfilter` — no extra tooling. If the worklog has nothing logged for the last working day, it says so instead of inventing a standup. Auto-triggers on "write my standup", "standup update", "what did I do yesterday for standup".

### `/weekly-summary`
One living page per project, at a link that never changes, published as a private Artifact: a meeting brief (Shipped / In progress and upcoming), a day strip with activity counts, then Releases, Shipped and Open ledgers. It opens on the last 7 days; the reader can pick any dates (this week, last week, the last 30 days, or custom), filter by person, repo, section and text, copy the brief for Slack, and copy a link to the dates on screen. The first run in a project publishes the page and, in the desktop app, schedules a daily refresh (8:00 by default; it runs while the app is open). Each refresh adds the new days to the page's own database as day documents, so data never republishes the page and every past date keeps its brief. Facts come from GitHub PRs, Jira (tickets, and released fix versions, GitHub releases, `CHANGELOG.md` or production deploys as releases), the worklog and the vault; every line must trace to one of them. Settings live in `~/.config/claudio/weekly-summary.json`; pages from the old one-per-week version are imported as history. Without the Artifact tool it keeps a local page in `~/Desktop/weekly-summaries/`. Auto-triggers on "weekly summary", "what shipped this week", "summary for the weekly meeting", "refresh the weekly summary".

## Knowledge vaults

### `/vault-init`
Scaffold a Karpathy-style LLM Wiki vault for the current project. Interactive: asks for vault path, project path, git, and (optionally) a private GitHub repo. Writes a generic `CLAUDE.md` schema, sets up `raw/`/`wiki/`/`templates/`, and registers the project → vault mapping in `~/.config/claudio/vaults.json` so the `vault-keeper` skill auto-engages.

```
/vault-init                            # Interactive
/vault-init ~/MyProjectVault           # Specify vault path; still asks the rest
```

After init, drop sources into `{vault}/raw/`, ask Claude to ingest, and browse the result in [Obsidian](https://obsidian.md). The vault auto-updates during sessions in the registered project.

### `/vault-resolve-conflicts`
Auto-resolve merge/stash conflicts in vault markdown by keeping BOTH the incoming and local changes for every conflict block (union merge). Designed for `wiki/log.md`, `wiki/index.md`, and other append-only/list-style vault files where union-merging is almost always the right call. Vault-only — refuses to run outside a registered vault. After resolving, surfaces near-duplicate adjacent lines (the "same fact, two phrasings" pattern) for the user to pick one.

```
/vault-resolve-conflicts
```

### `/vault-keeper`
Reads from and writes to a registered project's knowledge vault (Karpathy-style LLM Wiki). Auto-fires when documenting findings (architecture decisions, integration quirks, debugging discoveries, team facts), looking up domain context, ingesting raw sources, or asking for a vault lint. Resolves the current cwd against `~/.config/claudio/vaults.json`; if no vault is registered for the project, the skill self-terminates silently. Each vault carries its own `CLAUDE.md` (the schema authority) — the skill defers to it for project-specific rules.

**Four modes triggered by user intent:**

- **Read** — domain questions ("what does X do?", "who owns Y?"). Reads `wiki/index.md`, follows links, synthesizes with citations to specific wiki pages.
- **Write** — proactive auto-update. When you encounter an integration quirk, architectural decision, debugging finding, or team fact worth preserving, the skill files it into the relevant `wiki/` subfolder and updates `index.md` + `log.md`. No permission needed for small touches.
- **Ingest** — adding a new raw source. Discusses takeaways with the user before writing, then creates a summary page + updates concept/entity pages, all cross-linked.
- **Lint** — surfaces orphans, contradictions, stub pages, stale claims, format violations, and index drift. Reports without auto-fixing.

To set up a new vault, use `/vault-init`.

### `/save-to-vault`
A deliberate end-of-session sweep that files everything valuable from the **whole conversation** into the vault in one pass. Where `vault-keeper` writes facts incidentally as they surface during work, this is the explicit "we're done, capture what we learned" command — the session-level analogue of `vault-keeper`'s ingest mode, with the conversation itself as the source. It defers to `vault-keeper`'s write-mode rules and the vault's own `CLAUDE.md` for page format, citations, and the index/log update; its added value is scope (review the entire session) and dedup (skip anything `vault-keeper` already filed this session). If no vault is registered for the project, it offers to run `/vault-init` on the spot rather than self-terminating silently.

```
/save-to-vault                                 # Sweep the whole session into the wiki
/save-to-vault save whatever's valuable        # Same, natural-language form
```

Complementary to `/save-session-to-worklog`: the worklog records *what you did* (standups/invoicing, `raw/work-logs/`); `save-to-vault` records *what you learned* (cross-linked domain knowledge, `wiki/`). Running both at session end is a reasonable habit.

### `/wrap-session`
The "do both" end-of-session command, for when you'd otherwise type `/save-session-to-worklog` and `/save-to-vault` back to back. It's a thin conductor: it invokes `save-session-to-worklog` first (forwarding any args — freetext notes, `--project`, `--dry`), then `save-to-vault`, then gives one combined report. It reimplements neither; each sub-skill's rules (project detection, vault routing, dedup, git-sync) apply unchanged. `--dry` previews the worklog and skips the vault write.

```
/wrap-session                                  # Worklog + vault sweep in one pass
/wrap-session also paired with Ana on the API  # Forwards the note to the worklog step
/wrap-session --dry                            # Preview the worklog, write nothing
```

## PR helpers

### `/pr-description`
Generates a GitHub-ready PR description from the diff and updates the PR directly via `gh`. Falls back to saving to `~/Desktop/pr-description.md` if the GitHub update fails. Auto-triggers on phrases like "write a PR description", "draft the PR body", "update the PR".

```
/pr-description              # Auto-detect PR from current branch
/pr-description 463          # Specific PR by number
/pr-description <pr-url>     # Specific PR by URL
```

### `/write-slack-message`
Drafts a Slack message ready to paste, business-casual, with **no sentence cap** — an incident summary is longer than a question, and padding the question is the same mistake as truncating the summary. Two registers: **tiny by default** (the ask or the answer, nothing else — no context, no rationale, no recommendation) and **full on request** ("full", "longer", "detailed", or an inherently multi-item update), which buys more items, not more words per item. Keeps the cut-on-sight list (reasoning, recaps, hedges, detail that belongs in the linked doc), the mandatory cut pass, and the line telling you what it cut so you can add anything back.

**Where it saves.** `~/Desktop/slack-message-for-<recipient>.md` by default, overwriting the previous draft for that person. Create `~/Desktop/slack-drafts/` and it switches to timestamped files in there instead, so rewriting a message stops destroying the version it replaces. The folder's existence is the opt-in and the skill never creates it for you. A redraft to the same person moves the draft it supersedes to the Trash, so the pane only shows the current one.

**Reading drafts back.** `/slack-drafts` opens a pane of every draft with **Copy for Slack** (an HTML clipboard copy, so `[label](url)` pastes as a real link) and delete, and its optional phone page brings the same copy to your iPhone. See [Mods](#mods).

**With the Slack MCP connected**, the report line names where to post it (the thread, channel or DM, linked so one click opens it in Slack) and who to tag (each looked up in Slack, linked to their profile), instead of a vague `everyone`. In the drafts folder the same two lines sit at the top of the draft, so the pane and the phone page show them above the message; neither copy includes them. It only reads through the MCP and never posts: anything posted that way carries a "Sent using Claude" footer.

**On a phone**, say so and the reply links the Slack Drafts phone page instead of the file path. The draft never goes in the chat, on any device.

Auto-triggers on phrases like "draft a slack message", "how should I phrase this for slack", "write up a slack post".

## Jira

### `/jira-cli`
Read/update/comment/transition Jira tickets directly from the shell via the bundled `jira-curl` CLI. Supports multiple Jira instances per machine (e.g. work + personal). Auto-triggers when you paste a Jira URL or key (`ACME-1234`, `WEB-456`) or say things like "update the description on ABC-123", "add a comment to …", "what's the status of …", "move this to In Progress".

**First-time setup:** the skill self-installs on first use — Claude detects the missing binary, runs the bundled installer, and prompts you for credentials. If you'd rather set it up manually:

```
bash "$(ls -dt ~/.claude/plugins/cache/*/claudio/*/skills/jira-cli/scripts/jira-curl 2>/dev/null | head -1)" install
jira-curl init <name>      # interactive: base URL + email + API token
jira-curl list             # show configured instances
```

Credentials are stored at `~/.config/jira/credentials` with mode 600. Add as many instances as you need by re-running `jira-curl init <name>`. If `~/.local/bin` isn't on your `$PATH`, the installer prints the export line to add to your shell rc.

## Code review

### `/pr-review` — Confidence-scored code reviews (3 modes)

Runs multiple focused review agents in parallel, each examining the code from a different angle (security, correctness, code quality, performance). Findings are scored on a 0-100 confidence scale, and only issues scoring 80+ are surfaced — cutting noise while catching real problems. Results are saved to a markdown file you can share, reference later, or track progress against as you fix issues.

**Stack-aware:** the changed files decide which reviewers run. Security, correctness and quality run on every PR. A frontend diff adds the performance/UX/accessibility reviewer; a backend diff adds the runtime/data/contracts reviewer (blocking I/O in async handlers, transactions and races, idempotency, migrations, paid external calls, route-level tests); a full-stack diff gets both. When a backend change removes or renames a route, field, or event, the reviewers grep the sibling repos for callers and check whether those callers are live in production before rating it.

#### The three modes

| Mode | When | Input | Output filename |
|------|------|-------|-----------------|
| **PR** (default) | A PR number is given or auto-detected from the current branch | The PR's diff | `pr-review-{number}.md` |
| **Local** | No PR exists, OR `--local` flag, OR you ask to "review my uncommitted work" / "review my branch" | `git diff origin/main...HEAD` + uncommitted | `pr-review-{branch}.md` |
| **Full repo** | `--full-repo` flag, OR you ask for a "full repo audit" / "audit the whole codebase" | Every source file (with sensible exclusions) — confirms before running on >50 files | `code-audit-{repo}.md` |

#### Usage

Auto-triggers on natural language. Examples:

```
review PR #463                           → PR mode
run a pr review                          → Auto-detect PR; falls back to local if none
review PR 463 in lite mode               → Lightweight: fewer agents, diff-only
review my uncommitted changes            → Local mode
audit my branch                          → Local mode
audit the whole repo                     → Full repo mode (asks to confirm if >50 files)
do a full repo audit in lite mode        → Full repo + lite
```

Or invoke explicitly via slash with flags:

```
/pr-review --local
/pr-review --full-repo
/pr-review --full-repo --lite
/pr-review 463 --comment
```

**GitHub-comment ready.** The review file renders cleanly as a PR comment: a one-line title with the risk, a short verdict, a counts table, then numbered findings with plain-English titles, linked locations, and the suggested fix collapsed as a diff. Minor findings, fixed items, and history collapse in `<details>`. Pass `--comment` (PR mode) to post it directly — the skill maintains one living review comment per PR, updated in place on every re-run.

#### Modes

| | Full (default) | Lite |
|---|---|---|
| **Core agents** | Security, correctness, quality, plus frontend and/or backend reviewer by stack | 2 combined (security+correctness, quality+stack lens) |
| **Specialist agents** | Up to 3 additional (silent failures, comments, types) when triggered | Same triggers apply |
| **File reading** | Every changed file read in full | Diff only, selective file reads |
| **Code snippets** | Before/after fix suggestions included | Descriptions only |
| **Subagent model** | Your active model | Sonnet |
| **Direct review threshold** | ≤3 files / ≤150 lines | ≤8 files / ≤500 lines |
| **Best for** | Final reviews, security-sensitive changes, large PRs | Day-to-day PRs, quick checks, iterating on fixes |

**Tip:** Run a full review first, then use lite for re-checks as you iterate. Both write to the same file.

#### The Review Loop

The skill is designed for iterative use, not just one-shot reviews.

```
1. Run pr-review            → Initial review, issues identified
2. Fix the flagged issues    → Make code changes
3. Run pr-review again       → Resolved issues marked ✅ Fixed (strikethrough),
                               new issues from your fixes surfaced
4. Repeat                    → Until the review is clean
```

When the skill detects a prior review file (same PR, same day):
- **Resolved issues** get ~~strikethrough~~ with a ✅ Fixed badge — they stay visible for history but are excluded from issue counts
- **Still-open issues** remain unchanged
- **New issues** are appended to the appropriate severity section
- **Issue counts and risk level** are recalculated based on open issues only
- **A revision entry** is added to the log at the bottom of the file

#### Review Agents

**Core agents (full mode; Agent 4F/4B chosen by the diff's stack)**

- **Agent 1 — Security** (*think like an attacker*): input validation, injection (SQL/XSS/command), authn/authz bypass, sensitive data exposure, CSRF/CORS/headers, insecure deserialization, breaking changes (consumers of modified types/exports/APIs)
- **Agent 2 — Correctness** (*think like a QA engineer*): race conditions, null/undefined handling, logic errors, memory leaks, state management bugs (stale closures, missing hook deps), error propagation, edge cases
- **Agent 3 — Code Quality** (*think like a senior reviewer*): typing for the languages in the diff (TypeScript strictness, Python type hints/pydantic), SOLID, DRY, naming, project pattern adherence (reads CLAUDE.md), test coverage, missing companion changes (typegen, env vars, etc.)
- **Agent 4F — Frontend Performance & UX** (*frontend/fullstack diffs; think like a user on a slow connection*): re-renders/memoization, query/fetching efficiency, bundle size (client vs server), accessibility, loading/error states, cleanup, dependency audit when `package.json` changed
- **Agent 4B — Backend Runtime, Data & Contracts** (*backend/fullstack diffs; think like the on-call engineer*): blocking I/O in async handlers, transactions and read-then-write races, idempotency, API/event contract changes (sibling repos grepped for callers), migrations, paid/rate-limited external calls, error-to-status mapping, route-level tests, dependency audit when `pyproject.toml`/`requirements*.txt`/`go.mod`/`Gemfile` changed

**Specialist agents (triggered automatically when relevant)**

- **Silent Failure Hunter** — fires when diff has try/catch, `.catch()`, `|| fallback`, etc. Looks for swallowed errors, masking fallbacks, missing logging, retries without backoff.
- **Comment Accuracy** — fires when diff adds/modifies 5+ comment lines. Catches comments that contradict code, stale references, undocumented TODOs, JSDoc mismatches.
- **Type Design** — fires when diff introduces new types/interfaces. Flags types allowing invalid states, missing `readonly`, overly broad types (`any`), missed discriminated unions.

**Lite mode** consolidates the core agents into 2 (Security+Correctness, Quality+the frontend and/or backend lens) and reads diff only. Specialist agents still trigger when relevant.

#### Confidence Scoring

Every finding is scored 0-100:
- **0-49**: likely false positive or pre-existing → filtered out
- **50-79**: might be an issue but below threshold → filtered out
- **80-100**: high confidence → included in review

If 2+ agents independently flag the same issue, severity gets boosted one tier (suggestion → improvement → critical). Cross-agent agreement is a strong signal.

#### Output Format

Reviews saved as `pr-review-{PR_NUMBER}.md` (one stable file per PR — re-runs update it incrementally; dates live in the header and revision log) containing:
- Risk assessment (🟢 LOW / 🟡 MEDIUM / 🔴 HIGH / ⛔ CRITICAL)
- Issues grouped by severity with location, confidence score, impact
- Before/after code snippets (full mode only)
- Breaking changes and dependency notes
- Good practices observed
- Issues indexed by file
- Revision history

#### How It Compares

`pr-review` vs Anthropic's built-in `review-pr` toolkit:

![Comparison](comparison.png)

### `/review-cycle`
The review-**and-fix** loop, where `/pr-review` only reviews. It's a thin conductor over `/pr-review`: it reviews the PR and posts the findings as **one living PR comment**, then fixes the findings it judges worth fixing (critical + solid improvements — it leaves nitpicks/false-positives/out-of-scope with a noted reason, not a blind fix-everything), runs the repo's quality gates, pushes, and **edits that same comment in place** on each pass (strikes through what's fixed, surfaces anything new) — looping until clean. **Other AI reviewers are folded in when the PR has them**: it finds any review bot by account type rather than by name (GitHub Copilot, CodeRabbit, and whatever a repo runs), drops deploy and coverage bots, checks each bot claim against the current code, triages the real ones with its own findings, then replies on each bot thread and resolves the settled ones. A repo with no review bots just skips that step. The end state is one PR comment that tracked the review to resolution, plus a short summary of what was fixed vs deliberately left. Reach for it when you want the issues *fixed and pushed*, not just listed. `/shipit` invokes it as its self-review step (after asking whether the PR even needs a cycle). Auto-triggers on "run the review cycle", "review and fix this PR", "do the review loop". Never deploys/publishes — a review cycle fixes and pushes, nothing more.

## Mods

The plugin also carries one function-hooks module ([`hooks/register.tsx`](hooks/register.tsx)) with two mods. Built on Claude Code's function-hooks plugin API (early access, may change between releases).

### Usage band

A band above the prompt (terminal and desktop Code tab) with two bars:

```
Context       ━━━━──────────────  14%  used · 137.8K of 1.0M
5-hour limit  ━━━───────────────  18%  used · resets in 4h 51m
```

- **Context**: context window used. Green, then yellow from 40%, orange from 60%, red from 85%.
- **5-hour limit**: how much of the 5-hour rate-limit window you've used, filling from empty as you go. Green, then yellow from 50% used, orange from 75%, red from 90%. Shows "no reading yet" until the first reply (and off a subscription).

Desktop draws SVG bars; the terminal draws `■□` bars. Updates after every turn, and the reset countdown ticks every minute. Collapse it with `[-]` or ctrl+x ctrl+a.

Off by default, since another plugin's band (a skin, say) may want that spot: turn on the **Usage bars** option in `/config`, or set `pluginConfigs["claudio@claudio"].options.usageBars` to `true` in `~/.claude/settings.json`.

#### Pet

A small 16-bit pixel pet on the band's right edge, showing at a glance whether Claude needs you:

- **Working** (blue): acts out the running tool, with glasses on for focused work. Read, Grep and Glob read a turning book; web searches and fetches sweep a magnifying glass; Edit and Write scribble with a pencil; plans and todos tick a clipboard; browser tools type on a laptop; subagents juggle three balls; skills wave a wand; Slack, mail and notifications throw a paper plane; Bash and every other tool swing a hammer. Between tools it puts on a sweatband and plays something different each time (basketball, keepy-uppy, weights, jump rope), or hops with thought bubbles.
- **Skills**: while a claudio skill runs, the gap between its tools shows that skill's own scene instead of play: `/shipit` sails a ship over the waves, `/wrap-session` wraps a gift, `/cut-release` snips a ribbon, `/promote-to-prod` launches a rocket, `/investigate` puts on a deerstalker with a magnifying glass, `/pr-review` and `/review-cycle` underline a page in red pen, the triage skills sort letters into a tray, and `/save-to-vault` and `/save-session-to-worklog` slide a scroll into a safe. It catches the skill however it starts (typed, auto-triggered or preloaded), keeps it through helper skills that have no scene of their own, and drops it when the turn ends, so after a skill stops to ask you something the next turn plays as usual.
- **Detail**: an outline, a sheen and a shadow give the body volume, its eyes catch the light, and it gets rosy cheeks on your turn.
- **Your turn** (green): smiles and blinks now and then once the turn is done.
- **Needs you** (orange): open mouth and a flashing "!" while a permission dialog, a question (AskUserQuestion) or a plan to approve (ExitPlanMode) waits on you.
- **Update me** (red): on your turn while a newer claudio is published, it shakes and frowns under a flashing 💢, with `claudio X is out: run /update-claudio, or turn on auto-update in /plugin` under "Your turn".

It also wears the session's numbers, on the band's own thresholds: it grows wider at 60% and 85% context, and on your turn past 60% it says `Context N% full: try /compact or /clear`. Past 75% of the 5-hour window it gets tired: heavy lids, everything at half speed, and a "z" while it waits.

Desktop draws an animated SVG (still under reduced motion); the terminal draws a one-row text sprite (`( •_•)📖`, `(=‿=)z`) stepping every half second. It shows with or without the usage bars, and gives way when the band is too narrow for both. An approved command keeps "Needs you" until it finishes, since no event marks the moment a dialog is approved. Off by default: turn on the **Pet** option in `/config`, or set `pluginConfigs["claudio@claudio"].options.pet` to `true`. While it's off, one toast per install points at it, since an update skips the install screen that lists new options.

### `/slack-drafts`

A pane for the drafts `/write-slack-message` saves to `~/Desktop/slack-drafts/`, plus an optional phone page so you can paste them from your iPhone with Slack formatting intact.

- `/slack-drafts` opens the pane: one card per draft, newest first, rendered as Markdown with each `@name` in purple (a typed @ pastes as plain text, so those are the ones to re-tag in Slack), with where to post it and who to tag (linked) above the message when the skill found them.
- Saving a draft opens the pane on its own, and a save or delete in any session shows in every open pane within a few seconds.
- **Copy for Slack** puts an HTML version on the Mac clipboard (via `osascript`), so `[label](url)` pastes as a link and backticks as code.
- **Sent** takes the draft off the list and moves it into `sent/` inside the drafts folder, so Claude can tell a message you sent from one you threw away. The **trash icon** discards it (moves the file to the Trash). Sent drafts stay for 1 day, then move to the Trash at the next session start; the **Keep sent Slack drafts** option (`/config`, or `pluginConfigs["claudio@claudio"].options.sentDays`: 1, 3, 7, 14 or 30) changes that.
- `SLACK_DRAFTS_DIR` overrides the folder.

**On your phone.** Slack on iOS only keeps formatting when the clipboard carries HTML, which the Claude app cannot put there for a mod. So drafts are mirrored to a private claude.ai artifact ([`slack-drafts-phone/index.html`](slack-drafts-phone/index.html)) whose **Copy for Slack** button does that copy in the browser. Each save, delete or `/slack-drafts` appends rows to that artifact's database through the `ArtifactData` tool (approve it once). The page shows the newest row per draft and tidies the rest. **Sent** and the **trash icon** on the page do the same to the Mac file (into `sent/`, or to the Trash), within about 30 seconds of the next tool call in any Claude Code session, or at once on `/slack-drafts`.

Set it up once per account:

1. Publish `slack-drafts-phone/index.html` as an artifact with `slack-drafts-phone/slack-html.js` beside it and capabilities `{"db": {"rules": [{"path": "drafts", "read": "owner", "write": "owner"}]}, "user": {}}` (ask Claude to do it).
2. Put its URL in the plugin's **Slack drafts phone page** option (`/config`, or `pluginConfigs["claudio@claudio"].options.phoneUrl` in `~/.claude/settings.json`).
3. Pin the page in claude.ai so it is one tap away on the phone.

Leave the option empty to skip the phone copy.

The page is a published copy of `slack-drafts-phone/`, so a claudio update that changes those files does not reach it on its own. After such an update, republish the page to the same URL (ask Claude; the URL, the pin and the drafts stay). A page older than 4.6.0 copies the where-to-post header along with the message.

### Developing the mods

`slack-drafts-phone/slack-html.js` is built from `hooks/slack-html.ts`, so the pane and the page share one converter. From `plugins/claudio`, after changing it:

```
npx esbuild@0.24.2 hooks/slack-html.ts --bundle --format=iife --global-name=SlackHtml --target=es2020 --outfile=slack-drafts-phone/slack-html.js
```

Then republish the artifact with the new `slack-html.js`. Check any hooks change with:

```
claude plugin validate .
claude plugin test .
```


## Subagents

### `code-reviewer`

The bundled review agent behind `/pr-review` (launched as `claudio:code-reviewer`). Each parallel instance reviews one focus area — security, correctness, quality, performance, or a specialist pass — and returns confidence-scored, high-signal findings. Not meant to be invoked directly; the skill dispatches it with a full prompt.

## License

MIT
