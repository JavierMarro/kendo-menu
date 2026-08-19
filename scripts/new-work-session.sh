#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
session_date="$(date +%F)"
duration="not recorded"
slug=""

usage() {
  cat <<'USAGE'
Usage:
  pnpm session:new -- --slug <short-slug> --duration "<duration>" [--date YYYY-MM-DD]

Options:
  --slug       Required filename slug, for example project-initialization.
  --duration   Duration to record, for example "23m 51s".
  --date       Session date in YYYY-MM-DD format. Defaults to today.
  --help       Show this help.
USAGE
}

if (($# > 0)) && [[ "$1" == "--" ]]; then
  shift
fi

while (($# > 0)); do
  case "$1" in
    --slug)
      if (($# < 2)); then
        printf '%s\n' 'Error: --slug requires a value.' >&2
        exit 1
      fi
      slug="$2"
      shift 2
      ;;
    --duration)
      if (($# < 2)); then
        printf '%s\n' 'Error: --duration requires a value.' >&2
        exit 1
      fi
      duration="$2"
      shift 2
      ;;
    --date)
      if (($# < 2)); then
        printf '%s\n' 'Error: --date requires a value.' >&2
        exit 1
      fi
      session_date="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      printf 'Error: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$slug" ]]; then
  printf '%s\n' 'Error: --slug is required.' >&2
  usage >&2
  exit 1
fi

if [[ ! "$session_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  printf 'Error: invalid date: %s (expected YYYY-MM-DD).\n' "$session_date" >&2
  exit 1
fi

slug="$(printf '%s' "$slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

if [[ -z "$slug" ]]; then
  printf '%s\n' 'Error: --slug must contain at least one letter or number.' >&2
  exit 1
fi

output_path="$repo_root/docs/work-sessions/${session_date}-${slug}.md"

if [[ -e "$output_path" ]]; then
  printf 'Error: session entry already exists: %s\n' "$output_path" >&2
  exit 1
fi

mkdir -p "$repo_root/docs/work-sessions"

{
  printf '# Work session: %s\n\n' "${slug//-/ }"
  printf -- '- Date: %s\n' "$session_date"
  printf -- '- Duration: %s\n' "$duration"
  printf '\n'
  cat <<'TEMPLATE'
## Scope

<!-- What was this session intended to accomplish? -->

## Starting state

<!-- What was true before work began? -->

## Main changes

-

## Decisions

-

## Failures and roadblocks

- None encountered, or list each failure with its resolution.

## Verification

-

## Follow-up context

<!-- What should the next agent know or do next? -->
TEMPLATE
} > "$output_path"

printf 'Created %s\n' "$output_path"
