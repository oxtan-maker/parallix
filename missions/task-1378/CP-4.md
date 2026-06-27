# CP-4 — Conditional README update

## Summary

CP-4 is conditional: README is updated **only if a new use case earns a top-3 (Confirmed) ranking** in §2. Per CP-3's re-evaluation, none of UC-7 through UC-10 displaces UC-1/UC-2/UC-4 — the top-3 table is retained verbatim. Therefore **no README changes are required**, matching the mission's "Otherwise, no README changes" clause and Out-of-Scope ("Editing any files outside `docs/use-cases.md` and conditionally `README.md`").

`README.md` was left untouched.

## Goal Check

| Criterion | Status | Evidence |
|---|---|---|
| README updated iff new UC enters top-3 | Met (no-op) | §2 re-evaluation `docs/use-cases.md:100` — top-3 unchanged (UC-1/UC-2/UC-4); README correctly not modified |
| README.md unchanged | Confirmed | No edit issued to `README.md` this mission; `git status` shows only `docs/use-cases.md` + mission docs |

Next action: Run CP-5 verification — `./scripts/verify-local.sh docs` gate, `npm test`, placeholder/reference checks, then commit and prepare handoff.
