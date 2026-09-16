# CP 1 — Artifact and trust-marker inventory

Rebuilt `missions/task-2511/persistence-footprint-inventory.md` against the
current ADR 0053 (rewritten in commit `91aae5c49`, which rejects routinely
materialized projections). The previous revision of the inventory predated that
rewrite and recommended retaining committed mission Markdown as steady state.

Work done:

- Measured the tracked footprint with `git ls-files` (65% of tracked files and
  39% of tracked bytes are under `missions/`; checkpoints alone are 5.4 MB).
- Inventoried every scoped artifact with writer, reader, purpose, ADR 0053
  classification, and keep/move/export/remove recommendation.
- Resolved four trust markers and named the operational one: the reusable
  verification proof at `<PARALLIX_HOME>/verification-proofs/<identity>.json`,
  plus the handoff file-presence marker that forces the repository footprint.
- Recorded four unresolved ownership questions for CP 2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory covers every scoped artifact with path pattern, writer, reader, purpose, classification, recommendation | `missions/task-2511/persistence-footprint-inventory.md`; classifications reconciled with `test/fixtures/durable-state-inventory.ts` and ADR 0053 | Complete |
| SC2 trust marker and migration candidates resolved | Inventory section "Trust markers": `src/adapters/verification/verification.ts` (`writeReusableVerificationProof`), `src/adapters/forgejo/forgejo-git.ts` (`syncPrimaryBaseline`), `src/adapters/sqlite/session-marker-import.ts` | In progress — proposal is CP 2 |
| SC3 ADR agreement | ADR 0053; `docs/adr/0053-persistence-inventory.md` "Repository footprint boundary" paragraph is stale and scheduled for CP 3 | In progress — ADR update is CP 3 |
| SC4 follow-up missions | `missions/task-2511/persistence-footprint-proposal.md` | In progress — proposal is CP 2 |
| SC5 only investigation files change | `git show --stat HEAD` for this checkpoint's commit lists only `missions/task-2511/` files | Complete to this checkpoint |
| SC6 gate passes on final tree | `./scripts/verify-local.sh all` | Pending final gate (CP 3) |

Next action: rewrite `missions/task-2511/persistence-footprint-proposal.md` so
the verification proof, mission contract fields, checkpoint evidence, and review
events move to the database with migration order, compatibility-removal
conditions, and the handoff trust-marker re-anchoring as an explicit dependency.
