---
name: slack-drafts-mobile
description: Set up, check, re-pair or re-key the Slack Drafts phone page that the user's /write-slack-message drafts sync to, so they can copy a draft into Slack on their phone with links and code intact and tap Sent there. Two pages to pick from at setup: a pinned Slack Drafts Artifact, opened in the Claude app (the default), or a small page on the user's own Vercel account with GitHub sign-in. Triggers on "set up slack drafts on my phone", "slack drafts mobile", "/slack-drafts-mobile", "pair my phone with slack drafts", "the phone page isn't syncing", "rotate the slack drafts token", "set up GitHub sign-in for slack drafts", "switch slack drafts to the artifact page". Arguments: none (set up or check), "artifact" or "vercel" (switch page), "pair" (a new phone code, Vercel), "--rotate" (a new token, Vercel).
---

# Slack Drafts on the phone

Sets up one of two phone pages and records the pick in this plugin's `page` option, which its mod reads. Re-running it is safe: every step checks what is already there.

- **Artifact (the default):** a pinned "Slack Drafts" Artifact on the user's claude.ai account, opened in the Claude app (desktop, web or phone) under their pinned Artifacts. No deploy and no keys. Each session finds the page by its name, so no link is stored anywhere. It needs Artifacts turned on for the account (an organization can turn them off), and only sessions with the Artifact tools sync it.
- **Vercel (the backup):** deploys this plugin's `app/` to the user's **own personal Vercel account** with a free Upstash Redis store and GitHub sign-in, and keeps the page's link and token in the macOS keychain. It works in every session and on any account, Artifacts or not.

The mod then syncs on its own: a draft saved to `~/Desktop/slack-drafts` is on the page within 3 s, and a Sent or delete tap on the phone moves the file (`sent/` or the Trash) within 30 s on the Artifact page, 15 s on the Vercel page, while Claude Code is open on the Mac.

## Rules

- **Never print the token, never put it in the chat.** It moves between the keychain and Vercel only through a pipe or a `$(security …)` substitution inside a command. Print status codes and names, never values.
- **Personal scope only.** Pass `--scope <personal team>` on every `vercel` command. Vercel won't take the username as a scope; the personal account is the team named "<username>'s projects" in `vercel teams ls` (slug like `bernardorubins-projects`). Use a company team only when the user names one in this conversation.
- **Say before deploying.** One line ("Deploying the page to your Vercel account bernardorubin") before `vercel deploy`; the user asked for it by running this skill.
- macOS only (the keychain and `open`). Anywhere else, say so and stop.

Shorthand used below:

```bash
APP=~/.config/claudio/slack-drafts-mobile/app
kc() { security find-generic-password -s claudio-slack-drafts-mobile -a "$1" -w; }  # a function, since zsh won't split a command kept in a variable
```

## 1. Preflight

1. **Where the drafts live, first.** The page shows the drafts in one folder: `$SLACK_DRAFTS_DIR` when it's set (`printenv SLACK_DRAFTS_DIR`), else `$HOME/Desktop/slack-drafts`. Write every folder as an absolute path, since `~` doesn't expand inside the quotes below. `/write-slack-message` saves there only when the folder exists, so without it the page stays empty. When it exists, name it in one line and go on. When it doesn't, ask the user before anything else where their drafts should go, with that folder first (recommended) and another folder second:
   - That folder: `mkdir -p "<it>"`.
   - Another folder: `mkdir -p "<it>"`, then set `SLACK_DRAFTS_DIR` to its absolute path in the `env` block of `~/.claude/settings.json`, keeping everything else in the file: `t=$(mktemp) && jq --arg d "<it>" '.env.SLACK_DRAFTS_DIR = $d' ~/.claude/settings.json > "$t" && cat "$t" > ~/.claude/settings.json; rm -f "$t"` (with no settings file yet, write `{"env":{"SLACK_DRAFTS_DIR":"<it>"}}`). Sessions read `env` when they start, so the report tells the user to restart Claude Code. claudio's `/slack-drafts` pane, `/write-slack-message` and this plugin's mod all use the folder.

   The user's answer is the opt-in the folder stands for, so making it here is fine; never make it without asking.
2. **Which page.** Read the current pick: `jq -r '.pluginConfigs["slack-drafts-mobile@claudio"].options.page // empty' ~/.claude/settings.json`. An `artifact` or `vercel` argument is the pick; else the one set. With neither (empty or `auto`), ask the user. Recommend Vercel when `kc url 2>/dev/null` finds a link (a Vercel page set up before 0.3, which the mod keeps syncing while no page is picked), else Artifact:
   - Artifact: opens in the Claude app, nothing to deploy, but it needs Artifacts on their claude.ai account, and drafts only sync while a session with the Artifact tools is open.
   - Vercel: works in every session and on any account, but needs the Vercel CLI, an Upstash store and a GitHub OAuth app.

   When the pick differs from the one set, record it now and tell the user to run `/reload-plugins` at the end (the mod reads the option when it loads). The write goes through the file in place, so a symlinked settings file stays one:

   ```bash
   t=$(mktemp) && jq --arg p <artifact|vercel> '.pluginConfigs["slack-drafts-mobile@claudio"].options.page = $p' ~/.claude/settings.json > "$t" && cat "$t" > ~/.claude/settings.json; rm -f "$t"
   ```

   For Artifact go to **section A**. For Vercel continue with step 3, which leads into sections 2 to 7. The other page's setup stays, so switching back is `/slack-drafts-mobile <the other one>`.
3. `command -v vercel`: when it's missing, tell the user to run `pnpm i -g vercel` and stop.
4. `vercel whoami`: when it isn't logged in, ask the user to run `vercel login` in a terminal (it opens a browser), then continue. Then `vercel teams ls`, and keep the slug of the "<username>'s projects" team as `SCOPE`.
5. `kc url 2>/dev/null`: when a link already exists, run **Check** (section 6) first. When it answers 200 and no argument was given, compare the plugin's page with the deployed copy: `diff -rq -x .vercel -x .env.local -x .gitignore <this skill's base directory>/../../app/ $APP/`. When it lists a difference (a plugin update changed the page), run section 2 step 1, then section 7 (when GitHub sign-in is already set up it goes straight to its deploy); browsers stay signed in. When it lists none and section 7 step 1 finds GitHub sign-in set up, report it and stop, since there's nothing to set up; when GitHub sign-in is missing, run section 7. With `pair`, go straight to section 5; with `--rotate`, run section 2 step 1, then section 3.

## A. Artifact page

1. **The tools.** This needs the `Artifact` tool, plus `ArtifactData` and `ArtifactComments` (often deferred: load them with ToolSearch). Without them, tell the user this session has no Artifact tools, which usually means the claude.ai account it's signed into has Artifacts turned off (an organization setting), and offer the Vercel page instead; stop.
2. **Find the page.** `Artifact` with `action: "list"`, `scope: "mine"`, `limit: 200`, and look for lines titled exactly `Slack Drafts`. The mod takes the same one: the first pinned, else the most recent.
3. **The files.** Copy `<this skill's base directory>/../../artifact/index.html` and `<this skill's base directory>/../../app/public/slack-html.js` into a folder `slack-drafts-page` in the scratchpad, and read both (the Artifact tool publishes only what Claude has read).
4. **Publish.**
   - A page was found: `read` it, and its `slack-html.js` (`action: "read"`, `path: "slack-html.js"`), since a publish that touches an Artifact's file this conversation hasn't read is refused. When both match the plugin's copies (diff the saved `slack-html.js`, and the page's HTML against `index.html`), it's up to date: skip to step 5. Otherwise publish the copied `index.html` with `url` set to it, `files: {"slack-html.js": <the copied slack-html.js>}`, the `capabilities` below (so its database stays readable and writable by the owner alone) and `pin: true`. That keeps its link and its drafts.
   - None: publish it new with `title: "Slack Drafts"`, the same `files`, `capabilities: {"db": {"rules": [{"path": "drafts", "read": "owner", "write": "owner"}]}, "user": {}}`, `icon: "message"` and `pin: true`.

   After a publish, stop this session's watch on the page (`ArtifactComments`, `action: "watch"`, `on: false`, its `url`), so a resumed session doesn't report a comment monitor for it. The mod never publishes; only this step does.
5. **Check.** `ArtifactData` with `action: "query"`, `collection: "drafts"`, `query: {"limit": 1}` on the page: say whether it answered, never what the rows hold. When the listing shows more than one Slack Drafts page, name the extras and offer to delete them, one confirmation each, since the mod syncs only one.

## 2. Project and store

1. Copy the app out of the plugin cache so Vercel can link it: `mkdir -p $APP && rsync -a --delete --exclude .vercel --exclude .env.local --exclude .gitignore <this skill's base directory>/../../app/ $APP/` (the base directory is printed at the top of this skill).
2. `cd $APP && vercel link --yes --project slack-drafts-mobile --scope $SCOPE`.
3. Store: `vercel env ls production --scope $SCOPE` lists names only. When `KV_REST_API_URL` is missing, the store is added with `vercel integration add upstash/upstash-kv --plan free --scope $SCOPE`, run from `$APP`. It means accepting Upstash's Marketplace terms, which is the user's to do: hand them that exact command for their terminal (accept the terms, the free plan, connect it to `slack-drafts-mobile`), then run `vercel env ls production` again until `KV_REST_API_URL` and `KV_REST_API_TOKEN` are there.

## 3. Token

Skip on a re-run unless `--rotate` was given or `kc token` fails.

```bash
security add-generic-password -U -s claudio-slack-drafts-mobile -a token -w "$(openssl rand -hex 32)"
cd $APP && vercel env rm DRAFTS_TOKEN production --yes --scope $SCOPE 2>/dev/null
kc token | tr -d '\n' | vercel env add DRAFTS_TOKEN production --scope $SCOPE
```

An env change only reaches the page with a new deploy, so section 4 always follows.

## 4. Deploy

`cd $APP && vercel deploy --prod --yes --scope $SCOPE`, then find the production domain: the `*.vercel.app` alias in `vercel inspect <the deployment URL it printed> --scope $SCOPE` (the shortest one, usually `slack-drafts-mobile-<username>.vercel.app` or `slack-drafts-mobile.vercel.app`). Store it:

```bash
security add-generic-password -U -s claudio-slack-drafts-mobile -a url -w "https://<that domain>"
```

On a first setup, continue with section 7 (GitHub sign-in), then section 5.

## 5. Pair the phone

```bash
kc token | sed 's/^/Authorization: Bearer /' | curl -s -X POST -H @- "$(kc url)/api/drafts?action=pair-start"
```

It answers `{"code":"123456","expiresIn":300}`: a six-digit code, good once, for five minutes. The token goes in through stdin, so it never reaches a URL or the chat. Give the user the code in the chat (it's fine to show; it is not the token), so they can pair from wherever they are, a Remote Control session on the phone included. Tell them, with the link clickable: open `https://<domain>` in Safari on the phone, tap Share, Add to Home Screen, open Slack Drafts from the home screen, and type the code there. Order matters: the home-screen app keeps its own storage, so a sign-in made in Safari doesn't carry over. With GitHub sign-in set up (section 7), Sign in with GitHub does the same on any device, so the code is the fallback for one that can't reach GitHub. The `pair` argument runs this section alone.

## 6. Check

```bash
code=$(kc token | sed 's/^/Authorization: Bearer /' | curl -s -o "$TMPDIR/sdm-check" -w '%{http_code}' -H @- "$(kc url)/api/drafts")
echo "$code"; [ "$code" = 200 ] || head -c 300 "$TMPDIR/sdm-check"
```

The body is shown only when the status isn't 200, so drafts never print; read it to pick the case below.

- `200`: working. The mod picks up a new link or token within a minute, no reload needed (a new page pick does need `/reload-plugins`).
- `401`: the keychain and Vercel disagree. Run section 3 with `--rotate`, then 4. Browsers then sign in again, with GitHub or a code (section 5).
- `502` with "no Redis store": section 2 step 3.
- A Vercel sign-in page (HTML, or a `401` that isn't JSON): Deployment Protection covers the production domain. Tell the user to turn it off for production in the project's Settings, Deployment Protection, and say why: the page has its own token.

## 7. GitHub sign-in

The page lets in one GitHub account, by its numeric id (a rename can't hand it to someone else). It needs an OAuth app that the user makes, since its client secret is theirs to hold.

1. `cd $APP && vercel env ls production --scope $SCOPE`: when `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_USER_ID` are all there, skip to step 5.
2. The user creates the app at https://github.com/settings/applications/new: Application name `Slack Drafts`, Homepage URL `https://<domain>`, Authorization callback URL `https://<domain>/api/github`, Enable Device Flow off. Then Register application, and Generate a new client secret on the app's page. Ask them for the Client ID (it isn't secret); never ask for the secret.
3. Set the two public values from here. The page admits only the account whose id goes in, and `gh` may be signed in to a work account, so run `gh api user --jq .login` first and confirm with the user that it's the account they'll sign in with:

   ```bash
   cd $APP
   printf %s "<client id>" | vercel env add GITHUB_CLIENT_ID production --scope $SCOPE
   gh api user --jq .id | tr -d '\n' | vercel env add GITHUB_USER_ID production --scope $SCOPE
   ```

   Without `gh`, or for another account, ask for their GitHub username and pipe `curl -s https://api.github.com/users/<username> | jq -r .id | tr -d '\n'` in instead; show them the `.login` that comes back with it before setting it.
4. The secret goes in from the user's own terminal, so it never passes through the chat. Hand them `cd ~/.config/claudio/slack-drafts-mobile/app && vercel env add GITHUB_CLIENT_SECRET production --scope <SCOPE>` (it asks for the value), and wait until they say it's done.
5. Deploy (section 4), then `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<domain>/api/github`: a `302` to `https://github.com/login/oauth/authorize…` means it's on; a redirect to `/#signin-error=not-set-up` means a variable is missing.

From then on any browser signs in with Sign in with GitHub, and the page's Sign out removes the sign-in from a borrowed browser. On a borrowed computer the user signs out of GitHub too, or the next person there signs in with their GitHub session.

## Report

Three lines at most: the page's link (clickable), what this run changed (drafts folder made, Artifact page published or updated, deployed, re-keyed, paired, GitHub sign-in set up, or nothing), and what the user does next (restart Claude Code after a new `SLACK_DRAFTS_DIR`, `/reload-plugins` after a new pick, open the pinned Slack Drafts Artifact in the Claude app, Sign in with GitHub on the phone, or enter the code). Never the token or the client secret.
