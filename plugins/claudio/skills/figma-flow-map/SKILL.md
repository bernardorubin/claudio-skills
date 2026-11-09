---
name: figma-flow-map
description: Use when the user wants a built flow compared with its Figma design screen by screen - whether every Figma screen, variant and swimlane exists in the app 1:1, which screens were cut, added or never built, or a visual map of the built screens beside their Figma frames. Triggers on "compare Figma vs what we built", "do our screens match Figma 1 to 1", "draw a diagram of the screens and variants", "Figma flow vs real flow", "did we build every screen in Figma", "make a screen map".
---

# Figma Flow Map

One page that puts every built screen beside the Figma frame it should match, laid out
the way the flow runs (sections in order, swimlanes as rows), plus a coverage check that
proves no Figma frame was skipped. It answers "do our screens match Figma 1:1?" with
evidence the user can click through, not a claim.

The mechanical parts run through `scripts/flowmap.py` (python3, stdlib only; `sips` or
`ffmpeg` shrinks thumbnails). Call it relative to this skill's directory:
`python3 -I scripts/flowmap.py frames|thumbs|check|render ...`.

## The rules that make it worth trusting

1. **Figma is the reference, the app is what gets checked.** A Figma screen with no built
   screen is a finding (`missing: true`, shown as "not built"). Never leave it off the map,
   and never `ignore` it. `ignore` is only for frames that are not screens: notes,
   annotations, a duplicate. An old exploration counts only if the user confirms it is dead.
2. **Map from the flow's source of truth, not from Figma's names.** Read where the built
   flow is defined (route config, step or flow definitions, CMS documents) and list every
   step and variant, with who sees each one. Figma names are often copy-pasted, with the
   same name on dozens of frames, so match frames by the texts `frames` prints.
3. **Every screen frame is accounted for.** `check` must report 0 unmapped before you show
   the map. Any coverage problem goes in the reply.
4. **"1:1" means you compared.** Mark `match` only after putting the frame beside the built
   screen: a screenshot (step 5) or the component's copy and structure. Mark a difference in
   copy, layout or elements as `differs`, and say what differs in the card's `note`.

## Steps

### 1. Pin the inputs

- **The reference.** The Figma file plus the page or section to check: from the URL, take
  the fileKey and the node-id, with `-` turned into `:`. When the file has several pages
  (mobile, desktop), the one the user names is the reference. The others only settle doubts,
  such as a variant list. Ask in one line if it isn't clear which page.
- **The app.** Where the flow is defined, and a base URL (staging) for the path links.
- **The folder.** `~/Desktop/<ticket-or-slug>-flow-map/` holds `figma/`, `built/`,
  `frames.json`, `spec.json` and `flow-map.html`. A re-run reuses it.

### 2. List the Figma frames

Figma MCP: `create_session` for the file, then `get_metadata` with the page's nodeId.
The output is big and gets saved to a file. Pass that file to `frames`; it reads raw XML or
the saved tool-result JSON.

```bash
python3 -I scripts/flowmap.py frames <saved-metadata> --out <dir>/frames.json
```

It prints the page as rows, top to bottom. Frames of at least 300×400 are marked `SCREEN`;
anything smaller (banners, headings, labels) is marked `label`. Each frame shows its first
texts, and hidden frames are flagged. Read that layout:

- **A row of screens, left to right, is one path.** Rows under a banner or label (such as
  "Self-Pay" or "Patient Responsibility $0") are swimlanes: the flow a different group of
  users sees. Use the banner's node id as the lane's `banner`.
- **A screen stacked under another screen in the same column** is usually another state or
  variant of it: a dropdown open, a modal, other copy.
- **A hidden frame** may be a cut screen. Ask before treating it as current.

Then read the page's comments (`get_comments`). Decisions such as "move this before X",
"self-pay only" or "cut these questions" explain both variants and removed screens.

### 3. Fetch the Figma thumbnails

For each screen, call `get_screenshot` (fileKey, nodeId, `maxDimension: 1100`). Download its
`image_url` right away, in the same batch:
`curl -sf -o <dir>/figma/<node-id with : as ->.png "<image_url>"`.
The URLs expire within minutes. Then shrink them all:

```bash
python3 -I scripts/flowmap.py thumbs <dir>/figma
```

### 4. Write the spec

`spec.json` is the built flow in order, with Figma frames attached:

```json
{
  "title": "Onboarding vs Figma mobile",
  "intro": "Built from the step config on staging, beside the Figma mobile page.",
  "figma": {"fileKey": "AbC123", "fileName": "Onboarding"},
  "app": {"baseUrl": "https://staging.example.com"},
  "frames": "frames.json",
  "sections": [
    {"title": "Everyone", "intro": "Same for every user.", "cards": [
      {"step": "goal", "title": "What brings you here?", "path": "/start/goal",
       "figma": [{"node": "12:34", "label": "Goal", "kind": "match"}],
       "built": ["built/goal.png"]},
      {"step": "plan", "title": "Pick a plan", "path": "/start/plan",
       "figma": [{"node": "12:40", "label": "Plans", "kind": "match"},
                 {"node": "12:52", "label": "Compare sheet open", "kind": "state"}],
       "marker": "Price lookup starts here"},
      {"step": "survey", "title": "Tell us more", "path": "/start/survey",
       "note": "Built only: no Figma frame."}
    ]},
    {"title": "Payment lanes", "lanes": [
      {"name": "Free trial", "tag": "Template A", "banner": "12:90", "cards": [
        {"step": "trial", "title": "Start your trial", "missing": true,
         "figma": [{"node": "12:91", "label": "Trial offer", "kind": "match"}],
         "note": "In Figma, not built yet."}
      ]}
    ]}
  ],
  "ignore": [{"node": "12:99", "reason": "Designer notes, not a screen"}]
}
```

- **Cards.** One card per built step. A step's variants are either several frames on one
  card (labelled with who sees each) or separate cards in their own lanes.
- **`kind`.** One of `match`, `state` (the same screen in another state) or `differs`.
- **No `figma`.** A card without it is built only: a screen Figma doesn't have.
- **`missing: true`.** The card is in Figma but not built.
- **`marker` and `note`.** `marker` is one line above the card about what happens there
  (a request starts, a wait). `note` is anything the reader needs, such as a copy
  difference or why a variant exists.

### 5. Screenshot the built flow (when asked, or to prove 1:1)

A real flow holds state, so a URL alone won't reach a later step; walk it instead. Write a
Playwright steps file and run it with qa-video's headless recorder, which finds the
project's Playwright:

```bash
bash ../qa-video/scripts/qavid page <start-url> --steps walk.mjs --width 390 --height 844 --no-cursor
```

- **Screenshots.** On each screen, call
  `await page.screenshot({ path: "<dir>/built/<step>.png", fullPage: true })`.
- **Waits.** Wait for a client-side route change with
  `page.waitForFunction(() => location.pathname.endsWith("/<step>"))`.
  `waitForURL` waits for a load event that a client-side navigation never fires, so it hangs.
- **Width.** Use the Figma frame's width.
- **Data.** Staging only, with synthetic identities and test cards.

Then run `thumbs <dir>/built` and add each file to its card's `built`.

### 6. Check, render, look

```bash
python3 -I scripts/flowmap.py check <dir>/spec.json    # exits 1 on any unmapped frame
python3 -I scripts/flowmap.py render <dir>/spec.json   # writes <dir>/flow-map.html
```

Fix the spec until `check` passes. Then open the page at phone and desktop widths and look
at it: no horizontal page scroll, every thumbnail loads, and clicking a picture opens the
side-by-side view.

### 7. Deliver

Publish the HTML as a private Artifact when the Artifact tool is available. Otherwise send
the file (SendUserFile, display `render`).

The reply is the comparison result:
- `check`'s summary line;
- what differs, what isn't built and what is built only, each with the step and a link to
  its frame;
- the basis for any "all 1:1" claim: the step 5 screenshots, or what you compared instead.

## Common mistakes

- Matching frames by name, when frame names are copy-pasted: match by content.
- Ignoring a frame to make `check` pass. A screen that isn't built is `missing`, not ignored.
- Calling a screen "removed" with no evidence. The screens come from Figma. A built screen
  Figma doesn't have is "built only", and a screen that left Figma shows up in its comments
  or version history. Ask the designer when neither settles it.
- Letting `image_url`s expire by fetching every screenshot first and downloading later.
