# CP-4: Verify review-round ownership and retained gates

The unchanged review-round path now has one real execution for an exact matching
configured/declared general plan, followed by a proof-validated reuse at the declared
boundary. Proof publication is bound to the pre-execution identity, so an input change
while a gate runs leaves no reusable proof. The pre-review lifecycle gate, static
analysis, and integration-only gates remain separately owned: this proof is only
consulted by the matching declared general-gate command.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unchanged commit-equivalent configured and declared plans execute at most once | `lib/commands/handoff.ts:354`, `lib/commands/handoff.ts:900`, "task-2273 review submission runs the handoff plan once and reuses it at the declared boundary" | PASS |
| Proof identity invalidates changed tracked inputs and toolchain/command changes | `lib/core/verification.ts:189`, "verification proof identity changes for tracked production, test, package, script, config, and generated inputs", "reusable proof refuses to publish when inputs changed during gate execution" | PASS |
| Missing, malformed, dirty, and mismatch states fail closed | `lib/core/verification.ts:196`, `lib/core/verification.ts:220`, "reusable verification proof reuses only the exact clean command, tracked inputs, and toolchain identity" | PASS |
| Deterministic lifecycle review gate remains separately owned | `lib/review/review-loop.ts:269`, `lib/review/review-loop.ts:1125`, "startReviewLoop runs the pre-review gate before every reviewer round" | PASS |
| Static analysis and integration-only gates remain separately owned | `scripts/verify-local.sh:33`, `config/integration-pipelines.json:4`, `lib/commands/integrate.ts:542` | PASS |
| Mission-declared final verifier completed | `./scripts/verify-local.sh all` | PASS |
| Required static-analysis gate completed for `lib/` changes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Commit this verification evidence, then run `px review task-2273 --continue` so the review loop re-launches the implementer and obtains a fresh disposition before starting the next reviewer round.
