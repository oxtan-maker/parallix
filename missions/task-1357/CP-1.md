# CP-1 — Classification complete

## Summary

Audited the current Definition-of-Done (DoD) default state and classified every
proposed DoD item as **gate-enforced**, **manual-checklist**, or **deferred**,
grounded in the enforcement that actually exists in this repo today (not in the
optimistic assumption that the in-flight gates have already landed).

### Audit findings (current state)

- `definition_of_done_defaults_get` → `(none)` — confirmed **zero** DoD defaults.
- `backlog/config.yml` → `definition_of_done: []` (no-op default, by design).
- Enforcement actually live today:
  - **Verification gate**: `scripts/verify-local.sh` exists and is wired as the
    mission Gate (`./scripts/verify-local.sh docs`). → enforcement tool exists.
  - **Lint / static analysis**: NOT wired. `package.json` lists
    `sonarqube-scanner` as a devDependency but there is no lint script, no
    static-analysis config, and no CI workflow invoking it. This is TASK-1353
    work, still in-flight. → no enforcement tool yet.
  - **No focused/skipped tests check**: NOT automated. No script greps for
    `.only` / bare `.skip`. TASK-1353 scope. → no enforcement tool yet.
  - **Goal Check evidence table**: enforced in the execute-prompt / handoff gate
    (validator regex `^## Goal Check(?: Table)?\s*$`) but not as a board-side
    DoD. → manual board-side checklist.
  - **Docs-updated-on-behavior-change**: appears ad hoc on prior tasks
    (TASK-1281/1306); no automated enforcement. → manual checklist.
  - **Bug reproduction test**: TASK-1354 work, in-flight. → no enforcement tool
    yet.

### Classification of proposed items

| # | Proposed item | Classification | Basis |
|---|---------------|----------------|-------|
| 1 | Verification gate ran and passed on final tree (proof-backed) | **gate-enforced** | `scripts/verify-local.sh` live today (TASK-1268 gate present) |
| 2 | Lint / static analysis clean on changed files | **manual-checklist** | TASK-1353 gate in-flight; no wired tool today |
| 3 | No `.only` / unannotated `.skip` tests introduced | **manual-checklist** | TASK-1353 gate in-flight; no automated check today |
| 4 | Final Goal Check table cites real evidence (file:line, test names) | **manual-checklist** | Enforced in execute-prompt only; promote to DoD as manual board-side check |
| 5 | Docs updated when workflow behavior changes | **manual-checklist** | No automated enforcement; verifiable by review |
| 6 | Bug-labeled missions: red→green reproduction test | **manual-checklist** | TASK-1354 gate in-flight; verifiable by review today |

No items are **deferred**: per the mission Risk mitigation ("classify dependent
items as manual-checklist; revisit when gates land"), items 2/3/6 are kept as
manual-checklist (actionable today by human/agent review) rather than dropped or
phrased as future aspirations. This keeps the set verifiable today and satisfies
SC6 (no aspirational phrasing).

### Final candidate set (6 items, comma-free, actionable today)

1. `Verification gate ran and passed on the final tree with captured proof rather than an unverified claim` — gate-enforced
2. `Lint and static analysis report clean on every changed file` — manual-checklist
3. `No focused or unannotated skipped tests were introduced (no .only and no bare .skip)` — manual-checklist
4. `Final checkpoint Goal Check table cites real evidence using file:line references and test names` — manual-checklist
5. `Docs updated to reflect any workflow or user-facing behavior change` — manual-checklist
6. `Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after` — manual-checklist

Set size = 6 (within SC2 4–8). At least one gate-enforced (item 1) and multiple
manual-checklist (items 2–6) → satisfies SC4. No commas in any item → satisfies
SC3. No aspirational words ("when built" / "once gate lands" / "pending") in any
item → satisfies SC6.

## Goal Check

| Checkpoint goal | Evidence | Status |
|-----------------|----------|--------|
| Confirm zero DoD defaults | `definition_of_done_defaults_get` → `(none)`; `backlog/config.yml:5` `definition_of_done: []` | ✅ |
| Each proposed item classified with rationale | Classification table above (6 items, all tagged) | ✅ |
| Classification grounded in real enforcement | `scripts/verify-local.sh:11-33` (live gate); `package.json` has `sonarqube-scanner` devDep but no lint script (TASK-1353 in-flight) | ✅ |
| ≥1 gate-enforced and ≥1 manual-checklist identified | Item 1 gate-enforced; items 2–6 manual-checklist | ✅ |
| No deferred items left aspirational | Dependent items (2/3/6) phrased as actionable manual-checklist, no future-state wording | ✅ |

Next action: Produce the companion gate-enforced-vs-manual-checklist note and record async team review of this classified set as CP-2, applying the mission Stop Rules (≤8 items, drop any item with a blocking applicability concern).
