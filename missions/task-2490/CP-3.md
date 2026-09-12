# CP-3: Update live agent guidance; confirm no live doc instructs a separate `px handoff`

## Summary

Reviewed all three live guidance files named in the mission. Only `docs/agents.md`
contained an explicit `px handoff` command reference (the pre-review bounce
policy, TASK-1037): it named the retired `px handoff` command and its `--no-recover`
flag. Reworded that passage so the final-gate repair is attributed to
`px review <slug> --start` and the retired `--no-recover` command flag is gone.
`prompts/execute-core.md` and `prompts/review-core.md` use only the generic
"handoff" workflow / "artifact handoff" senses and never invoke the command, so
they are already compliant and left unchanged. A repo grep for `px handoff` /
`parallix handoff` across `prompts/` and `docs/` now returns no matches. Historical
mission records under `backlog/completed/`, `backlog/archive/`, and dated mission
directories were not touched (read-only restricted area).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 no live doc invokes `px handoff` separately | grep `px handoff`/`parallix handoff` over `prompts/`, `docs/` → 0 matches | PASS |
| SC4 bounce-policy doc re-attributed to `--start` | `docs/agents.md` "Pre-review bounce policy" section (was "`px handoff`", now `px review <slug> --start`) | PASS |
| SC4 historical records untouched | read-only area `backlog/completed/`, `backlog/archive/` (no write in scope) | PASS |
| Live-doc standard run | `./scripts/verify-local.sh docs` | PASS |

## Next action: CP-4 — run the full `./scripts/verify-local.sh all` gate, capture proof, and finalize.
