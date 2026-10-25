---
name: wrap-session
description: Use at end of session when the user wants to do BOTH the worklog write AND the vault sweep in one command — the combined end-of-session wrap-up, which then moves the Desktop files the session is done with to the Trash. Triggers on phrases like "wrap up the session", "wrap session", "save session everywhere", "save to worklog and vault", "worklog and vault", "save both", "do both", "log and save the session", "end-of-session save". For only the worklog use [[save-session-to-worklog]]; for only the wiki use [[save-to-vault]].
---

# Wrap Session

One command for the two things done at every session end: log **what you did**
(worklog, for standups/invoicing) and file **what you learned** (knowledge vault).
This skill is a conductor — it does not reimplement either; it invokes them in order.

## Steps

1. **Worklog** — invoke the [[save-session-to-worklog]] skill, forwarding `$ARGUMENTS`
   to it verbatim (that's the skill that takes freetext notes, `--project`, `--dry`).
2. **Vault** — invoke the [[save-to-vault]] skill. It takes no arguments.
3. **Desktop cleanup** — move to the Trash the `~/Desktop` files and folders this
   session created whose job is done, so the Desktop doesn't grow forever. Go by the
   conversation, not by file dates: a path qualifies only if a tool call in this
   session wrote it, and its content has reached where it was going or is no longer
   needed (screenshots or evidence uploaded to the Jira ticket or PR, a
   `pr-description.md` that's now on the PR, a review file whose review is posted,
   a QA recording attached, a session-status or standup file already read).
   - **Keep**: anything the session didn't write (the user's own files and
     screenshots), anything still in use (evidence for a ticket still in QA, a
     `handoff-*.md`, which exists for the next session), worklogs,
     `weekly-summaries/`, and `slack-drafts/` (its pane and phone page own its
     lifecycle). When unsure, keep it.
   - Trash with `trash <paths>` (`/usr/bin/trash`, macOS 15+), else
     `mv <path> ~/.Trash/`. Never `rm`: the Trash keeps a wrong call recoverable.
4. **Report** — one combined summary: the worklog file + item count, the vault
   pages filed (or "nothing new to file"), then what went to the Trash (or "Desktop
   already clean"). Don't repeat each sub-skill's full output.

## Notes

- **Order matters**: worklog first (chronology of the session), vault second (the
  distilled knowledge). Run step 2 even if step 1 logged nothing — a session can be
  learning-heavy but commit-light, or vice versa.
- **`--dry`**: if `$ARGUMENTS` contains `--dry`, run the worklog step in its dry-run
  preview, **skip the vault write** and list what the cleanup would trash without
  moving it (dry means write nothing anywhere), then stop.
- **No vault registered**: [[save-to-vault]] offers to run `/vault-init` on the spot.
  The worklog step already ran (it falls back to `~/Desktop/`), so a skip loses nothing
  but the wiki sweep. Just relay it.
- ponytail: both sub-skills each git-sync the vault, so a vault project gets two
  commits (worklog, then wiki). Left as-is — separate commits read cleanly; dedupe the
  sync only if it ever becomes a problem.
