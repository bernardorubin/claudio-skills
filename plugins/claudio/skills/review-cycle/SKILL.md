---
name: review-cycle
description: >-
  Use when a PR should be reviewed AND fixed: review, post one living PR comment, fix
  the findings worth fixing, run the gates, push, update the comment, repeat until
  clean. Triggers on "run the review cycle", "review and fix this PR", "do the review
  loop", "review cycle on PR 512", "review my PR and fix the issues", "address
  Copilot's comments", "deal with the CodeRabbit review". Folds in any AI reviewer
  already on the PR. Also shipit's self-review step. For a review with no fixes, use
  pr-review.
---

# Review Cycle

Run the iterative **review-and-fix** loop on a PR, leaving a single living review
comment that tracks the review through to resolution. This is a conductor over
`/pr-review`: **`/pr-review` is the reviewing engine** (it does the analysis and
owns the `--comment` living-comment machinery); `review-cycle` adds the loop on top
— fix the findings worth fixing, run the gates, push, update the comment, repeat.
Don't reimplement reviewing here; invoke `/pr-review`.

Invoked directly, the user has already opted into the cycle by running it — so just
run it (the "should we even review this?" gate lives in `/shipit`, which asks
before calling this skill).

## Arguments

Optional PR number/URL. If omitted, auto-detect the current branch's PR.

## Before you start

- **There must be a PR to comment on.** Auto-detect it (`gh pr view --json number,url`)
  or take the number/URL given. If no PR exists, say so and offer to open one (or hand
  back to the user) — this is a *PR* cycle; the living comment needs a PR to live on.
- **Read the repo's `CLAUDE.md`** for the pieces this loop needs: the quality gates /
  test command, the commit + push convention, and any **designated reviewer** the repo
  names in place of the default `/pr-review`. Honor it.

## The loop

### 1. Review + post
Run `/pr-review --comment` (or the repo's designated reviewer with its comment mode).
It reviews the diff and posts the findings as **one** PR comment — created the first
pass, edited in place on later passes (marker-tracked; never a second comment).

### 2. Pull in the other AI reviewers
Some repos have review bots of their own on every PR (GitHub Copilot, CodeRabbit, and
others), some have none. Read `references/bot-reviews.md` and follow it: it finds any
bot reviewer by account type rather than by name, keeps only comments that are code
review, and verifies each claim against HEAD. The survivors join `/pr-review`'s
findings in step 3, credited to the bot. Hand them to `/pr-review` with its args on
the next pass, so the living comment lists them alongside its own. No bot reviews on
the PR is the normal case for many repos: skip this step and say so in one line.

### 3. Triage + fix the ones worth fixing
Use judgment — **don't blind-fix everything**, and hold a bot's findings to the same
bar as `/pr-review`'s:
- **Fix**: critical issues and solid, high-confidence improvements. Make the actual
  code changes.
- **Leave (with a reason)**: nitpicks, likely false positives, out-of-scope changes,
  or findings you genuinely disagree with. Record why — you'll report these, and it's
  fine for the living comment to end with a few deliberately-unfixed items noted as
  such.

If a fix would materially change the approach or scope, **stop and ask** rather than
plowing ahead — the user would rather be asked than surprised.

### 4. Run gates + push
Run the project's quality gates (lint / typecheck / tests — from the repo's CLAUDE.md)
on what you touched; fix what your changes broke. Then commit (prefer `git-ac` when
`git status` shows only this loop's files, else surgical `git add` + commit; imperative
message, no AI attribution) and **push to the PR branch**. Never push to a base branch
(`main`/`staging`/`develop`). Never commit DB schema changes.

### 5. Answer the bots, then update the comment
If step 2 found bot comments, reply on each thread and resolve the ones that are
settled, as `references/bot-reviews.md` section 4 lays out.

Re-run `/pr-review --comment`. Incremental mode strikes through what you fixed, surfaces
anything the fixes introduced, and **edits the same PR comment in place** — so the one
comment always reflects current state.

### 6. Repeat until clean
Loop 2→5 until no fixable findings remain. Bots often review again after a push, so step
2 runs on every pass. Stop when the only items left are the ones you
deliberately chose not to fix (from step 3) — don't churn trying to zero-out nitpicks or
chase a finding you've judged not worth it.

## Report

When the loop settles, tell the user briefly:
- What was **fixed** (and the follow-up commits/pushes).
- What was **deliberately left** and why (nitpick / false positive / out of scope).
- **Other AI reviewers**, when the PR had any: which bots, how many of their comments
  were real, fixed, wrong or left, and which threads stay open. One line when there
  were none.
- The **final review comment** state + link.

Keep it tight — the living PR comment is the detailed record; your report is the summary.

## Boundaries

- This skill **fixes and pushes**, but never deploys/publishes (no `eas submit`, OTA,
  store release, or production promotion) — that's not part of a review cycle.
- It defers to `/pr-review` for *how* to review and to the repo's CLAUDE.md for *what*
  the gates and conventions are. It only owns the fix/push/iterate orchestration.
