---
name: onboarding-code-comments
description: Add concise senior-engineer onboarding comments to an explicitly selected implementation scope without changing runtime behavior. Invoke only with `$onboarding-code-comments`; do not use for ordinary implementation, documentation, generated files, or tests unless the user expressly includes them.
---

# Onboarding Code Comments

Explain the implementation to an engineer joining the project while preserving the code exactly.

## Select the scope

- Confirm the requested implementation files from repository evidence such as the named job commits and current diff. Do not infer a broader codebase-wide commenting pass.
- Include handwritten runtime, domain, persistence, composition, and schema source that materially implements the requested work.
- Exclude tests, generated migrations or snapshots, lockfiles, manifests, session histories, and ordinary documentation unless the user explicitly includes them.
- Inspect the complete selected files and their nearby contracts before editing so comments describe actual behavior and current invariants.

## Commenting standard

- Give every selected file a concise top-of-file block comment. In two to four sentences, state its responsibility, its main collaborator or trust boundary, and the most important non-obvious guarantee.
- Add comments before important blocks where an onboarding engineer needs the reason, ordering constraint, failure behavior, security boundary, or data invariant. Prefer one to three sentences per block.
- Explain **why the block exists and what must remain true**. Do not translate syntax, repeat a function or type name, narrate each line, or label obvious imports and getters.
- For authentication and persistence, prioritize credential handling, account authority, validation boundaries, lock order, atomicity, retry/idempotency semantics, error sanitization, and lifecycle ownership.
- Keep comments durable: avoid temporary job history, test counts, speculative future designs, or claims not established by the implementation.
- Never put credentials, tokens, connection strings, user data, or realistic secret-shaped examples in comments.
- Match the file's existing voice and remove or consolidate nearby comments when necessary to avoid duplication. Comments should make the code easier—not slower—to scan.

## Preserve behavior

- Make comments and comment-driven whitespace changes only. Do not change executable tokens, types, exports, imports, schemas, generated output, configuration, or tests.
- Do not conceal a defect with prose. Stop and report a concrete correctness or security problem instead of documenting it as intended behavior.
- Preserve unrelated work and do not commit, push, migrate, deploy, or modify external state.

## Verification

1. Review the final diff file by file and prove that every selected file has an accurate file-level comment and only useful block comments.
2. Compare comment-stripped/transpiled output before and after when a baseline can be captured; otherwise use an equivalent token-aware comparison. A visual diff alone is not sufficient for a large pass.
3. Run formatting for the selected files and one bounded type/lint or package check appropriate to their scope. Comment-only intent does not justify skipping syntax and placement validation.
4. Report the exact files commented, exclusions, behavior-preservation evidence, and check results. Do not claim comments-only if any executable token changed.
