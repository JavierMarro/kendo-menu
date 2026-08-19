#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shopt -s nullglob
entries=("$repo_root"/docs/work-sessions/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md)
failed=0

for entry in "${entries[@]}"; do
  line_count="$(awk 'END { print NR }' "$entry")"
  if ((line_count > 8)); then
    relative_path="${entry#"$repo_root"/}"
    printf 'Error: %s has %d lines; maximum is 8.\n' "$relative_path" "$line_count" >&2
    failed=1
  fi
done

if ((failed)); then
  exit 1
fi

printf 'Checked %d work-session entries; all are at most 8 lines.\n' "${#entries[@]}"
