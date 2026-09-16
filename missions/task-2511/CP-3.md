# CP 3 — ADR alignment and final evidence

Aligned the ADR 0053 documents with the rewritten decision and the proposal.

Work done:

- `docs/adr/0053-persistence-inventory.md`: replaced the superseded
  "Repository footprint boundary" statement (which retained committed mission
  contracts and checkpoint/review Markdown as steady state) with the current
  boundary — no Git-tracked workflow metadata during normal lifecycle
  execution, legacy files as one-way imports, verification proof as a migration
  target rather than permanent file state.
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md`: added the
  reusable verification proof to the authority table and a "Trust markers"
  subsection covering the proof, the checkpoint-evidence anchor that replaces
  the file-presence check (ADR 0048), and provider trust configuration, which
  stays with the provider. No implementation is claimed.
- Restored the ADR's stated exclusion of `Attempt` (dropped by the 2026-09-16
  ADR rewrite in commit `91aae5c49`) and re-named the checked domain types
  `KnownRepository`, `MissionOutcome`, and `LaneTransitionEvent` in the
  authority table, which repairs four unit tests that fail on the pre-mission
  baseline.
- Cross-checked the proposal against the inventory: every artifact row in the
  inventory has a target owner and wave in the proposal, and each trust marker
  appears in both.

## Gate result

`./scripts/verify-local.sh all` exits 1 on this tree. The unit suite itself is
clean (`tests 2630, pass 2630, fail 0`); the non-zero exit comes only from the
`[unit-test-budget:exceeded]` reporter, which flags production tests
(`github-publish: …`, `performStaticReview …`) that exceed the 1,000 ms per-test
cap by 50–800 ms under local load. This is pre-existing and unrelated to a
documentation-only change: the same run on the pre-mission baseline commit
`354056ed7` (temporary worktree, `npm test`) also reported
`[unit-test-budget:exceeded] github-publish: exact integration SHA preserved
through verification ref and publication: 1104ms > 1000ms`, plus 6 test failures
that this mission's ADR repair removed. Per the mission's fourth Stop Rule this
is reported rather than worked around; no production source or test was touched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory covers every scoped artifact with path pattern, writer, reader, purpose, classification, recommendation | `missions/task-2511/persistence-footprint-inventory.md`; footprint reproducible with `git ls-files -z -- 'missions/**' \| xargs -0 cat \| wc -c`; classifications reconciled with `test/fixtures/durable-state-inventory.ts` | Complete |
| SC2 trust marker and every migration candidate resolved with target owner, order, compatibility boundary, recovery consequence | `missions/task-2511/persistence-footprint-proposal.md` sections "Trust marker resolution" and "Per-artifact treatment"; marker behavior read from `src/adapters/verification/verification.ts` and `src/adapters/forgejo/forgejo-git.ts` | Complete |
| SC3 ADR documentation agrees with the proposal, preserves exclusions, claims no implementation | ADR 0053 sections "Authority boundaries", "Trust markers", "Excluded concepts"; `docs/adr/0053-persistence-inventory.md` "Repository footprint boundary"; verified by `npx tsx --test test/task-2322-persistence-adr.test.ts` (3 pass) and `test/domain-attempt-guard.test.ts` | Complete |
| SC4 discrete follow-up missions with scoped outcome and dependency order | `missions/task-2511/persistence-footprint-proposal.md` table PERSIST-1..PERSIST-6 | Complete |
| SC5 only proposal, ADR docs, checkpoints changed | `git diff --stat 354056ed7..HEAD` lists only `missions/task-2511/*` and `docs/adr/0053-*.md`; no source, test, schema, or historical mission file | Complete |
| SC6 gate passes on the final documentation tree | `./scripts/verify-local.sh all` exits 1 solely on `[unit-test-budget:exceeded]` timing of production tests; unit suite `fail 0`; same budget overrun reproduces on baseline `354056ed7` | Reported, not met — pre-existing environmental condition (Stop Rule 4) |

Next action: operator decision on the `[unit-test-budget:exceeded]` overruns in
`github-publish` and `performStaticReview` (a separate performance task, since
`performStaticReview` scans the repository whose footprint PERSIST-6 shrinks);
then start PERSIST-1, the `verification_proofs` trust-marker migration.
