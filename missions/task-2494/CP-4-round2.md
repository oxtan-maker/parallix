# CP-4-round2: eligibility policy key + no-replacement diagnostics (TASK-2494)

## Summary
Round 2 review (codex -> custom, REQUEST_CHANGES) returned two findings.

- F1: round-1 fix passed `'conflict-resolution'` to `selectAgent`, but
  `config/agents.json` defines only `draft`/`active`/`review`; an unknown key
  falls back to every workflow family, bypassing configured eligibility. Fixed
  by using policy key `active` (the key that owns implementation work).
- F2: `selectReplacementFamily` did not handle `selectAgent`'s documented
  no-candidate throw, so no-replacement states escaped the catch block and the
  SC2 reset-time diagnostic was never reached. Fixed with try/catch treating
  exhaustion/unavailability as no replacement, plus regression cases.

Changes:
- `src/application/rebase-workflow.ts`: selector call uses key `active`, wrapped
  in try/catch returning null on throw; updated doc comment.
- `src/application/ports/rebase-workflow.ts`: documented `active` policy key and
  the throw-as-no-replacement contract.
- `test/task-2494-repro.test.ts`: assert `active` key + `codex` exclusion; added
  "selector exhaustion emits diagnostic" and "selector returns a family with no
  working launcher emits diagnostic" cases.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1 uses configured eligibility policy key | `test/task-2494-repro.test.ts`, `"TASK-2494 repro: usage-blocked pinned implementer substitutes an eligible replacement family when policy permits"` + `"selector never returns the excluded pinned implementer"` assert `selectAgent` called with `active` key and `codex` excluded | PASS |
| F2 no-replacement states emit reset-time diagnostic, not throw | `test/task-2494-repro.test.ts`, `"selector exhaustion emits the reset-time diagnostic, not a throw"` + `"selector returns a family with no working launcher emits the diagnostic"` (assert usage block + reset time, no forgejo/infrastructure, exit nonzero) | PASS |
| No regression across suite | `./scripts/verify-local.sh all` — `tests 2497 / pass 2497 / fail 0`, gate exit 0 | PASS |
| SC5 ESLint + tsc clean | ESLint clean on `rebase-workflow.ts`, `ports/rebase-workflow.ts`, `test/task-2494-repro.test.ts`; `tsc --checkJs` clean | PASS |
| SC6 behavior change documented | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` already covers usage-block reset-time diagnostic + policy-gated substitution | PASS |

## Next action
Commit the round-2 fix and hand back to the active reviewer for the next formal decision.
