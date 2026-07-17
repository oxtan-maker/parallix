# CP-2: Add fail-closed reusable verification proofs

Implemented a versioned reusable-proof schema. Its identity hashes the exact verifier
command, a complete `git ls-files -s` tracked-input manifest (including production,
tests, package/build inputs, scripts, configuration, and generated tracked artifacts),
and Node/platform/architecture toolchain identity. Any dirty worktree, missing or
malformed proof, failed/interrupted execution (which writes no proof), unreadable
manifest, or mismatch fails closed. Proofs live under the established
`PARALLIX_HOME/verification-proofs` runtime-state location.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exact command, tracked inputs, and toolchain form the reusable identity | `lib/core/verification.ts:189`, "reusable verification proof reuses only the exact clean command, tracked inputs, and toolchain identity" | PASS |
| Dirty and malformed/missing proof states fail closed | `lib/core/verification.ts:196`, `lib/core/verification.ts:220`, "reusable verification proof reuses only the exact clean command, tracked inputs, and toolchain identity" | PASS |
| Production, tests, package/build, scripts, config, and generated files invalidate proof reuse | `lib/core/verification.ts:204`, "verification proof identity changes for tracked production, test, package, script, config, and generated inputs" | PASS |
| Runtime state uses the established Parallix home | `lib/core/verification.ts:215`, `lib/core/storage.ts:37` | PASS |

Next action: Wire the handoff final-gate result into declared-gate proof reuse, while retaining real execution whenever the declared command cannot validate a matching proof.
