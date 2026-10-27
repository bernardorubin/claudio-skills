#!/usr/bin/env python3
"""PreToolUse hook: let the Slack Drafts phone page sync with nobody at the Mac.

Allows ArtifactData `query` and `batch` calls to the one artifact the `phoneUrl`
option names, so the idle sync poll reads phone Sent/trash taps and writes back
without an approval prompt (a mod's timer can't approve its own calls). Other
artifacts, other actions and the user's deny/ask rules stay as Claude Code decides.
"""
import json
import os
import sys

phone_url = os.environ.get("CLAUDE_PLUGIN_OPTION_PHONEURL", "")
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
