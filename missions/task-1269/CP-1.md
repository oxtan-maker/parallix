# CP-1: Research and POC — StrykerJS with Node's built-in test runner

## Summary

Verified that StrykerJS (`@stryker-mutator/core@9.6.1`) can drive Node's built-in
`node --test` runner via Stryker's built-in **`command` test runner plugin**
(there is no dedicated `@stryker-mutator/node-test-runner` plugin — Stryker does not
publish one, confirmed via `npm view @stryker-mutator/node-test-runner` → 404). The
`command` runner treats the configured shell command's exit code as pass/fail across
the whole mutant run, which is exactly what `node --test <file>` gives us (exit 0 = all
tests passed, non-zero = at least one failure), so it works out of the box with zero
custom Stryker plugin code.

POC steps performed in an isolated scratch dir (`/tmp/stryker-poc`, not committed):

1. `npm install @stryker-mutator/core` (163 packages, ~6s, no compatibility errors on
   Node 20+).
2. Wrote a two-function-file fixture (`simple.js` / `simple.test.js`) using
   `node:test` + `node:assert`.
3. Minimal `stryker.conf.json`:

```json
{
  "packageManager": "npm",
  "mutate": ["simple.js"],
  "testRunner": "command",
  "commandRunner": {
    "command": "node --test simple.test.js"
  },
  "reporters": ["clear-text", "json"],
  "coverageAnalysis": "off",
  "concurrency": 2
}
```

   `coverageAnalysis: "off"` is required because the `command` runner has no
   in-process coverage-perTest hook — each mutant re-runs the full command. This is
   slower per-mutant than Stryker's `mocha`/`jest` plugins but is the correct/only
   option available for `node --test` today and is acceptable at mission-diff scale
   (single-digit files, not full-repo).

4. **Passing case** (strong test asserting `add(2,3) === 5`): `npx stryker run` →
   `3/3 mutants killed`, mutation score `100.00`.
5. **Failing/surviving case** (weakened test asserting only `typeof add === 'function'`,
   i.e. the "shallow reproduction test" pattern this mission exists to catch):
   `npx stryker run` → `1 killed / 2 survived`, mutation score `33.33`. Stryker printed
   the two surviving mutants directly (`BlockStatement` → empty function body,
   `ArithmeticOperator` → `a - b`), demonstrating the exact "AI-generated shallow test"
   failure mode cited in the mission's Why Now section.
6. Inspected `reports/mutation/mutation.json`: Stryker emits a `files.<path>.mutants[]`
   array with `status` (`Killed`/`Survived`/`NoCoverage`/`Timeout`/etc.) per mutant.
   This is what `lib/commands/mutation-gate.ts` (CP-3) will parse to compute a
   per-file score of `killed / (killed + survived + timeout)`.

## Pivot decision

No pivot needed. StrykerJS's `command` test runner is compatible with
`node --test` and requires no compiler/toolchain beyond what's already installed.
Going forward, `mutation-gate.ts` will:
- shell out to `npx stryker run` with a generated per-run `stryker.conf.json` whose
  `mutate` array is the diff-scoped file set from CP-2, and whose `commandRunner.command`
  runs `node --test` against the relevant `test/*.test.js` files, `coverageAnalysis: "off"`.
- parse `reports/mutation/mutation.json` for per-file scores.

## Goal Check

| Success criterion | Evidence |
|---|---|
| StrykerJS installable and runnable against a `lib/`-shaped Node file | `/tmp/stryker-poc` POC run, `@stryker-mutator/core@9.6.1` installed cleanly, `npx stryker run` exit 0 |
| Passing case works | POC run 1: mutation score 100.00 (3/3 killed) |
| Failing/surviving-mutant case works | POC run 2: mutation score 33.33 (1 killed / 2 survived), mutants printed: `BlockStatement`, `ArithmeticOperator` |
| Compatible with `node --test` (no dedicated plugin needed) | `stryker.conf.json` `testRunner: "command"` + `commandRunner.command: "node --test simple.test.js"`, confirmed no `@stryker-mutator/node-test-runner` package exists (npm 404) |
| Report format usable for ratchet scoring | `reports/mutation/mutation.json` → `files.<path>.mutants[].status`, per-file breakdown confirmed in clear-text reporter table |

Next action: Implement the diff-scoped file resolver (`lib/core/mutation-scoper.ts`,
CP-2) that computes changed files against the base branch and resolves their direct
callees, so CP-3's `mutation-gate.ts` has a concrete target file list to feed into the
`stryker.conf.json` `mutate` array proven here.
