#!/usr/bin/env python3
"""Markdown subset -> Jira ADF doc JSON on stdout.

Handles what a triage ticket needs: paragraphs, "- " bullets, "## " headings,
[label](url) links and `code`. Usage: md2adf.py body.md
"""
import json
import re
import sys

TOKEN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`")


def inline(line):
    out, i = [], 0
    for m in TOKEN.finditer(line):
        if m.start() > i:
            out.append({"type": "text", "text": line[i:m.start()]})
        if m.group(1):
            mark = {"type": "link", "attrs": {"href": m.group(2)}}
            out.append({"type": "text", "text": m.group(1), "marks": [mark]})
        else:
            out.append({"type": "text", "text": m.group(3), "marks": [{"type": "code"}]})
        i = m.end()
    if i < len(line):
        out.append({"type": "text", "text": line[i:]})
    return out


def to_adf(md):
    content, bullets = [], None
    for line in md.strip().split("\n"):
        if line.startswith("- "):
            if bullets is None:
                bullets = {"type": "bulletList", "content": []}
                content.append(bullets)
            para = {"type": "paragraph", "content": inline(line[2:])}
            bullets["content"].append({"type": "listItem", "content": [para]})
            continue
        bullets = None
        if not line.strip():
            continue
        if line.startswith("## "):
            content.append({"type": "heading", "attrs": {"level": 3}, "content": inline(line[3:])})
        else:
            content.append({"type": "paragraph", "content": inline(line)})
    return {"type": "doc", "version": 1, "content": content}


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        doc = to_adf("Hi [A](http://a) `x`\n- one\n## H")
        assert doc["content"][0]["content"][1]["marks"][0]["attrs"]["href"] == "http://a"
        assert doc["content"][0]["content"][3]["marks"][0]["type"] == "code"
        assert doc["content"][1]["type"] == "bulletList"
        assert doc["content"][2]["type"] == "heading"
        print("ok")
    else:
        print(json.dumps(to_adf(open(sys.argv[1]).read())))
