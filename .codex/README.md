# Local agent hooks

The optional `.codex/hooks.json` is intentionally ignored: it points to the owner's local
Impeccable installation, not a portable CI dependency. An absent script is a no-op. User-global
and plugin hook configurations can also exist; this file does not configure them.

The existing `PostToolUse` hook offers UI advice after edits. Its `IMPECCABLE_HOOK_QUIET=1` setting
suppresses clean/pending acknowledgements, not fresh findings. The existing `Stop` design pass is
already silent when clean. These are advisory checks, not authentication or persistence guarantees
and not permission to redesign unrelated UI.

The observed local installation lacks optional static HTML parser modules and falls back to regex
matching. It cannot establish computed contrast or comprehensive accessibility coverage; ordinary
browser tests and human/semantic review remain necessary. No global packages were installed here.

No additional hooks are needed for the managed-auth migration. Do not automatically migrate
databases, inject secrets, run full suites after each edit, auto-commit, or grant broad tool
approvals through hooks. Use the API skill and explicit verification gates instead.

In Codex CLI, use `/hooks` to inspect and review the changed local definition. Newly changed project
hooks require owner trust before execution; do not bypass that review or modify global settings.
JSON/configuration smoke tests do not establish actual CLI discovery, trust, or CI execution.

References: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[task-scoped skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
