# CP-4 — Final gate

## Summary

Ran the mission's two declared gates on the final tree, ticked the acceptance
criteria in the backlog task, and produced the Goal Check table covering SC1–SC10.

**Gate 1 — `npm test -- test/dependency-graph.test.ts`**: exit 0,
`tests 28 / suites 0 / pass 28 / fail 0 / cancelled 0 / skipped 0 / todo 0`.

**Gate 2 — `./scripts/verify-local.sh all`**: exit 0. Summary line from the
latest run, after the round-1 review fixes below:

```
ℹ tests 2112
ℹ suites 80
ℹ pass 2112
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 57760.734905
```

The run also emitted `PASS: authored documentation contains no volatile
implementation evidence and relative links resolve` from
`node scripts/verify-docs.mjs`, which `gate_all` runs before `npm test`. The
`[FAIL]` lines in the log body are asserted fixture output from the coverage-gate
and hook-retry suites, not gate failures — the script exits 0.

Additionally ran `./scripts/verify-local.sh static-analysis` (not a declared gate,
but required by Definition of Done #2): exit 0, with `PASS: ESLint clean`,
`PASS: tsc typecheck clean`, `PASS: test-hygiene clean`, `PASS: test typecheck
clean` and `=== Static Analysis Gate: ALL STAGES PASSED ===`.

Ticked acceptance criteria #1–#7 and Definition of Done #1–#5 in
`backlog/tasks/task-2332.16 - Replace-the-adapter-workflow-sequencing-fan-out-heuristic-with-an-enforceable-ownership-rule.md`.
AC #2 and #3 are conditioned on "if the rule is retained"; the rule was removed,
and both criteria's unconditional clauses hold anyway —
`multiIntegrationFanOutThreshold` no longer exists, and no allowlist, grandfather
list, or path exemption was introduced. DoD #6 is left unticked: the mission's
labels are `architecture`, `cleanup`, `user_value`, not `bug`, so the
red-to-green reproduction requirement does not apply.

The `./scripts/verify-local.sh all` run above was executed after the backlog
checkbox edit. Only this checkpoint document was written afterwards; it lives
under `missions/`, which no gate scans.

## Review round 1 (codex, REQUEST_CHANGES) — both findings fixed

**Finding 1 (P1) — README opening claimed enforcement the mission removes.**
The intro paragraph of `src/adapters/README.md` said a module moved or renamed
into `src/adapters/` "still fails if it owns another layer's responsibility",
which is no longer true for workflow sequencing. Rewritten: the intro now
enumerates the four things the guards actually check — canonical-root
classification, named cross-adapter imports, no dynamic-key collaborator lookup,
no complete-graph assembly — and then states explicitly that they are **not** a
general test of layer responsibility, that an adapter sequencing a
multi-integration workflow is caught by none of them, and points at "Known
outstanding debt". The four checks named in the intro match the
`ResponsibilityRule` union in `src/adapters/architecture/boundary-guards.ts` and
the enforced-rules table one-for-one.

**Finding 2 (P2) — unrelated lockfile mutation.** The `package-lock.json` hunk
changing the nested `@earendil-works/pi-ai` bin path from `dist/cli.js` to
`./dist/cli.js`, captured by the execute-agent commit, was reverted with
`git checkout main -- package-lock.json`. `git diff main...HEAD -- package-lock.json`
is now empty, so the lockfile is byte-identical to `main`.

Both declared gates were re-run after these fixes and are recorded above.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no reference to the retired rule remains in `src` or `test` | `git grep -n "multiIntegrationFanOutThreshold\|findWorkflowOwnershipViolations\|adapter-owned-workflow-sequencing" -- src test` exits 1 with no output, covering `src/adapters/architecture/boundary-guards.ts`, `test/dependency-graph.test.ts`, and `src/adapters/README.md` | PASS |
| SC2 — `ResponsibilityRule` declares exactly four members | The union in `src/adapters/architecture/boundary-guards.ts` lists `'unclassified-production-module'`, `'cross-adapter-dependency-not-named'`, `'hidden-service-location'`, `'complete-graph-outside-composition'`; `./scripts/verify-local.sh static-analysis` reports `PASS: tsc typecheck clean`, so no exhaustiveness consumer broke | PASS |
| SC3 — no skipped or focused tests; suite green with zero skips | `git grep -n "\.only\|test\.skip\|describe\.skip\|it\.skip" -- test/dependency-graph.test.ts` returns no lines; `npm test -- test/dependency-graph.test.ts` reports `tests 28 / pass 28 / fail 0 / skipped 0 / todo 0` | PASS |
| SC4 — the three production-tree assertions survive and pass | `"production tree has no unnamed cross-adapter dependency"`, `"production tree has no hidden service location"`, and `"production tree has no unclassified module"` all green in `npm test -- test/dependency-graph.test.ts`; all three are also present in the `./scripts/verify-local.sh all` log | PASS |
| SC5 — the six named fixtures survive and pass | `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"cross-adapter rules name every adapter package and grant no wildcard"`, `"responsibility guard fails hidden service location in an adapter module"`, `"responsibility guard fails complete-graph construction outside the composition root"` — all in `test/dependency-graph.test.ts`, all green | PASS |
| SC6 — mutation check recorded per retained rule | Each mutation was observed with `npm test -- test/dependency-graph.test.ts`, and the fixtures that went red are the named tests in `test/dependency-graph.test.ts` listed in the SC5 row; `missions/task-2332.16/CP-2.md` "Mutation log" records four mutations of `src/adapters/architecture/boundary-guards.ts`, each with the rule mutated, the fixture that turned red, and the quoted `AssertionError` (`expected: [ 'src/stray.ts' ]`; `expected: [ [ 'src/adapters/alpha/source.ts', 'cross-adapter-dependency-not-named', 'application' ] ]`; `expected: [ [ 'src/adapters/git/locator.ts', 'hidden-service-location', 'composition', 'adapters' ] ]`; `expected: [ [ 'src/adapters/mission/sneaky-root.ts', 'complete-graph-outside-composition', 'composition' ] ]`), each reverted with `git checkout --` | PASS |
| SC7 — README carries no threshold, no retired rule row, no "3+ siblings fails" claim | `git grep -n "multiIntegrationFanOutThreshold\|adapter-owned-workflow-sequencing" -- src/adapters/README.md` returns no lines; the enforced-rules table in `src/adapters/README.md` lists exactly the four members of the `ResponsibilityRule` union in `src/adapters/architecture/boundary-guards.ts`, and its sample diagnostic reproduces the `detail` template asserted by `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` in `test/dependency-graph.test.ts` | PASS |
| SC8 — "Known outstanding debt" names the gap, the reason, and the owner | `git grep -n "is unguarded\|src/adapters/cli/commands/\|cannot distinguish a mechanism from a workflow sequencer\|parent TASK-2332" -- src/adapters/README.md` returns all four required statements from the "Known outstanding debt" section of `src/adapters/README.md`; the layer model that section refers back to is `ADR 0051`, and the unguarded modules it names, `src/adapters/cli/commands/integrate.ts` and `src/adapters/cli/commands/handoff.ts`, both exist in the tree | PASS |
| SC9 — no allowlist, exemption, or skip introduced | `git grep -n "\.only\|test\.skip\|describe\.skip\|it\.skip" -- test/dependency-graph.test.ts` is empty; the only allowlist in `src/adapters/architecture/boundary-guards.ts` is the pre-existing `LegacyDependencyException[]` parameter of `findDependencyViolations`, unchanged and exercised by `"dependency graph honors an explicitly owned legacy exception"`; `./scripts/verify-local.sh static-analysis` reports `PASS: test-hygiene clean` | PASS |
| SC10 — verification gate passes on the final tree with its summary captured | `./scripts/verify-local.sh all` exits 0; summary `ℹ tests 2112 / suites 80 / pass 2112 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 57760.734905`, preceded by `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |
| Restricted areas respected | `git diff --stat main...HEAD` lists exactly three code/doc files this mission changed — `src/adapters/architecture/boundary-guards.ts`, `src/adapters/README.md`, `test/dependency-graph.test.ts` — plus the backlog task file, `missions/task-2332.16/MISSION.md`, and `missions/task-2332.16/CP-1.md` … `CP-4.md`; `git diff main...HEAD -- docs/adr/ src/adapters/cli/commands/ missions/task-2332.08/ package-lock.json` is empty, and `adapterPackageDependencies` is byte-identical in `git diff main...HEAD -- src/adapters/architecture/boundary-guards.ts` | PASS |
| Acceptance criteria ticked | `git grep -c "^- \[x\]" -- "backlog/tasks/task-2332.16*"` returns 12, the AC #1–#7 and DoD #1–#5 boxes in `backlog/tasks/task-2332.16 - Replace-the-adapter-workflow-sequencing-fan-out-heuristic-with-an-enforceable-ownership-rule.md`; DoD #6 left unchecked because the task's labels are `architecture`, `cleanup`, `user_value` — no `bug` label | PASS |

Next action: hand off for review — all four checkpoints are committed on
`mission/task-2332.16` and both declared gates
(`npm test -- test/dependency-graph.test.ts`, `./scripts/verify-local.sh all`)
exit 0 on the final tree. A follow-up under parent TASK-2332 must re-home
`src/adapters/cli/commands/integrate.ts` and `handoff.ts` into
`src/application/` before a structural ownership invariant can replace the
retired count heuristic.
