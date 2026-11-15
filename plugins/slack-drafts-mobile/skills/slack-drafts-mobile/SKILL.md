---
name: slack-drafts-mobile
description: Set up, check, re-pair or re-key the Slack Drafts phone page, a small page on the user's own Vercel account that their /write-slack-message drafts sync to, so they can copy a draft into Slack on their phone with links and code intact and tap Sent there. Triggers on "set up slack drafts on my phone", "slack drafts mobile", "/slack-drafts-mobile", "pair my phone with slack drafts", "the phone page isn't syncing", "rotate the slack drafts token". Arguments: none (set up or check), "pair" (a new phone code), "--rotate" (a new token).
---

# Slack Drafts on the phone

Deploys this plugin's `app/` to the user's **own personal Vercel account**, connects a free Upstash Redis store, and keeps the page's link and token in the macOS keychain, where this plugin's mod reads them. Re-running it is safe: every step checks what is already there.

The mod then syncs on its own, in every Claude Code session: a draft saved to `~/Desktop/slack-drafts` is on the page within 3 s, and a Sent or delete tap on the phone moves the file within 15 s (`sent/` or the Trash), while Claude Code is open on the Mac.

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

1. `command -v vercel`: when it's missing, tell the user to run `pnpm i -g vercel` and stop.
2. `vercel whoami`: when it isn't logged in, ask the user to run `vercel login` in a terminal (it opens a browser), then continue. Then `vercel teams ls`, and keep the slug of the "<username>'s projects" team as `SCOPE`.
3. `kc url 2>/dev/null`: when a link already exists, run **Check** (section 6) first. When it answers 200 and no argument was given, compare the plugin's page with the deployed copy: `diff -rq -x .vercel -x .env.local -x .gitignore <this skill's base directory>/../../app/ $APP/`. When it lists a difference (a plugin update changed the page), run section 2 step 1, then section 4; the phone stays paired. When it lists none, report it and stop, since there's nothing to set up. With `pair`, go straight to section 5; with `--rotate`, run section 2 step 1, then section 3.

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

## 5. Pair the phone

```bash
kc token | sed 's/^/Authorization: Bearer /' | curl -s -X POST -H @- "$(kc url)/api/drafts?action=pair-start"
```

It answers `{"code":"123456","expiresIn":300}`: a six-digit code, good once, for five minutes. The token goes in through stdin, so it never reaches a URL or the chat. Give the user the code in the chat (it's fine to show; it is not the token), so they can pair from wherever they are, a Remote Control session on the phone included. Tell them, with the link clickable: open `https://<domain>` in Safari on the phone, tap Share, Add to Home Screen, open Slack Drafts from the home screen, and type the code there. Order matters: the home-screen app keeps its own storage, so a sign-in made in Safari doesn't carry over. The `pair` argument runs this section alone, for a new phone or after `--rotate`.

## 6. Check

```bash
code=$(kc token | sed 's/^/Authorization: Bearer /' | curl -s -o "$TMPDIR/sdm-check" -w '%{http_code}' -H @- "$(kc url)/api/drafts")
echo "$code"; [ "$code" = 200 ] || head -c 300 "$TMPDIR/sdm-check"
```

The body is shown only when the status isn't 200, so drafts never print; read it to pick the case below.

- `200`: working. The mod picks up a new link or token within a minute, no reload needed.
- `401`: the keychain and Vercel disagree. Run section 3 with `--rotate`, then 4 and 5.
- `502` with "no Redis store": section 2 step 3.
- A Vercel sign-in page (HTML, or a `401` that isn't JSON): Deployment Protection covers the production domain. Tell the user to turn it off for production in the project's Settings, Deployment Protection, and say why: the page has its own token.

## Report

Three lines at most: the page's link (clickable), what this run changed (deployed, re-keyed, paired, or nothing), and what the user does next (enter the code on the phone). Never the token.
