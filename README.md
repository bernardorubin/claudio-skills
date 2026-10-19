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
| `/vercel-triage` | "check the Vercel logs and make tickets", "triage the Vercel errors", "/loop 1h vercel-triage" — sweeps prod + staging errors and warnings since the last check (or the last N hours), drops the noise, dedupes against Jira, and suggests new bugs, recurrence comments and closes for labelled tickets whose error stopped; files only what you pick (`--file` for all) |
| `/figma-triage` | "I got Figma notifications, please check", "turn the Figma comments into tickets", "/loop 2h figma-triage" — finds every comment that mentions you (or replies in your threads) across the watched Figma projects, groups related ones, skips what's already ticketed, and suggests a ticket for the rest; the ones you pick are filed with a screenshot of where the comment is pinned and a deep link to it (formerly `/figma-to-jira`) |
| `/slack-triage` | "check my slack", "anything on slack for me?", "/loop 20m slack-triage" — reads your mentions and DMs since the last check, skips what's handled, and suggests a drafted reply, a Jira ticket (deduped against Jira) or a PR to review for each; suggests only, never posts |
| `/super-triage` | "triage everything", "what needs me?", "/loop 1h super-triage" — runs `/slack-triage`, `/inbox-triage`, `/figma-triage` and `/vercel-triage` together and reports one merged, numbered list across all four |
| `/inbox-triage` | "check my email", "anything in my inbox?", "/loop 1h inbox-triage" — reads the Gmail inbox since the last check, drops notifications and noise, and suggests a reply (saved as a Gmail draft) or a Jira ticket (deduped against Jira) for each; never sends or archives |
| `/qa` | "QA this ticket", "verify the ACs", "test this and show me it works" — exercises every AC against the real system, captures evidence, then publishes a pass/fail/could-not-verify report to Jira, the PR, or Slack (asks you where if unclear) |
| `/qa-video` | "record a video of this", "a screenshot won't show this", "video QA" — records the browser page headlessly with Playwright (no terminal in frame), compresses it under GitHub's 10MB cap with ffmpeg, attaches it to Jira and hands back the PR paste; first run installs ffmpeg |
| `/pr-review` | "review this PR", "review my uncommitted changes", "audit the whole repo" — three modes: PR / local / full-repo; picks frontend or backend reviewers from the changed files |
| `/review-cycle` | "run the review cycle", "review and fix this PR", "do the review loop", "address Copilot's comments" — reviews → posts a living PR comment → folds in any AI reviewer already on the PR (Copilot, CodeRabbit, ...) → fixes what's worth fixing → pushes → answers and resolves the bot threads → updates the comment, until clean (reuses `/pr-review`) |
| `/pr-description` | "write a PR description", "draft the PR body", "update the PR" |
| `/write-slack-message` | "draft a slack message", "how should I phrase this for slack" — tiny by default, saves to a drafts folder, which the `/slack-drafts` pane shows with a copy button that keeps Slack links working; with the Slack MCP, names where to post (linked) and who to tag |
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

**Built for `/loop`.** `/slack-triage`, `/inbox-triage`, `/figma-triage` and `/vercel-triage` each check everything since their last run and suggest instead of acting, so they can run on their own timers inside the conversation you are working in: `/loop 20m slack-triage`, `/loop 1h inbox-triage`, `/loop 2h figma-triage`, `/loop 1h vercel-triage`, or all four at once with `/loop 1h super-triage`. See [Running the triage skills on a loop](plugins/claudio/README.md#running-the-triage-skills-on-a-loop) for what each check covers.

See [`plugins/claudio/README.md`](plugins/claudio/README.md) for full details on every skill, the PR review modes (PR / local / full-repo), and the iterative review loop.

## Mods

Two function-hook mods ship inside `claudio`, so there is nothing extra to install:

- **Usage band**: two bars above the prompt (terminal and desktop Code tab), context window used and 5-hour rate-limit window used, green, yellow, orange then red as each fills. Off by default; turn on the plugin's **Usage bars** option in `/config`. A separate **Pet** option adds a pixel pet on the band's right edge: blue and acting out the running tool (a book, a magnifying glass, a laptop, a wand, juggling) and playing sports between tools while Claude works, green on your turn, orange when it waits on an approval or an answer; it grows with the context, suggests `/compact` or `/clear` as it fills, and tires near the 5-hour limit.
- **`/slack-drafts`**: a pane for the drafts `/write-slack-message` saves, with a copy button that keeps Slack links and code, and an optional private phone page to paste them from your iPhone.

See [the plugin README's Mods section](plugins/claudio/README.md#mods) for the one-time phone setup.

## License

MIT
