---
name: super-triage
description: Run slack-triage, inbox-triage, figma-triage and vercel-triage together and report one merged, numbered list of what needs the user across Slack, email, Figma and the Vercel logs (a reply drafted, a Jira ticket to file, or work to do). Suggests only. Use when the user says "triage everything", "check slack, email, figma and vercel", "what needs me?", "anything I need to deal with?", or runs /super-triage, including on a timer via "/loop 1h super-triage". The bare prompt "super-triage" (what a loop sends) runs it too.
---

# Super Triage

One check across all four sources, one list back. This skill holds no logic of its own:
each source keeps its own rules, state file and window.

## Steps

1. Run `slack-triage`, `inbox-triage`, `figma-triage` and `vercel-triage` in turn, with any arguments the
   user gave (a window, `--dry`), following each skill through its Jira checks and drafts
   but holding its report. A source that fails (connector signed out, token missing) gets
   one line saying what's blocked and what fixes it; the others still run.
2. Merge the reports into one list, most urgent first across all sources, numbered in one
   sequence and tagged with the source:

   ```
   1. Email · Stripe: test payments failing for a missing return URL. Ticket: new. (link)
   2. Slack · Sam in #eng: plan dropdown jumps on scroll. Ticket: new. (link)
   3. Figma · Priya on Checkout, payment: reuse the order summary component. Ticket: fold into ACME-812. (link)
   4. Vercel · prod: 12 checkout 500s in the hour to 14:20 on /api/orders. Ticket: new. (logs link)
   5. Slack · Lee (DM): PR 412 is ready for review. Needs work: review-cycle. (link)
   Skipped: Slack 6, email 14, Figma 1, Vercel 3.
   ```

3. Let each source write its own state file as it normally would.

When nothing is new anywhere, print one line (`Super triage: nothing new on Slack, email,
Figma or Vercel.`) and stop.

## On a timer

`/loop 1h super-triage` checks all four every hour in the current conversation. Each source
still looks back to its own last check, so this mixes freely with a faster loop for one
source (`/loop 20m slack-triage`) without repeating anything.

## Acting on the answer

"file 2, send 4" goes to the source each number came from, following that skill's
"Acting on the answer" steps in this conversation.
