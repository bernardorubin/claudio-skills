#!/usr/bin/env python3
"""Day documents for the weekly-summary page. Stdlib only.

  weekly_store.py migrate OUT_DIR OLD_PAGE.html...   old week pages -> OUT_DIR/<date>.json day documents
  weekly_store.py merge STORE.json DAY.json...       local mode: fold day documents into the store
  weekly_store.py render TEMPLATE TITLE OUT.html [STORE.json]
                                                     write the page; without STORE it reads its own db
  weekly_store.py check                              self-test
"""
import html
import json
import os
import re
import sys
from datetime import datetime, timezone


def old_page_data(path):
    m = re.search(r"const DATA = (\{.*?\});\n", open(path).read(), re.S)
    return json.loads(m.group(1)) if m else None


def migrate(pages):
    """Turn old week pages (one JSON blob each) into day documents. A later page wins where weeks overlap."""
    days = {}
    for p in sorted(pages, key=lambda p: p["end"]):
        for day in p.get("days", []):
            days.setdefault(day["date"], {"date": day["date"]})["counts"] = day.get("counts", [])
        for i in p.get("items", []):
            # an open item dated before the page's week was still moving in it: activity on the week's last day
            date, kind = (i["date"], "opened") if i["date"] >= p.get("start", "") else (p["end"], "active")
            if i["status"] == "shipped":
                date, kind = i["date"], "done"
            doc = days.setdefault(date, {"date": date})
            ev = {"kind": kind, **{k: i.get(k) for k in ("key", "url", "who", "title", "repo", "state")}}
            doc["events"] = [e for e in doc.get("events", []) if (e["key"], e["kind"]) != (ev["key"], ev["kind"])] + [ev]
        for r in p.get("releases", []):
            doc = days.setdefault(r["date"], {"date": r["date"]})
            rel = {k: r.get(k) for k in ("repo", "source", "version", "url", "items")}
            doc["releases"] = [x for x in doc.get("releases", []) if (x["repo"], x["version"]) != (rel["repo"], rel["version"])] + [rel]
        if p.get("brief"):
            days.setdefault(p["end"], {"date": p["end"]})["brief"] = p["brief"]
    for doc in days.values():
        doc.setdefault("counts", [])
        doc.setdefault("events", [])
        doc.setdefault("releases", [])
    return days


def merge(store, docs):
    """Same rule as a db update: fields in the new document replace the old ones; a field it leaves out (brief) stays."""
    for doc in docs:
        store["days"].setdefault(doc["date"], {}).update(doc)
    store.setdefault("run", {})["lastRun"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return store


def render(template, title, data):
    s = open(template).read().replace("__TITLE__", html.escape(title))
    if not data:  # the artifact: its publish skeleton adds the charset
        return s
    # a local copy has no skeleton, so it declares its own charset and viewport
    head = '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    return head + s.replace("/*__DATA__*/null", json.dumps(data).replace("</", "<\\/"))


def check():
    a = {"start": "2026-10-08", "end": "2026-10-14", "days": [{"date": "2026-10-14", "counts": [[2, "PRs opened"]]}],
         "items": [{"status": "open", "key": "X-1", "date": "2026-10-14", "who": "Dana", "title": "a"},
                   {"status": "open", "key": "X-9", "date": "2026-07-20", "who": "Dana", "title": "old"}],
         "releases": [], "brief": {"shipped": ["s"], "upcoming": []}}
    b = {"start": "2026-10-10", "end": "2026-10-16", "days": [{"date": "2026-10-14", "counts": [[3, "PRs opened"]]}],
         "items": [{"status": "shipped", "key": "X-1", "date": "2026-10-14", "who": "Dana", "title": "b"}],
         "releases": [{"repo": "r", "source": "GitHub", "version": "1.0", "date": "2026-10-15", "items": []}]}
    days = migrate([b, a])
    assert days["2026-10-14"]["counts"] == [[3, "PRs opened"]], "later page wins counts"
    assert {(e["key"], e["kind"], e["title"]) for e in days["2026-10-14"]["events"]} == {
        ("X-1", "opened", "a"), ("X-1", "done", "b"), ("X-9", "active", "old")}, "events union by key and kind"
    assert "2026-07-20" not in days, "an old open item lands in its page's week, not on its creation date"
    assert days["2026-10-14"]["brief"] == {"shipped": ["s"], "upcoming": []}
    assert days["2026-10-15"]["releases"][0]["version"] == "1.0"
    store = merge({"days": {"2026-10-14": {"date": "2026-10-14", "brief": {"shipped": ["s"]}, "events": []}}},
                  [{"date": "2026-10-14", "events": [{"kind": "active", "key": "X-2"}]}])
    assert store["days"]["2026-10-14"]["brief"] == {"shipped": ["s"]}, "merge keeps a brief it wasn't given"
    print("ok")


def main(cmd, *args):
    if cmd == "migrate":
        out, pages = args[0], [p for p in map(old_page_data, args[1:]) if p]
        os.makedirs(out, exist_ok=True)
        for date, doc in sorted(migrate(pages).items()):
            json.dump(doc, open(os.path.join(out, f"{date}.json"), "w"))
            print(os.path.join(out, f"{date}.json"))
    elif cmd == "merge":
        path = args[0]
        store = json.load(open(path)) if os.path.exists(path) else {"days": {}, "run": {}}
        json.dump(merge(store, [json.load(open(f)) for f in args[1:]]), open(path, "w"), indent=1)
    elif cmd == "render":
        template, title, out = args[:3]
        data = None
        if len(args) > 3:
            store = json.load(open(args[3]))
            data = {"run": store.get("run", {}), "days": list(store["days"].values())}
        open(out, "w").write(render(template, title, data))
    elif cmd == "check":
        check()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])
