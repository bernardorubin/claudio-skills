#!/usr/bin/env python3
"""PreToolUse hook: let the Slack Drafts phone page sync with nobody at the Mac.

Allows ArtifactData `query` and `batch` calls to the one artifact the mod found as
the phone page (the mod copies its link to ~/.config/claudio/slack-drafts-phone-url),
so the idle sync poll reads phone Sent/trash taps and writes back
without an approval prompt (a mod's timer can't approve its own calls). Other
artifacts, other actions and the user's deny/ask rules stay as Claude Code decides.
"""
import json
import os
import re
import sys

try:
    with open(os.path.expanduser("~/.config/claudio/slack-drafts-phone-url")) as f:
        phone_url = f.read().strip()
except OSError:
    phone_url = ""
# same pattern as ARTIFACT_URL in register.tsx; change both together
if not re.fullmatch(r"https://claude\.ai/\S*artifact/[\w-]+", phone_url):
    phone_url = ""
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = data.get("tool_input") or {}
if (
    phone_url
    and data.get("tool_name") == "ArtifactData"
    and tool_input.get("url") == phone_url
    and tool_input.get("action") in ("query", "batch")
):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": "Slack Drafts phone page sync",
                }
            }
        )
    )
