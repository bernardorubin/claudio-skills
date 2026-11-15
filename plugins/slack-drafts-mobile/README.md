# slack-drafts-mobile

Your `/write-slack-message` drafts on your phone. Every draft saved to `~/Desktop/slack-drafts` (or `SLACK_DRAFTS_DIR`) shows on a small page on **your own** Vercel account. Copy for Slack keeps links and code formatting, the page links the conversation to post in, and Sent and delete there move the file on your Mac (into `sent/` or the Trash).

It syncs over plain HTTPS from a mod, so it works in every Claude Code session, Remote Control included, with no Claude tools involved. claudio's `/slack-drafts` pane keeps working beside it: both watch the same folder.

## Set up

```
/plugin install slack-drafts-mobile@claudio
/slack-drafts-mobile
```

The skill needs the Vercel CLI (`pnpm i -g vercel`) and a Vercel login. On your personal account it:

1. Creates a project and a free Upstash Redis store. Adding the store asks you to accept Upstash's Marketplace terms once.
2. Makes a token, keeps it in the macOS keychain, and sets it on the project.
3. Deploys the page.
4. Opens a pairing page on the Mac with a six-digit code. Open the page on your phone, type the code, and add it to your home screen.

Run it again to check the setup, `/slack-drafts-mobile pair` for another phone, and `/slack-drafts-mobile --rotate` for a new token (phones then pair again).

## How it syncs

- A saved draft reaches the page within 3 s.
- The page refreshes every 15 s and whenever you return to it.
- A Sent or delete tap moves the file within 5 s while Claude Code is open on the Mac. With no session open, the tap waits on the page and the file moves when a session starts.
- The mod only reads the page while a draft it pushed is still there, so an empty page costs no requests.

The page never reaches the Mac: a tap only marks the draft, and the mod moves the file. The token lives in the keychain (service `claudio-slack-drafts-mobile`), never in a plain file. macOS only.

## Developing

- Mod: `hooks/register.tsx`. Check it with `claude plugin validate .` and `claude plugin test .` from this folder.
- Page backend: `app/api/drafts.ts`. Test it with `node --test app/check-drafts.ts`.
- Page: `app/public/index.html`. Its `slack-html.js` is the same bundle as claudio's `slack-drafts-phone/slack-html.js` (built from `plugins/claudio/hooks/slack-html.ts`).
