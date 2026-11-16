# slack-drafts-mobile

Your `/write-slack-message` drafts on your phone. Every draft saved to `~/Desktop/slack-drafts` (or `SLACK_DRAFTS_DIR`) shows on a phone page. Copy for Slack keeps links and code formatting, the page links the conversation to post in, and Sent and delete there move the file on your Mac (into `sent/` or the Trash).

You pick the page when you set it up:

- **Artifact (the default):** a pinned "Slack Drafts" Artifact on your claude.ai account, opened in the Claude app on any device. Nothing to deploy and no keys. Every session finds the page by its name, so no link is stored. It needs Artifacts on for your account (an organization can turn them off), and drafts sync while a session that has the Artifact tools is open.
- **Vercel (the backup):** a small page on **your own** Vercel account with Sign in with GitHub. A mod syncs it over plain HTTPS, so it works in every Claude Code session and on any account, Artifacts or not.

claudio's `/slack-drafts` pane keeps working beside either: both watch the same folder.

## Set up

```
/plugin install slack-drafts-mobile@claudio
/slack-drafts-mobile
```

The skill first asks where your drafts should live (`~/Desktop/slack-drafts` unless you pick another folder) and makes the folder: `/write-slack-message` saves drafts there only when it exists. Then it asks which page you want.

**Artifact:** the skill publishes the page (or updates the pinned Slack Drafts page you already have, keeping its link), pins it, and records the pick. Run `/reload-plugins`, then open Slack Drafts from your pinned Artifacts in the Claude app.

**Vercel:** it needs the Vercel CLI (`pnpm i -g vercel`) and a Vercel login. On your personal account it:

1. Creates a project and a free Upstash Redis store. Adding the store asks you to accept Upstash's Marketplace terms once.
2. Makes a token, keeps it in the macOS keychain, and sets it on the project.
3. Deploys the page.
4. Sets up Sign in with GitHub: you make a GitHub OAuth app (a name, the page's link and the callback link the skill gives you) and paste its client secret into Vercel from your terminal, so it never goes through the chat. Only your GitHub account gets in, checked by its numeric id.
5. On the phone, open the page in Safari, tap Share, Add to Home Screen, open it from the home screen, and tap Sign in with GitHub (the home-screen app keeps its own sign-in, apart from Safari's). Any other browser signs in the same way, and Sign out takes a borrowed one back out (sign out of GitHub there too). A six-digit code from `/slack-drafts-mobile pair` is the fallback.

Run it again to check the setup (after a plugin update that changed the Vercel page, this also redeploys it; browsers stay signed in), `/slack-drafts-mobile artifact` or `/slack-drafts-mobile vercel` to switch pages, `/slack-drafts-mobile pair` for a code, and `/slack-drafts-mobile --rotate` for a new token (every browser then signs in again).

Upgrading from 0.2 with the Vercel page: it keeps syncing there until you pick a page. Run `/slack-drafts-mobile artifact` to move to the Artifact page.

## How it syncs

- A saved draft reaches the page within 3 s.
- The Artifact page updates live; the Vercel page refreshes every 15 s and whenever you return to it.
- A Sent or delete tap moves the file within 30 s on the Artifact page, 15 s on the Vercel page, while Claude Code is open on the Mac. With no session open, the tap waits on the page and the file moves when a session starts.
- The mod only reads the page while a draft it pushed is still there, so an empty page costs no requests.

Neither page reaches the Mac: a tap only marks the draft, and the mod moves the file. The Artifact page keeps drafts in its own database, which only you can read; the mod writes there with the Artifact tools, as you. On the Vercel page, the token lives in the keychain (service `claudio-slack-drafts-mobile`), never in a plain file. A GitHub sign-in hands the browser a one-time, 60-second handoff that it trades for the token; the token itself never goes in a URL. macOS only.

## Developing

- Mod: `hooks/register.tsx`. Check it with `claude plugin validate .` and `claude plugin test .` from this folder.
- Page backend: `app/api/drafts.ts`. Test it with `node --test app/check-drafts.ts` (Node 22.18+; 22.6 to 22.17 need `--experimental-strip-types`).
- Artifact page: `artifact/index.html`, published with `app/public/slack-html.js` beside it.
- Vercel page: `app/public/index.html`. Its `slack-html.js` is built from `plugins/claudio/hooks/slack-html.ts`, the converter claudio's pane uses (command in the claudio README's Developing the mods).
