<p align="center">
  <img src="claudio-skills.webp" width="420" alt="claudio-skills">
</p>

<h1 align="center">claudio</h1>

A Claude Code plugin marketplace by Bernardo Rubin. One plugin (`claudio`) bundles everything: the skills, with no command/skill prefixes to type, plus two mods, a usage band above the prompt and a Slack drafts pane.

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

## What's inside `claudio`

Everything is a **skill** — no `claudio:` prefix needed when invoking. Skills appear in the slash palette as `/<name>` and auto-trigger on natural language.

| Skill | Triggers on |
|-------|-------------|
| `/create-app` | "let's build an app", "new app idea", "take this app to the App Store" — zero-to-**first**-release: spec → build → production auth → store readiness → submittable build, stops before submitting |
| `/shipit` | "ship ABC-123", "take this ticket end to end", "implement ABC-456 and open a PR" — full pipeline: understand → implement → PR → CI green → log → Slack, stops before deploy |
| `/cut-release` | "cut a release", "ship a build", "prep the release", "new App Store build" — per-release: pre-flight the gates (version train / build slot / CI), bump, build, release notes, hand back the submit command |
| `/promote-to-prod` | "promote to prod", "push it to prod", "staging then prod" — the full ladder: PR into staging → green → merge → verify on staging → PR into main → green → merge → confirm prod is healthy *and* the fix is live, with evidence saved locally, then the Jira ticket (if any) moved to Done or Ready for QA |
| `/investigate` | "investigate X", "look into why Y", "figure out what's going on with Z", pasting an incident/alert — evidence-grounded diagnosis, read-only |
| `/vercel-triage` | "check the Vercel logs and make tickets", "triage the Vercel errors", "/vercel-triage 48" — sweeps prod + staging errors and warnings for the last N hours (default 24), drops the noise, dedupes against Jira, files new bugs labelled `vercel-triage`, comments recurrences, and closes labelled tickets whose error stopped |
| `/figma-to-jira` | "I got Figma notifications, please check", "turn the Figma comments into tickets", "/figma-to-jira 2d" — finds every comment that mentions you (or replies in your threads) across the watched Figma projects, screenshots where it's pinned, groups related ones, skips what's already ticketed, and files the rest with the screenshot and a deep link to the comment
| `/qa` | "QA this ticket", "verify the ACs", "test this and show me it works" — exercises every AC against the real system, captures evidence, then publishes a pass/fail/could-not-verify report to Jira, the PR, or Slack (asks you where if unclear) |
| `/qa-video` | "record a video of this", "a screenshot won't show this", "video QA" — records the browser page headlessly with Playwright (no terminal in frame), compresses it under GitHub's 10MB cap with ffmpeg, attaches it to Jira and hands back the PR paste; first run installs ffmpeg |
| `/pr-review` | "review this PR", "review my uncommitted changes", "audit the whole repo" — three modes: PR / local / full-repo; picks frontend or backend reviewers from the changed files |
| `/review-cycle` | "run the review cycle", "review and fix this PR", "do the review loop", "address Copilot's comments" — reviews → posts a living PR comment → folds in any AI reviewer already on the PR (Copilot, CodeRabbit, ...) → fixes what's worth fixing → pushes → answers and resolves the bot threads → updates the comment, until clean (reuses `/pr-review`) |
| `/pr-description` | "write a PR description", "draft the PR body", "update the PR" |
| `/write-slack-message` | "draft a slack message", "how should I phrase this for slack" — tiny by default, saves to a drafts folder, which the `/slack-drafts` pane shows with a copy button that keeps Slack links working; with the Slack MCP, resolves mentions and a Send button posts it |
| `/prd-to-jira` | "create tickets from this PRD", "break this down into jira tasks" |
| `/jira-cli` | Jira URL or key (ACME-1234, WEB-456), "update the description on ABC-123", "add a comment to …", "what's the status of …", "move this to in progress" |
| `/vault-keeper` | "save this to the vault", "what does the wiki say about X", "ingest this doc", "lint the wiki" (auto-fires inside any registered vault project) |
| `/save-to-vault` | "save whatever's valuable from this session", "dump this session to the wiki", "file everything worth keeping" — deliberate whole-session sweep |
| `/vault-init` | "init a vault here", "set up a knowledge vault", "scaffold the wiki" |
| `/vault-resolve-conflicts` | "resolve vault conflicts", "union merge the vault" |
| `/git-ac` | "commit but don't push", "stage and commit locally" |
| `/git-pull-reapply` | "pull and reapply", "safe pull", "rebase from remote" |
| `/save-session-to-worklog` | "save this session", "log to worklog", "update my standup notes" |
| `/standup` | "write my standup", "standup update", "what did I do yesterday for standup" — writes a short standup-notes PDF from the worklog (ground truth, not memory) |
| `/weekly-summary` | "weekly summary", "what shipped this week", "summary for the weekly meeting" — builds a shareable weekly page (meeting brief, day strip, releases, shipped, open) from GitHub, Jira, the vault and the worklog |
| `/wrap-session` | "wrap up the session", "save to worklog and vault", "do both" — runs `/save-session-to-worklog` then `/save-to-vault` in one pass |
| `/session-status` | "where are we", "what's the status of everything", "what's still open", "loose ends" — status board of every request in the session (feature, bugfix, ticket, unanswered question), verified against git/PRs/Jira, plus what's blocking and what's missing |
| `/handoff` | "write a handoff doc", "hand this off to a new session", "context is getting long" — compacts the conversation into `~/Desktop/handoff-<slug>.md` for a fresh session to pick up |
| `/claude-learn` | "document what we learned", "update CLAUDE.md with this" |
| `/claude-modularize` | "split up CLAUDE.md", "modularize CLAUDE.md" |
| `/update-claudio` | "update claudio", "update my skills to the latest", "update the toolkit" — pulls the newest published version of this plugin via the `claude plugin` CLI |

The plugin also bundles one subagent: `code-reviewer`, the parallel review agent `/pr-review` launches for its focus-area passes.

See [`plugins/claudio/README.md`](plugins/claudio/README.md) for full details on every skill, the PR review modes (PR / local / full-repo), and the iterative review loop.

## Mods

Two function-hook mods ship inside `claudio`, so there is nothing extra to install:

- **Usage band**: two bars above the prompt (terminal and desktop Code tab), context window used and what's left of the 5-hour rate-limit window, orange then red as each nears its limit. Off by default; turn on the plugin's **Usage bars** option in `/config`.
- **`/slack-drafts`**: a pane for the drafts `/write-slack-message` saves, with a copy button that keeps Slack links and code, and a Send button for drafts with a Slack destination.

## License

MIT
