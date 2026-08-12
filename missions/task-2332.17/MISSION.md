# Mission: Retire the adapterPackageDependencies ratchet in favour of application-owned ports (task-2332.17)

## Goal
Narrow `adapterPackageDependencies` in `src/adapters/architecture/boundary-guards.ts` from a ratchet (transcribed existing edges) to an enforced design (only host-mechanism edges). Cross-adapter edges that carry behaviour are replaced by application-owned ports under `src/application/ports/`, implemented by adapters and wired in `src/composition/`. No adapter names more than half its sibling packages (≤7 of 15).

## Why Now
TASK-2332.08 replaced the blanket adapters-to-adapters edge with `adapterPackageDependencies`, closing the "any adapter may reach any adapter" hole. TASK-2332.16 resolved workflow-ownership decisions that determine which cross-adapter edges are mechanism vs. workflow sequencing. The table still certifies nothing about correctness — it only blocks new unnamed edges. The widest entries (`cli` at 13, `rebase` and `review` at 9) are concrete symptoms of adapters calling adapters directly where ADR 0051 intends ports. This task narrows the table toward the intended shape before new edges accumulate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate after TASK-2332.16 lands
- Main drivers: (1) `adapterPackageDependencies` table narrowing — remove behaviour edges, annotate mechanism edges; (2) new or updated ports under `src/application/ports/` for behaviour edges; (3) wiring in `src/composition/`; (4) `src/adapters/README.md` update to retire ratchet framing; (5) test import-path adjustments only

## Scope
- Audit every entry in `adapterPackageDependencies` and classify as host-mechanism or behaviour
- Record classification justification inline (comment next to each entry)
- For behaviour edges: introduce or route through application-owned port in `src/application/ports/`
- Adapter implements the port; `src/composition/` wires it into the use case
- Reduce widest entries: `cli` (13), `rebase` (9), `review` (9), `agents` (8) — all must land ≤7
- Update `src/adapters/README.md` to describe table as enforced design, remove ratchet framing
- Update `test/dependency-graph.test.ts` only where import paths move (no new test logic required)

## Out of Scope
- Product-facing CLI behaviour changes — command output, exit codes, and user-visible workflows unchanged
- Workflow sequencing re-homing of adapter modules into `src/application/` (tracked by parent TASK-2332)
- Adding new enforced rules to the responsibility guard (e.g. fan-out count threshold)
- `allowedDependencyGraph` layer-level edges (unchanged)
- TASK-2332.16 deliverables (dependency, not re-implementation)

## Success Criteria
- SC1: Every remaining entry in `adapterPackageDependencies` has an inline comment justifying it as a host `mechanism`; no behaviour entries or unannotated entries remain
- SC2: No adapter package names more than 7 sibling packages (half of 15 siblings, rounded down). Specifically: `cli` ≤7, `rebase` ≤7, `review` ≤7, `agents` ≤7
- SC3: Every behaviour edge is removed from `adapterPackageDependencies` and replaced by a port interface in `src/application/ports/` with a concrete adapter implementation and composition wiring in `src/composition/`
- SC4: `src/adapters/README.md` no longer describes `adapterPackageDependencies` as a "ratchet"; it describes the table as the enforced design
- SC5: `npm test -- test/dependency-graph.test.ts` passes — all existing tests green, including production tree scan (`findProductionDependencyViolations` returns `[]`)
- SC6: Cross-adapter guard still rejects a fixture edge matching no named rule, and diagnostic still names the offending file and the port remedy (verified by existing test `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`)
- SC7: `./scripts/verify-local.sh all` passes on the final tree
- SC8: `./scripts/verify-local.sh static-analysis` passes on the final tree
- SC9: `./scripts/verify-local.sh integrate` passes on the final tree

## Risks and Assumptions
- TASK-2332.16 has landed; its workflow-ownership decisions determine which edges are mechanism vs. workflow. If TASK-2332.16 is not merged, classification is ambiguous — block on it.
- Port introduction may require constructor signature changes in use cases that consume those ports. Scope is limited to `src/application/`, `src/adapters/`, and `src/composition/` — no `src/interfaces/` or `src/entry/` changes expected.
- Existing ports (`rebase-workflow.ts`, `review-workflow.ts`, `cli-workflows.ts`, `handoff-workflow.ts`) may already cover some behaviour edges. Audit reuses existing ports before creating new ones.
- The `cli` adapter (13 siblings) is the widest. Many of its edges are likely mechanism (config, filesystem, git, process) and only a subset are behaviour. Classification must distinguish carefully.
- Line-number references in tests may shift. Test names and file paths are the durable evidence.

## Checkpoints
- CP 1: Audit `adapterPackageDependencies` — classify every edge as mechanism or behaviour. Record inline comments. Identify edges to remove vs. keep.
- CP 2: For each behaviour edge to remove, confirm existing port covers it or create new port in `src/application/ports/`. Implement adapter side and wire in `src/composition/`. Run `npm test -- test/dependency-graph.test.ts` after each port to catch import-path breakage early.
- CP 3: Remove behaviour edges from `adapterPackageDependencies`. Verify widest entries: `cli` ≤7, `rebase` ≤7, `review` ≤7, `agents` ≤7. Run full production scan.
- CP 4: Update `src/adapters/README.md` — retire ratchet framing, describe table as enforced design. Run `./scripts/verify-local.sh docs`.
- CP 5: Final gates — `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh integrate`. Goal Check table with real evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/dependency-graph.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` (must match a test name in `test/dependency-graph.test.ts`)
  3. **Test file paths** — e.g., `test/dependency-graph.test.ts`
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Prose alone is not enough — e.g., "the table was updated" without citing the test name or command that verifies it is insufficient.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| All edges classified | `src/adapters/architecture/boundary-guards.ts`, inline comments on `adapterPackageDependencies` entries | PASS |
| `cli` ≤7 siblings | `adapterPackageDependencies.cli.length === 6` | PASS |
| Cross-adapter guard still bites | `npm test -- test/dependency-graph.test.ts`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` | PASS |
| README ratchet framing retired | `src/adapters/README.md`, `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] `./scripts/verify-local.sh all`
- [x] `./scripts/verify-local.sh static-analysis`
- [x] `./scripts/verify-local.sh integrate`

## Restricted Areas
- `src/interfaces/` — no changes; request translation and rendering not in scope
- `src/entry/` — no changes; process entry points not in scope
- `src/domain/` — no changes; business rules unchanged
- `test/` files other than `test/dependency-graph.test.ts` — no changes; import-path adjustments only in that file
- `adapterPackageDependencies` entries classified as mechanism — must remain; do not remove mechanism edges

## Stop Rules
- Stop if TASK-2332.16 is not merged — workflow-ownership classification depends on it
- Stop if `findProductionDependencyViolations(process.cwd())` returns non-empty after changes — fix root cause before continuing
- Stop if a port introduction requires changes in `src/interfaces/` or `src/entry/` — re-scope the port boundary
- Stop if `npm test -- test/dependency-graph.test.ts` has any failing test after a checkpoint — fix before next checkpoint
