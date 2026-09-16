# CP 2 — Migration proposal

Rewrote `missions/task-2511/persistence-footprint-proposal.md` to match the
current ADR 0053. The previous revision proposed retaining committed mission
Markdown as steady-state audit exports; this revision moves the verification
proof, bounded mission-contract fields, checkpoint evidence, and review-event
export into `<PARALLIX_HOME>/parallix.db` and stops materializing them during
normal lifecycle execution.

Work done:

- Resolved all four trust markers with target authority and rationale, naming
  the handoff file-presence marker as the blocking prerequisite: handoff today
  auto-generates and commits `CP-1.md`, so no writer can be removed first.
- Gave every artifact a target owner, wave, compatibility/deletion boundary, and
  backup/recovery consequence; artifacts staying outside carry their rationale.
- Defined four validation-gated waves and a retention policy that distinguishes
  regenerable markers (no export needed) from evidence (export on demand).
- Recorded six ordered follow-up missions, PERSIST-1 through PERSIST-6.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory covers every scoped artifact | `missions/task-2511/persistence-footprint-inventory.md`; `test/fixtures/durable-state-inventory.ts` | Complete |
| SC2 trust marker and every migration candidate resolved with owner, order, boundary, recovery consequence | `missions/task-2511/persistence-footprint-proposal.md` sections "Trust marker resolution" and "Per-artifact treatment"; `src/adapters/verification/verification.ts`, `src/adapters/forgejo/forgejo-git.ts` | Complete |
| SC3 ADR agreement | ADR 0053; `docs/adr/0053-persistence-inventory.md` "Repository footprint boundary" still states the superseded retention position | In progress — ADR update is CP 3 |
| SC4 follow-up missions with scoped outcome and dependency order | `missions/task-2511/persistence-footprint-proposal.md` table PERSIST-1..PERSIST-6 | Complete |
| SC5 only investigation files change | `git show --stat HEAD` for this checkpoint's commit lists only `missions/task-2511/` files | Complete to this checkpoint |
| SC6 gate passes on final tree | `./scripts/verify-local.sh all` | Pending final gate (CP 3) |

Next action: update `docs/adr/0053-persistence-inventory.md` (and ADR 0053 if a
new durable decision is established) so the documented repository-footprint
boundary matches this proposal, then run `./scripts/verify-local.sh all`.
