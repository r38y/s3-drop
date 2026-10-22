#!/bin/bash

# PostToolUse hooks receive the edited file path as JSON on stdin.
file_path=$(jq -r '.tool_input.file_path // empty') || exit 2
[ -n "$file_path" ] || exit 0

# Resolve installed tools and configuration from this repository.
project_root=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}
cd "$project_root" || exit 2

case "$file_path" in
*.js | *.jsx | *.ts | *.tsx | *.css | *.scss | *.json | *.jsonc | *.md)
    npx --no-install prettier --write "$file_path" >&2 || exit 2
    ;;
*.sh)
    bash -n "$file_path" >&2 || exit 2
    ;;
esac
