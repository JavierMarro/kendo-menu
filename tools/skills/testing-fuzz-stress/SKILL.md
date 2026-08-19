---
name: testing-fuzz-stress
description: Attack a specified module, file, public API, or directory with black-box seeded fuzzing, state-space exploration, corruption tests, round-trip checks, concurrency interleavings, and stress tests. Use when the user asks to destroy an implementation, find edge cases, fuzz a module, or perform paranoid robustness testing.
---

# Testing: Fuzz and Stress

Act as a paranoid testing engineer. Attack the supplied file, module, public API, or directory and
try to expose bugs through combinations of internal states. Optimize for state coverage and
reproducibility, not ritual TDD or line-coverage numbers.

## Operating contract

- Accept a target argument. If the target is missing or ambiguous, inspect the repository and ask
  one focused question before choosing a materially different scope.
- Test through public exports, classes, commands, or user-facing UI flows only. Do not import private
  modules, reach into implementation fields, mock internal helpers, or assert incidental DOM shape.
- Keep tests valid if the implementation is refactored behind the same public contract.
- Keep the implementation unchanged unless the user explicitly asks for fixes. Add tests and reports
  in the repository's established locations.
- Use TypeScript and the project's test runner. Never weaken strict typing with `any`, `@ts-ignore`,
  unsafe casts, or hidden global state.
- Avoid tests that exist only to raise line coverage. Every loop must target a state transition,
  invariant, boundary, corruption mode, or interaction between operations.

## Setup and target model

1. Read `AGENTS.md`, the relevant package README, and the target's public entry point. Inspect
   `package.json` and workspace configuration to identify the package manager and test runner.
2. Establish the API contract: accepted inputs, outputs, errors, persistence effects, idempotence,
   ordering guarantees, resource limits, and invariants that must always hold.
3. Use existing test conventions. If no runner exists, report that limitation and propose the
   smallest appropriate setup; do not silently invent a command that cannot run.
4. For this repository, use the workspace's Vitest configuration through pnpm from the repository
   root.

## Seeded generation

- Choose a reproducible integer seed and print it at the start of every fuzz run.
- Accept an explicit seed when the runner supports CLI arguments or environment variables. Record the
  exact seed in the report and print it again when a case fails.
- Use a small deterministic PRNG owned by the test or an existing seeded generator. Do not use
  `Math.random()`, wall-clock values, unseeded UUIDs, or ambient randomness in generated inputs.
- Generate structured values, not only random strings: empty values, maximum/minimum numbers,
  Unicode, duplicate ids, reordered operations, malformed persisted data, long sequences, and valid
  values near every constraint.
- Preserve or shrink the failing input while keeping the seed. A one-command re-run must be possible
  from the report without relying on the original machine state.

## Attack matrix

Exercise each applicable category and record its iteration count:

- **Boundary:** empty, singleton, minimum, maximum, overflow, invalid enum, duplicate, missing, and
  wrong-type inputs at every public boundary.
- **Fuzz:** seeded valid and invalid structures, operation sequences, permutations, and mixed actions.
- **Round-trip:** serialize/deserialize, encode/decode, persist/rehydrate, or create/update/read
  cycles. Assert semantic equality, not object identity or formatting.
- **Corruption:** truncated JSON, unknown fields, stale versions, invalid storage, partial writes,
  interrupted operations, and hostile user input. Verify safe rejection or migration.
- **Stress:** long sequences, large collections, repeated mount/unmount, memory-sensitive payloads,
  and realistic time budgets. Watch for hangs, unbounded growth, and resource leaks.
- **Concurrency:** overlapping async actions, retries, cancellation, duplicate submissions, and
  deliberately varied completion order. In single-threaded JavaScript, test async interleavings;
  use workers only when the public contract exposes them.

## Execution and failure handling

- Run a small deterministic smoke set first, then broader loops with a stated iteration count.
- Fail on thrown exceptions, rejected promises, invariant violations, silent data loss, hangs,
  unexpected mutation, nondeterministic output, or incorrect error classification.
- Keep time and memory bounded. Stop a runaway test safely, preserve the seed and minimized input,
  and classify it as a failure rather than retrying until it disappears.
- Re-run every failure once from the printed seed and input. If it does not reproduce, classify the
  result as nondeterminism and investigate the uncontrolled source.

## Antirez report

Return a report in the response or at the repository's test-report location, using this structure:

```markdown
## Antirez Report: [module]

### Structural Tensions

- tension -> file:line

### Test File

- Path: path/to/test_file
- Iterations: N per fuzz loop
- Seed: [value]

### Results

| Category    | Count | Pass | Fail |
| ----------- | ----- | ---- | ---- |
| Boundary    |       |      |      |
| Fuzz        |       |      |      |
| Round-trip  |       |      |      |
| Corruption  |       |      |      |
| Stress      |       |      |      |
| Concurrency |       |      |      |

### Bugs Found

1. **[severity]** description — seed: X, input: Y -> file:line

### Recommendations

- what to fix and why
```

Do not call a run clean when categories were not applicable or not executed: mark them `N/A` or
`NOT RUN` with a reason. Separate confirmed bugs from hypotheses and include the exact reproduction
command for every confirmed failure.
