# claudio-skills repo (the claudio marketplace)

This repo is a Claude Code **plugin marketplace**. It is not application code — there is no build, no test runner, and no package manager. Everything here is JSON manifests + markdown skill definitions consumed by the Claude Code harness.

## Repo layout

```
claudio-skills/                       # repo folder; the plugin inside is named claudio
├── .claude-plugin/
│   └── marketplace.json              # marketplace manifest — lists every plugin
├── plugins/
│   └── claudio/                       # the one plugin (see below)
│       ├── .claude-plugin/
│       │   └── plugin.json           # plugin manifest
│       ├── skills/                   # skill folders, each with SKILL.md
│       ├── agents/                   # subagents as .md files (optional)
│       ├── hooks/                    # function-hooks mods: usage band (+ pet) + /slack-drafts pane (register.tsx)
│       ├── types/                    # the mods' $.state contract
│       ├── slack-drafts-phone/       # phone artifact page; slack-html.js is built from hooks/slack-html.ts
│       ├── README.md                 # user-facing plugin docs
│       └── comparison.png            # asset referenced by README
└── README.md                         # marketplace overview, install instructions
```

## How everything wires together

- **Marketplace name**: `claudio` (set in `.claude-plugin/marketplace.json`)
- **GitHub identifier**: `bernardorubin/claudio-skills` (used in `/plugin marketplace add`)
- **Single plugin**: `claudio` — bundles 33 skills (no commands) and one hooks module carrying two mods. The `pr-review` skill itself supports three modes: PR review, local diff review, and full-repo audit.
- **Install path** (after `/plugin install`): `~/.claude/plugins/cache/claudio/claudio/<version>/`

When users update the marketplace and reinstall, the harness pulls from `main` of this repo via the `git-subdir` source defined in `marketplace.json`.

## Mods (function hooks)

`hooks/register.tsx` holds every hook for both mods because the engine loads one hooks module per plugin, allows one unmatched `session.start` hook, and never follows `$` across an import. Pure helpers (`slack-html.ts`, `usage-bars.ts`, `pet.ts`) can live in their own files. Check changes with `claude plugin validate` and `claude plugin test` from `plugins/claudio`. In the desktop app a click on an unfocused pane only focuses it, so pane Buttons need two clicks ([anthropics/claude-code#99395](https://github.com/anthropics/claude-code/issues/99395)); a `ui.focus` workaround was tried in 4.0.1 and cannot work, because the pane already reports itself focused when the hook runs.

## Skills only — no commands

This plugin uses **skills exclusively** (no commands). Skills appear in the slash palette as `/<name>` with no `claudio:` prefix, and **auto-trigger** when Claude matches the user's natural language against the skill's `description`.

The historic command/skill split was dropped because the prefix made commands painful to type. Skills cover both use cases:

- For **safety-critical actions** (destructive, wide blast radius), make the skill's `description` narrow and require an explicit user verb (e.g., "Use when the user explicitly asks to..."). This prevents over-triggering.
- For **conversational actions** (PR descriptions, slack messages), make the `description` broad with many trigger phrases.

**The `description` field is load-bearing** — it's what Claude matches against the user's natural language. Include explicit trigger phrases ("Triggers on phrases like ...") for skills you want to be eager. Narrow the description if a skill misfires.

## Adding a new skill

1. Create `plugins/claudio/skills/<name>/SKILL.md` with frontmatter:
   ```
   ---
   name: <name>
   description: <description that drives auto-trigger — include explicit trigger phrases>
   ---
   ```
2. Optionally add `evals/`, `references/`, `scripts/`, etc. as siblings of `SKILL.md`.
   Scripts ship with the plugin and are installed into the plugin cache, so keep them
   dependency-free (stdlib / system tools) and commit them executable — `write-slack-message`
   is the working example. Reference them from `SKILL.md` relative to the skill directory,
   never by an absolute path, since the cache path carries the version number.
3. Document in `plugins/claudio/README.md` and the root `README.md`, and bump the skill count in the plugin README's headline (the manifests deliberately carry no count).

The skill becomes invocable as `/<name>` (no prefix) and via the Skill tool as `claudio:<name>`.

## Adding a new subagent

1. Create `plugins/claudio/agents/<name>.md` with frontmatter:
   ```
   ---
   name: <name>
   description: <when this agent should run; can include "Should automatically run after..." for auto-dispatch>
   # Optional: model: sonnet | opus | haiku — only set if the agent specifically benefits from a fixed model. Default is to inherit the user's active model.
   ---
   ```
2. Body is the agent's system prompt — what it specializes in, how it should behave.
3. Document in the Subagents section of both READMEs.

The agent becomes invocable via the Task tool as `subagent_type: claudio:<name>`.

## Conventions

- **Naming**: keep skill names short and descriptive. They're invoked as `/<name>` with no prefix.
- **No AI co-author lines** in commit messages, PR titles/bodies, or any other artifact. Normal commit-and-push defaults apply here; pushing to `main` is what publishes (see Publishing flow), so that push is the step worth being deliberate about, not the commit.
- **README is the source of truth** for what each skill does — keep it in sync when behavior changes.
- **Single source of truth**: skill files live ONLY here. The user's `~/.claude/commands/` and `~/.claude/skills/` should not contain copies of anything bundled in `claudio` (avoids drift).
- **Config paths**: shared config lives under `~/.config/claudio/` (e.g., `vaults.json` for the vault registry). Env-var overrides are prefixed `CLAUDIO_*` (e.g., `$CLAUDIO_VAULT_USER`).
- **Shared vault plumbing is intentionally duplicated** so each skill stays self-contained. Two blocks: the vault-registry resolver (canonical: `vault-keeper` Step 1; copies in save-to-vault, vault-resolve-conflicts, save-session-to-worklog) and the git-sync/union-merge block (canonical: `vault-keeper` hard rule 6; copies in save-to-vault Step 6, save-session-to-worklog Step 5.7). Every copy carries an HTML-comment marker. When editing either block, edit the canonical first and propagate to every marked satellite in the same change.

## Versioning

`plugin.json` and `marketplace.json` both have a `version` field — keep them in sync. Bump on meaningful changes (new skill, behavior change). Patch bumps for typo/doc-only changes are optional.

## Publishing flow

1. Make changes, validate JSON files parse:
   ```bash
   python3 -c "import json; json.load(open('.claude-plugin/marketplace.json'))"
   python3 -c "import json; json.load(open('plugins/claudio/.claude-plugin/plugin.json'))"
   ```
2. Commit + push to `main`.
3. On any machine that already has the marketplace: `/plugin marketplace update claudio` → `/plugin install claudio@claudio` to pull updates.

There is no app store, approval process, or release pipeline — pushing to `main` is publishing.
