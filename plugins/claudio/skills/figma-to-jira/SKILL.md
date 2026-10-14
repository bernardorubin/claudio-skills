---
name: figma-to-jira
description: Turn the Figma comments that need the user (mentions, and replies in threads they're in) into Jira tickets. Scans every file in the watched Figma projects, finds where each comment is pinned, screenshots that spot, groups related comments into one ticket, skips anything already ticketed, and files the rest with the screenshot and a deep link back to the comment. Use when the user says "I got Figma notifications, please check", "check my Figma comments", "turn the Figma comments into tickets", "any new Figma comments for me?", or runs /figma-to-jira with a window (e.g. "/figma-to-jira 2d").
---

# Figma to Jira

Notifications in, tickets out. The user should never have to say which file or frame:
the script finds every thread that needs them across the watched projects, and this
skill turns each piece of work into one Jira ticket with a screenshot and a link.

Conductor, not the orchestra: Jira reads and writes follow `jira-cli`, screenshots come
from the Figma MCP (`get_screenshot`, `get_metadata`), and building the change is
`shipit`'s job, not this one.

## Arguments

- **Window** (`2d`, `48h`, or a date like `2026-10-10`). Default: since the last run
  that filed tickets, else the last 3 days.
- `--all`: every new comment in the window, not only mentions and replies.
- `--dry`: report the grouping and the dedupe verdicts, file nothing, and don't move
  the default window forward.

## Step 1: Scan

```bash
python3 <skill-dir>/scripts/figma_comments.py [--since 2d] [--all] > <scratch>/figma-threads.json
```

It reads `~/.config/claudio/figma.json` (`{"projects": [], "teams": [], "files": []}`),
lists every file in those projects (teams expand to all their projects), and prints one
entry per open thread with a new comment from someone else that mentions the user or
replies in a thread they're part of. Each entry has the file, the thread, `node_id`,
`node_box`, `pin_offset` (the pin's position inside the node), the containing
top-level `frames`, a deep `url` (opens the frame with that comment), and every comment
in the thread with `new` marking the ones in the window.

The token comes from `$FIGMA_TOKEN`, an `export FIGMA_TOKEN=` line in a shell profile,
or `~/.config/claudio/figma-token`. The script never prints it; never print it yourself.

**Errors are access blocks, so stop and ask.** The script exits 2 with a JSON reason:

- **No config**: ask the user for any link inside the Figma project (a file URL is
  enough). A project URL carries the id (`.../files/<org>/project/<id>/...`). For a file
  URL, open it in the logged-in browser and read `folder_id` (the project) and `team_id`
  from `fetch('/api/files/<key>').then(r => r.json())`. Write the ids to the config.
- **Missing scope**: the message names it. Listing a project's files needs
  `projects:read`; comments need `file_comments:read`; frames need `file_content:read`.
  Ask the user to create a token with those scopes. Until then, `--file <key>` scans
  named files without listing the project.

Report the counts first: files scanned, threads found, the window.

## Step 2: Read each thread and decide what it is

Read the whole thread, not just the new comment. Sort each one:

- **Change request**: something should change in the build (copy, layout, behaviour,
  an asset). This becomes ticket work.
- **"I updated the design"**: a designer or PM changed Figma and is telling the user.
  That is a change request too: the build has to follow. Compare against the
  frame (and the code or staging if it's quick) to say exactly what changed.
- **Question**: they need an answer, not a ticket. List it for the user to reply to in
  Figma, with the link.
- **Nothing to do**: thanks, emoji, resolved by a later reply. Skip and say so.

## Step 3: Group

One ticket per piece of work, not per comment:

- Same frame and same topic (four comments on one checkout screen about the promo
  banner and its pricing copy) → one ticket.
- The same change asked on desktop and mobile frames → one ticket.
- Different screens, different concerns → separate tickets, even from one person.

## Step 4: Skip what's already ticketed

For each group, search Jira for the thread ids (every ticket this skill files carries
them) and for the request's distinctive words, the last ~60 days:

```bash
jira-curl <instance> GET "/rest/api/3/search/jql?jql=<urlencoded: project=KEY AND (text ~ \"1964482925\" OR text ~ \"promo banner\") AND created >= -60d>&fields=summary,status&maxResults=6"
```

Read any plausible match. Covered and still open → comment the new Figma thread on it
(link, quote, screenshot) instead of filing. Done and the comment asks for more →
file new and link the old one. Try at least three phrasings before calling it new.

## Step 5: Screenshot the spot

For each thread, with the Figma MCP (`get_screenshot`, `fileKey` and node id):

- **Node at most about 2000px tall**: screenshot the node itself.
- **Taller (a whole-page frame) or a tiny layer**: screenshot the top-level frame at
  full resolution, then crop about 1440×900 design pixels centred on the pin. The pin
  sits at `node_box` minus the frame's box, plus `pin_offset`. Scale by the rendered
  width over the frame's design width, then `sips -c <h> <w> --cropOffset <y> <x>`.
- Save to `~/Desktop/<TICKET-OR-SLUG>-figma/` with names that say what they show.

Look at each image before attaching it. A crop that misses the pinned element is wrong.

## Step 6: File

Fields follow the project's conventions: read the repo `CLAUDE.md`, memory and vault for
the Jira instance, project key, component, sprint and epic, and copy them off the newest
ticket of the same kind. The right epic is usually the one the Figma frame's feature
belongs to. Never guess an assignee: use the owner the conventions name, otherwise ask
once for the whole batch.

Write the body as markdown and convert it with `scripts/md2adf.py <file>`:

1. What to change, in one or two plain sentences, and who asked (name, date).
2. `## Figma`: each comment quoted verbatim with its author, plus the deep link for
   each thread (`url` from the script). The thread ids live in these links, which is
   what Step 4 finds next time.
3. The screenshot embedded inline (upload with `jira-curl <instance> POST
   /rest/api/3/issue/<KEY>/attachments -H "X-Atlassian-Token: no-check" -F
   "file=@<png>"`, read the media UUID from the `Location` of `GET
   /rest/api/3/attachment/content/<id>`, embed it as a `mediaSingle` node, then confirm it
   rendered with `?expand=renderedBody`).
4. `## Acceptance Criteria`: the build matches the linked frame for each item.

Title: `[FE]`/`[BE]`/`[Content]` plus the change in plain words. Add the label
`figma-comment`. No local paths anywhere in the ticket. After filing, GET each ticket and
check the parent, component, sprint, label and image landed.

When filing worked (not `--dry`), re-run the scan with `--save-run` and the same window,
so the next default window starts from this run.

## Step 7: Report

- New tickets: a link and one line each, with how many comments each one groups.
- Existing tickets that got a comment: a link and what was added.
- Questions to answer in Figma: the person, the question, the link.
- Skipped: one line with the reasons.

## Boundaries

- Read-only on Figma. Never reply to or resolve a comment; the token is read-only, and
  a reply in the user's name is theirs to send.
- Never file a question as a ticket, and never state what the designer meant beyond
  what the comment and the frame show.
- `--dry` writes nothing: no tickets, no comments, no saved run.
