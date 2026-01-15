#!/bin/bash

# Read JSON input from stdin
json_input=$(cat)

# Extract file path from the JSON
file_path=$(echo "$json_input" | jq -r '.tool_input.file_path // empty')

# Exit if no file path
if [ -z "$file_path" ]; then
    exit 0
fi

# Format based on file extension
case "$file_path" in
*.ts | *.tsx | *.json | *.md)
    echo "Formatting $file_path with prettier..."
    npx prettier --write "$file_path"
    ;;
esac

exit 0
