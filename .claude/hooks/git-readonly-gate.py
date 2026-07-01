#!/usr/bin/env python3
"""PermissionRequest gate: auto-allow a Bash command only when every segment is a
plain `cd` or a read-only git invocation. Anything else (writes, network ops,
dual-use verbs, unparseable shell) emits nothing and falls through to the normal
permission prompt.

Conservative by design: dual-use verbs (branch, tag, config, stash, remote,
reflog, ...) are NOT auto-allowed because the wrong flag mutates the repo. They
simply prompt — minor friction, safe default.
"""
import json
import re
import shlex
import sys

# Subcommands that cannot mutate the repository or hit the network.
READ_ONLY = {
    "status", "log", "diff", "show", "blame", "shortlog", "describe",
    "rev-parse", "rev-list", "ls-files", "ls-tree", "cat-file",
    "whatchanged", "count-objects", "var", "help",
}

# git global options consumed BEFORE the subcommand that take a separate value
# token (e.g. `git -C /repo status`). Listed so the value isn't mistaken for the
# subcommand.
GLOBAL_OPTS_WITH_VALUE = {
    "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
}


def git_subcommand(tokens):
    """Return the subcommand from the tokens following `git`, or None."""
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in GLOBAL_OPTS_WITH_VALUE:
            i += 2  # skip the option and its value
            continue
        if token.startswith("-"):
            i += 1  # flag (incl. --git-dir=... value-attached form)
            continue
        return token
    return None


def segment_is_safe(segment):
    """A segment is safe only if it is empty, a `cd`, or a read-only git call."""
    segment = segment.strip()
    if not segment:
        return True
    try:
        tokens = shlex.split(segment)
    except ValueError:
        return False  # unbalanced quotes / unparseable -> never auto-allow
    if not tokens:
        return True
    program = tokens[0].rsplit("/", 1)[-1]
    if program == "cd":
        return True
    if program == "git":
        return git_subcommand(tokens[1:]) in READ_ONLY
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return  # no decision -> normal prompt
    command = data.get("tool_input", {}).get("command", "")
    if not command.strip():
        return
    # Split on shell control operators: && || | ; & and newlines.
    segments = re.split(r"&&|\|\||[;|&\n]", command)
    if all(segment_is_safe(segment) for segment in segments):
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "allow"},
            }
        }))


if __name__ == "__main__":
    main()
