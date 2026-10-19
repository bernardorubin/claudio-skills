#!/usr/bin/env python3
"""List the Figma comment threads that need the current user's attention.

Scans every file in the watched Figma projects, keeps the threads with a new comment in the window that mention the
user or reply in a thread the user is part of, and prints them as JSON:
file, thread, where it is pinned (node and its top-level frame), a deep link,
and every comment in the thread.

Stdlib only. The token never reaches stdout.

  figma_comments.py [--since 3d|48h|2026-10-10] [--project ID] [--team ID]
                    [--file KEY] [--all] [--include-resolved] [--save-run]

Config: ~/.config/claudio/figma.json
  {"projects": ["<id>"], "teams": [], "files": [{"key": "...", "name": "..."}],
   "files_refreshed_at": "<iso>"}
  Personal access tokens can't list a project's files (that needs projects:read,
  which Figma only grants to OAuth apps), so `files` is the project's file list,
  refreshed from the logged-in Figma web app (see SKILL.md). When the REST listing
  is refused, the script falls back to that list and says so under "warnings".
Token:  $FIGMA_TOKEN, else an `export FIGMA_TOKEN=...` line in a shell profile,
        else ~/.config/claudio/figma-token. Scopes: current_user:read,
        file_comments:read, file_content:read, file_metadata:read.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.figma.com/v1"
CONFIG_DIR = os.path.expanduser("~/.config/claudio")
CONFIG = os.path.join(CONFIG_DIR, "figma.json")
STATE = os.path.join(CONFIG_DIR, "figma-triage-state.json")
# ponytail: one-time migration from the skill's old name (figma-to-jira); drop once nobody runs a pre-rename build
if not os.path.exists(STATE) and os.path.exists(os.path.join(CONFIG_DIR, "figma-to-jira-state.json")):
    os.rename(os.path.join(CONFIG_DIR, "figma-to-jira-state.json"), STATE)
PROFILES = ["~/.zshrc", "~/.zprofile", "~/.zshenv", "~/.bashrc", "~/.bash_profile", "~/.profile"]


def fail(message, code=2):
    print(json.dumps({"error": message}), file=sys.stderr)
    sys.exit(code)


def token():
    value = os.environ.get("FIGMA_TOKEN", "").strip()
    if value:
        return value
    pattern = re.compile(r"""^\s*export\s+FIGMA_TOKEN=["']?([^"'\s]+)""")
    for profile in PROFILES:
        try:
            with open(os.path.expanduser(profile)) as handle:
                for line in handle:
                    match = pattern.match(line)
                    if match:
                        return match.group(1)
        except OSError:
            continue
    try:
        with open(os.path.join(CONFIG_DIR, "figma-token")) as handle:
            value = handle.read().strip()
            if value:
                return value
    except OSError:
        pass
    fail("No Figma token. Create a personal access token (Figma > Settings > Security > "
         "Generate new token) with current_user:read, file_comments:read, file_content:read and "
         "file_metadata:read, then export FIGMA_TOKEN in your shell profile or save it to "
         "~/.config/claudio/figma-token (chmod 600).")


class ScopeError(Exception):
    pass


def get(path, tok, params=None, soft=False):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(url, headers={"X-Figma-Token": tok})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:400]
        if error.code == 403 and "scope" in body:
            if soft:
                raise ScopeError(body)
            fail(f"Figma token is missing a scope for {path}: {body}")
        if error.code == 403:
            fail(f"403 on {path}: the token's account has no access. {body}")
        fail(f"HTTP {error.code} on {path}: {body}")


def parse_since(value, saved):
    now = dt.datetime.now(dt.timezone.utc)
    if not value:
        if saved:
            return dt.datetime.fromisoformat(saved.replace("Z", "+00:00"))
        return now - dt.timedelta(days=3)
    match = re.fullmatch(r"(\d+)\s*([hd])", value)
    if match:
        amount, unit = int(match.group(1)), match.group(2)
        return now - (dt.timedelta(hours=amount) if unit == "h" else dt.timedelta(days=amount))
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def load_json(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def slug(name):
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-") or "file"


def boxes(node, out):
    box = node.get("absoluteBoundingBox")
    if box:
        out.append((node["id"], node.get("name", ""), box))


def locate(tok, key, node_id, point, cache):
    """The pinned node's box and the top-level frames that contain it, per page."""
    if key not in cache:
        tree = get(f"/files/{key}", tok, {"depth": 2})
        pages = []
        for page in tree.get("document", {}).get("children", []):
            frames = []
            for child in page.get("children", []):
                boxes(child, frames)
            pages.append((page.get("id"), page.get("name"), frames))
        cache[key] = pages
    target, node_box = None, None
    if node_id:
        nodes = get(f"/files/{key}/nodes", tok, {"ids": node_id, "depth": 0}).get("nodes", {})
        doc = (nodes.get(node_id) or {}).get("document") or {}
        node_box = doc.get("absoluteBoundingBox")
        if node_box:
            target = (node_box["x"] + node_box["width"] / 2, node_box["y"] + node_box["height"] / 2)
        frame_ids = {fid for _, _, frames in cache[key] for fid, _, _ in frames}
        if node_id in frame_ids:
            return node_box, [{"frame_id": node_id, "frame_name": doc.get("name", "")[:80]}]
    elif point:
        target = point
    if not target:
        return node_box, []
    x, y = target
    found = []
    for page_id, page_name, frames in cache[key]:
        for frame_id, frame_name, box in frames:
            if box["x"] <= x <= box["x"] + box["width"] and box["y"] <= y <= box["y"] + box["height"]:
                found.append({"frame_id": frame_id, "frame_name": frame_name[:80], "page": page_name,
                              "frame_box": box})
    return node_box, found


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since")
    parser.add_argument("--project", action="append", default=[])
    parser.add_argument("--team", action="append", default=[])
    parser.add_argument("--file", action="append", default=[])
    parser.add_argument("--all", action="store_true", help="every new comment, not only mentions and replies")
    parser.add_argument("--include-resolved", action="store_true")
    parser.add_argument("--save-run", action="store_true", help="record now as the start of the next default window")
    args = parser.parse_args()

    config = load_json(CONFIG)
    state = load_json(STATE)
    projects = args.project or config.get("projects", [])
    teams = args.team or config.get("teams", [])
    extra = args.file or config.get("files", [])
    if not (projects or teams or extra):
        fail(f"Nothing to watch. Add Figma project or team ids to {CONFIG}, "
             '{"projects": ["<id>"]}, or pass --project/--team/--file.')

    tok = token()
    run_started = dt.datetime.now(dt.timezone.utc)
    since = parse_since(args.since, state.get("last_run"))
    me = get("/me", tok)
    my_id, my_handle = me["id"], me.get("handle", "")

    files, warnings = {}, []
    try:
        for team in teams:
            for project in get(f"/teams/{team}/projects", tok, soft=True).get("projects", []):
                projects.append(str(project["id"]))
        for project in dict.fromkeys(projects):
            listing = get(f"/projects/{project}/files", tok, soft=True)
            for entry in listing.get("files", []):
                files[entry["key"]] = {"name": entry["name"], "project": listing.get("name")}
    except ScopeError:
        warnings.append("The token can't list project files (personal tokens get no projects:read); "
                        f"scanned the saved file list from {config.get('files_refreshed_at', 'an unknown date')}. "
                        "Refresh it from the Figma web app when a file is added.")
        if not extra:
            fail("The token can't list the project's files and figma.json has no saved file list. "
                 "Refresh `files` from the logged-in Figma web app (see SKILL.md, Setup).")
    for entry in extra:
        key, name = (entry.get("key"), entry.get("name")) if isinstance(entry, dict) else (entry, None)
        if key in files:
            continue
        if not name:
            name = get(f"/files/{key}/meta", tok).get("file", {}).get("name", key)
        files[key] = {"name": name, "project": None}

    mention = re.compile(re.escape(my_handle), re.I) if my_handle else None
    threads, frame_cache = [], {}
    for key, info in files.items():
        comments = get(f"/files/{key}/comments", tok).get("comments", [])
        by_thread = {}
        for comment in comments:
            root = comment.get("parent_id") or comment["id"]
            by_thread.setdefault(root, []).append(comment)
        for root, items in by_thread.items():
            items.sort(key=lambda c: c["created_at"])
            head = next((c for c in items if c["id"] == root), items[0])
            if head.get("resolved_at") and not args.include_resolved:
                continue
            new = [c for c in items if c["user"]["id"] != my_id
                   and dt.datetime.fromisoformat(c["created_at"].replace("Z", "+00:00")) >= since]
            if not new:
                continue
            mine = any(c["user"]["id"] == my_id for c in items)
            mentioned = any(mention and mention.search(c.get("message", "")) for c in new)
            if not (args.all or mentioned or mine):
                continue
            meta = head.get("client_meta") or {}
            node_id = meta.get("node_id")
            point = (meta["x"], meta["y"]) if "x" in meta and "y" in meta else None
            node_box, frames = locate(tok, key, node_id, point, frame_cache) if (node_id or point) else (None, [])
            link_node = node_id or (frames[0]["frame_id"] if frames else None)
            url = f"https://www.figma.com/design/{key}/{slug(info['name'])}"
            if link_node:
                url += "?node-id=" + link_node.replace(":", "-")
            url += f"#{root}"
            threads.append({
                "file_key": key,
                "file_name": info["name"],
                "project": info["project"],
                "thread_id": root,
                "reason": "mention" if mentioned else ("reply in your thread" if mine else "new comment"),
                "node_id": node_id,
                "node_box": node_box,
                "pin_offset": meta.get("node_offset") or (dict(x=point[0], y=point[1]) if point else None),
                "frames": frames,
                "url": url,
                "resolved": bool(head.get("resolved_at")),
                "comments": [{"id": c["id"], "author": c["user"]["handle"], "created_at": c["created_at"],
                              "message": c.get("message", ""), "new": c in new} for c in items],
            })

    threads.sort(key=lambda t: max(c["created_at"] for c in t["comments"]))
    print(json.dumps({
        "user": my_handle,
        "since": since.isoformat(),
        "files_scanned": len(files),
        "warnings": warnings,
        "threads": threads,
    }, indent=2, ensure_ascii=False))

    if args.save_run:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        state["last_run"] = run_started.isoformat()
        with open(STATE, "w") as handle:
            json.dump(state, handle, indent=2)


if __name__ == "__main__":
    main()
