# Project Definition-of-Done defaults — companion note (TASK-1357)

This note accompanies the project-wide Definition-of-Done (DoD) defaults committed
via `definition_of_done_defaults_upsert`. It records, for each default item,
whether it is **gate-enforced** (an enforcement tool exists and runs today) or
**manual-checklist** (verifiable by agent/human review today; a dedicated
enforcement gate is in-flight or absent). Per-task DoD additions
(`definitionOfDoneAdd`) remain mission-specific and are intentionally NOT part of
these defaults.

## The committed defaults

| # | DoD default item | Status | Enforcement basis |
|---|------------------|--------|-------------------|
| 1 | Verification gate ran and passed on the final tree with captured proof rather than an unverified claim | **gate-enforced** | `scripts/verify-local.sh` is the live verification gate (mission Gate `./scripts/verify-local.sh docs`). TASK-1268 hardens it further. |
| 2 | Lint and static analysis report clean on every changed file | **manual-checklist** | No wired lint/static-analysis gate yet (`sonarqube-scanner` devDep is unwired). Becomes gate-enforced when **TASK-1353** lands. |
| 3 | No focused or unannotated skipped tests were introduced (no .only and no bare .skip) | **manual-checklist** | No automated `.only`/`.skip` check yet. Becomes gate-enforced when **TASK-1353** lands. |
| 4 | Final checkpoint Goal Check table cites real evidence using file:line references and test names | **manual-checklist** | Enforced in the execute-prompt/handoff gate; promoted here as a board-side manual check. |
| 5 | Docs updated to reflect any workflow or user-facing behavior change | **manual-checklist** | Verifiable by review; no automated enforcement planned. |
| 6 | Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after | **manual-checklist** | Verifiable by review today. Becomes gate-enforced when **TASK-1354** lands. |

Summary: **1 gate-enforced**, **5 manual-checklist** (satisfies the "at least one
of each" requirement).

## Why these and only these

- **Minimal & universal**: all six apply to every mission regardless of domain.
  Mission-specific quality bars stay in per-task DoD (`definitionOfDoneAdd`), not
  in these defaults.
- **Verifiable today**: every item is checkable now (by gate or by review). None
  is phrased as a future-state aspiration, so the DoD never becomes an
  unverifiable wishlist.
- **Sequenced for gate activation**: items 2/3/6 are labeled manual-checklist
  today and should be re-labeled gate-enforced (no wording change needed) once
  TASK-1353 / TASK-1354 land. The item text is already gate-agnostic.

## Maintenance

When TASK-1353 or TASK-1354 land, update only the **Status** column of this note
(2/3 → gate-enforced; 6 → gate-enforced). The committed default strings do not
need to change because they are phrased to be true under either enforcement mode.
