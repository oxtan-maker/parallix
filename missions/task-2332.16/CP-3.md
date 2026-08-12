# CP-3 — Tell the truth in `src/adapters/README.md`

## Summary

Rewrote the three sections of `src/adapters/README.md` that claimed the tree is
guarded against adapter-owned workflow sequencing.

1. **Cross-adapter dependency constraints** — replaced the closing paragraph that
   said an adapter wiring `multiIntegrationFanOutThreshold` (3) or more distinct
   sibling packages "fails wherever it sits in the tree". It now says workflow
   sequencing remains an application responsibility but that **no guard enforces
   it**, and points at "Known outstanding debt".
2. **Enforced rules and the fixtures that prove they bite** — deleted the
   `adapter-owned-workflow-sequencing` table row, leaving exactly the four rules
   the `ResponsibilityRule` union declares. Replaced the sample diagnostic, which
   quoted a `rule adapter-owned-workflow-sequencing failed` line for
   `src/adapters/cli/commands/integrate.ts`, with a `cross-adapter-dependency-not-named`
   diagnostic matching the `detail` string `findCrossAdapterViolations` actually
   produces for the `alpha`/`beta` fixture.
3. **Known outstanding debt** — rewritten to state that multi-integration
   workflow sequencing under `src/adapters/` is unguarded, to name
   `src/adapters/cli/commands/` (with `integrate.ts` and `handoff.ts` at 9 sibling
   packages each) and the mechanism packages `git`, `forgejo`, `verification`,
   `agents`, to record that the count threshold was retired because a fan-out
   count cannot distinguish a mechanism from a workflow sequencer, to say why a
   threshold bump or allowlist would have been worse, and to attribute re-homing
   to **parent TASK-2332**. The paragraph also names the structural-invariant
   candidates a replacement rule could use.

No source file was edited in this checkpoint; the guard and its tests are
unchanged from CP-1.

`npx markdownlint-cli2 src/adapters/README.md` reports three pre-existing
findings (MD013 line-length, MD040 fenced-code-language) — the same classes that
the file already carried before this mission, verified by running the linter
against the stashed tree, which reported strictly more. Markdown linting is not
part of `package.json` scripts or `./scripts/verify-local.sh`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no reference to the retired rule remains anywhere in `src` or `test` | `git grep -n "multiIntegrationFanOutThreshold\|findWorkflowOwnershipViolations\|adapter-owned-workflow-sequencing" -- src test` exits 1 with no output; the four `src/adapters/README.md` matches recorded as PARTIAL in `missions/task-2332.16/CP-1.md` are now gone | PASS |
| SC7 — README carries no `multiIntegrationFanOutThreshold`, no `adapter-owned-workflow-sequencing` row, no "3+ siblings fails" claim | Same `git grep` above returns nothing for `src/adapters/README.md`; the enforced-rules table now lists exactly `unclassified-production-module`, `cross-adapter-dependency-not-named`, `hidden-service-location`, `complete-graph-outside-composition`, matching the `ResponsibilityRule` union in `src/adapters/architecture/boundary-guards.ts` | PASS |
| SC8 — "Known outstanding debt" names the unguarded path, the retirement reason, and the owner | `src/adapters/README.md` "Known outstanding debt" opens with "**Multi-integration workflow sequencing under `src/adapters/` is unguarded.**", names `src/adapters/cli/commands/` plus `git`, `forgejo`, `verification`, `agents`, states "a fan-out count cannot distinguish a mechanism from a workflow sequencer", and ends "**re-homing is tracked by parent TASK-2332**" | PASS |
| README enforced-rules table still matches reality | Every remaining row's named fixture was observed red under mutation in `missions/task-2332.16/CP-2.md`; all six fixtures pass in `npm test -- test/dependency-graph.test.ts` | PASS |
| Sample diagnostic in the README is a real guard output | The quoted line reproduces the `detail` template in `findCrossAdapterViolations` (`src/adapters/architecture/boundary-guards.ts`), asserted by `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` in `test/dependency-graph.test.ts` | PASS |
| Restricted areas respected | Only `src/adapters/README.md` changed in this checkpoint; `adapterPackageDependencies`, `docs/adr/`, `src/adapters/cli/commands/integrate.ts`, and `src/adapters/cli/commands/handoff.ts` are untouched — `git show --stat HEAD` after commit lists `src/adapters/README.md` and `missions/task-2332.16/CP-3.md` only | PASS |

Next action: CP-4 — run `./scripts/verify-local.sh all`, capture its summary
line, tick acceptance criteria #1–#7 in
`backlog/tasks/task-2332.16 - Replace-the-adapter-workflow-sequencing-fan-out-heuristic-with-an-enforceable-ownership-rule.md`,
and write the final Goal Check table covering SC1–SC10.
