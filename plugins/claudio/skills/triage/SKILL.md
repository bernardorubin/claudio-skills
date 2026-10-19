---
name: triage
description: Run slack-triage, inbox-triage and figma-triage together and report one merged, numbered list of what needs the user across Slack, email and Figma (a reply drafted, a Jira ticket to file, or work to do). Suggests only. Use when the user says "triage everything", "check slack, email and figma", "what needs me?", "anything I need to deal with?", or runs /triage, including on a timer via "/loop 1h triage". The bare prompt "triage" (what a loop sends) runs it too.
---

# Triage

One check across all three sources, one list back. This skill holds no logic of its own:
each source keeps its own rules, state file and window.

## Steps

1. Run `slack-triage`, `inbox-triage` and `figma-triage` in turn, with any arguments the
   user gave (a window, `--dry`), following each skill through its Jira checks and drafts
   but holding its report. A source that fails (connector signed out, token missing) gets
   one line saying what's blocked and what fixes it; the others still run.
2. Merge the reports into one list, most urgent first across all sources, numbered in one
   sequence and tagged with the source:

   ```
   1. Email · Stripe: test payments failing for a missing return URL. Ticket: new. (link)
   2. Slack · Sam in #eng: plan dropdown jumps on scroll. Ticket: new. (link)
   3. Figma · Priya on Checkout, payment: reuse the order summary component. Ticket: fold into ACME-812. (link)
   4. Slack · Lee (DM): PR 412 is ready for review. Needs work: review-cycle. (link)
   Skipped: Slack 6, email 14, Figma 1.
   ```

3. Let each source write its own state file as it normally would.

When nothing is new anywhere, print one line (`Triage: nothing new on Slack, email or
Figma.`) and stop.

## On a timer

`/loop 1h triage` checks all three every hour in the current conversation. Each source
still looks back to its own last check, so this mixes freely with a faster loop for one
source (`/loop 20m slack-triage`) without repeating anything.

## Acting on the answer

"file 2, send 4" goes to the source each number came from, following that skill's
"Acting on the answer" steps in this conversation.
