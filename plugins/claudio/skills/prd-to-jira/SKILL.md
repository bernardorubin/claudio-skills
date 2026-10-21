---
name: prd-to-jira
description: Use when breaking down a PRD, spec, or feature document into Jira tickets. Triggers when user shares a PRD (pasted, Google Doc URL, Jira ticket, file), asks to "create tickets", "break this down", "make Jira tasks", or wants to plan work from a requirements document. Also use when user says "turn this into tickets" or "create an epic for this".
---

# PRD to Jira Tickets

Break down a Product Requirements Document into a Jira epic with well-structured, right-sized tickets organized by work area.

## Workflow

```dot
digraph prd_to_jira {
    rankdir=TB;
    node [shape=box];

    ingest [label="1. Ingest the PRD"];
    ask_project [label="2. Ask: which Jira project?"];
    analyze [label="3. Analyze & decompose"];
    present [label="4. Present ticket plan to user"];
    user_ok [label="User approves?" shape=diamond];
    create_epic [label="5. Create Epic"];
    create_tickets [label="6. Create Tasks under Epic"];
    link_deps [label="7. Link dependencies"];
    summary [label="8. Present summary with links"];

    ingest -> ask_project -> analyze -> present -> user_ok;
    user_ok -> create_epic [label="yes"];
    user_ok -> analyze [label="revise"];
    create_epic -> create_tickets -> link_deps -> summary;
}
```

## Step 1: Ingest the PRD

The PRD can come from multiple sources. Identify which one and read it fully before proceeding.

| Source | How to read |
|--------|-------------|
| Pasted text | Already in conversation — use directly |
| Local file (`.md`, `.pdf`, `.txt`) | Read tool |
| Google Doc URL | Open with Chrome MCP (`mcp__claude-in-chrome__navigate`, then `mcp__claude-in-chrome__get_page_text`) |
| Jira ticket | `jira-curl <project> GET "/rest/api/3/issue/<KEY>?fields=description,summary"` |
| Confluence / other URL | Chrome MCP to read page content |

If the PRD is long, read it completely before starting analysis. Missing context leads to bad tickets.

## Step 2: Ask Which Jira Project

Always ask the user which project to use before creating anything. List the configured instances with `jira-curl list` (never read `~/.config/jira/credentials` directly — it holds live API tokens; see jira-cli's Sensitive Data rule).

## Step 3: Analyze & Decompose

Read the PRD and break it down by asking yourself:

### Identify work areas
Tag each piece of work with an area. Common ones:
- `[Frontend]` — UI, components, pages, client-side logic
- `[Backend]` — API endpoints, business logic, database
- `[Ops]` — Infrastructure, deployment, CI/CD, monitoring
- `[Marketing]` — Landing pages, copy, campaigns
- `[Design]` — Mockups, design system changes
- `[QA]` — Test plans, automation, manual test scripts
- `[Data]` — Analytics, reporting, data pipelines

Use whatever areas make sense for the PRD. The point is that tickets map to the person or team who will do the work.

### Right-size the tickets
Each ticket should be a **deliverable, QA-able unit of work**. Think of it as: "someone could pick this up, do it, and someone else could verify it's done."

**Too small:** "Add a CSS class to the button" — this isn't independently deliverable. Group it with the feature that needs the button.

**Too big:** "Build the entire insurance verification flow" — this has multiple independently testable pieces (form UI, API integration, eligibility logic, error states). Break it up.

**Right-sized:** "Build the insurance form with state/payor/member ID fields and validation" — one person can do it, another can QA it, and it has clear completion criteria.

When in doubt, ask: "Could someone write meaningful acceptance criteria and QA steps for this?" If yes, it's a ticket. If the ACs would be trivial ("it exists") or sprawling ("the whole feature works"), resize.

### Flag dependencies
As you decompose, note which tickets block others. Common patterns:
- Backend API must exist before frontend can integrate
- Database schema changes before backend logic
- Design must be finalized before frontend build
- Ops/infra setup before deployment

### Identify open questions
If the PRD has gaps, ambiguities, or decisions that need input, collect them. These become the optional Questions section on relevant tickets — only add questions to tickets where the gap actually affects that ticket's work.

## Step 4: Present the Plan

Before creating anything in Jira, present the full breakdown to the user in a clear format:

```
## Epic: [Epic title]

### Tickets:

1. **[Frontend] Build insurance form UI**
   - ACs: form fields for state, payor, member ID; validation; error states
   - Dependencies: none
   - Questions: Should we support auto-complete for payor names?

2. **[Backend] Create eligibility check endpoint**
   - ACs: POST /api/eligibility accepts member info, returns coverage status
   - Dependencies: none

3. **[Frontend] Integrate eligibility check with form**
   - ACs: form submits to API, handles success/failure/loading states
   - Dependencies: blocked by #2
   - Questions: What should the loading state look like?

4. **[Ops] Set up monitoring for eligibility API**
   - ACs: alerts for error rate > 5%, latency dashboard
   - Dependencies: blocked by #2
```

Wait for the user to review and approve before creating tickets. They may want to merge, split, reword, or reprioritize.

## Step 5-7: Create Tickets in Jira

Once approved, create everything using `jira-curl` — **under the jira-cli skill's rules**. This skill decides *what* tickets to create; the jira-cli skill owns *how* to talk to Jira. Before any API call, run jira-cli's preflight (ensure the binary is on PATH, resolve the right instance for this request). And every ADF payload you write here — descriptions, summaries, comments — is governed by jira-cli's Output Style rules: **no em/en dashes anywhere** (run its mandatory pre-POST payload check on every payload), and **every ticket-key mention rendered as an `inlineCard`**, never plain text. Read those sections of jira-cli's SKILL.md; don't improvise them from memory.

**Never hardcode Jira IDs** — issue type IDs, link type IDs, and Epic Link customfield IDs all vary per Atlassian site (same rule as jira-cli's "never hardcode transition IDs"). Use **names**, which Jira resolves per-project, and the modern `parent` field for epic membership.

### Create the Epic

```bash
~/.local/bin/jira-curl <project> POST "/rest/api/3/issue" -d '{
  "fields": {
    "project": {"key": "<PROJECT_KEY>"},
    "summary": "<Epic title>",
    "issuetype": {"name": "Epic"},
    "description": <ADF description>
  }
}'
```

### Create Tasks under the Epic

Use issue type Task by name. Parent each task to the epic with the `parent` field — it works on both company-managed and team-managed Jira Cloud projects (the legacy Epic Link customfield does not).

Add the fields the project's conventions call for: component, priority, and a sprint only when the board runs sprints (jira-cli's "Create a ticket"). When the board is ordered by priority, give each ticket a priority in the plan you present in step 4, so the user approves it with the rest.

```bash
~/.local/bin/jira-curl <project> POST "/rest/api/3/issue" -d '{
  "fields": {
    "project": {"key": "<PROJECT_KEY>"},
    "summary": "[Area] Task title",
    "issuetype": {"name": "Task"},
    "parent": {"key": "<EPIC_KEY>"},
    "description": <ADF description>
  }
}'
```

**If a name is rejected** (translated site language, custom type scheme, no "Task" type): list the project's real issue types with `GET /rest/api/3/issue/createmeta/<PROJECT_KEY>/issuetypes` and use what's there (e.g. "Story"). **If `parent` is rejected** (rare — old Jira Server): find the Epic Link field with `GET /rest/api/3/field` (search for "Epic Link") and use that customfield ID instead.

### Ticket Description Format (ADF)

Jira uses Atlassian Document Format. Structure each ticket description as:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "heading", "attrs": {"level": 2},
      "content": [{"type": "text", "text": "Description"}]
    },
    {
      "type": "paragraph",
      "content": [{"type": "text", "text": "What this ticket is about and why it matters. Include enough context that someone unfamiliar with the PRD can understand the work."}]
    },
    {
      "type": "heading", "attrs": {"level": 2},
      "content": [{"type": "text", "text": "Acceptance Criteria"}]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Specific, testable criterion"}]}]
        }
      ]
    },
    {
      "type": "heading", "attrs": {"level": 2},
      "content": [{"type": "text", "text": "QA Instructions"}]
    },
    {
      "type": "orderedList",
      "content": [
        {
          "type": "listItem",
          "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Step-by-step instruction for verifying this ticket"}]}]
        }
      ]
    }
  ]
}
```

**Optional Questions section** — only include when the PRD has genuine gaps affecting this ticket:

```json
{
  "type": "heading", "attrs": {"level": 2},
  "content": [{"type": "text", "text": "Open Questions"}]
},
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Specific question that needs answering before or during this work"}]}]
    }
  ]
}
```

### Writing Good Ticket Content

**Description:** Give enough context that someone who hasn't read the PRD can understand what to do and why. Reference the broader feature but focus on this ticket's scope.

**Acceptance Criteria:** Specific and testable. Each AC should be verifiable with a yes/no answer.
- Good: "Form validates that member ID is 9-12 alphanumeric characters"
- Bad: "Form works correctly"

**QA Instructions:** Step-by-step instructions for verifying the ticket is done. Include:
- Prerequisites (test accounts, environment setup)
- Exact steps to reproduce/test
- Expected results at each step
- Edge cases to check

**Questions:** Only when there are genuine gaps. Don't manufacture questions — if the PRD is clear on a ticket's scope, skip this section entirely.

### Link Dependencies

After all tickets are created, link dependent tickets using the "Blocks" link type by name:

```bash
~/.local/bin/jira-curl <project> POST "/rest/api/3/issueLink" -d '{
  "type": {"name": "Blocks"},
  "outwardIssue": {"key": "<BLOCKER_KEY>"},
  "inwardIssue": {"key": "<BLOCKED_KEY>"}
}'
```

If the site's link scheme rejects the name, list the available types with `GET /rest/api/3/issueLinkType` and pick the blocks-style one.

This creates "BLOCKER_KEY blocks BLOCKED_KEY" / "BLOCKED_KEY is blocked by BLOCKER_KEY".

## Step 8: Present Summary

After creating everything, present a clean summary:

```
## Created: [Epic Title] (ACME-XXX)

| # | Ticket | Area | Blocked By |
|---|--------|------|------------|
| 1 | ACME-101 [Frontend] Build insurance form | Frontend | — |
| 2 | ACME-102 [Backend] Eligibility endpoint | Backend | — |
| 3 | ACME-103 [Frontend] Integrate eligibility | Frontend | ACME-102 |
| 4 | ACME-104 [Ops] Monitoring setup | Ops | ACME-102 |

Tickets with open questions: ACME-101, ACME-103
```

## Common Mistakes

- **Creating tickets before user approval** — Always present the plan first. Deleting/editing Jira tickets after creation is annoying.
- **Tickets too granular** — "Add field X to form" is not a ticket. The form with all its fields is a ticket.
- **Missing context in descriptions** — Don't assume the reader has the PRD. Each ticket should stand on its own.
- **Vague ACs** — "It works" is not an AC. Be specific about what "works" means.
- **Questions everywhere** — Only add questions when there are genuine PRD gaps for that specific ticket. Most tickets shouldn't need a questions section.
- **Forgetting to link dependencies** — This is the whole point of flagging them. Create the links in Jira, don't just mention them in descriptions.
- **Skipping jira-cli's writing rules** — Em/en dashes in ADF text or plain-text ticket keys are hard violations. Run jira-cli's pre-POST payload check on every ticket you create; render ticket references as `inlineCard` nodes.
