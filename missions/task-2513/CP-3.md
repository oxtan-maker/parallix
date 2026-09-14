# Checkpoint 3 — Non-mutating compatibility, docs, and mission verification gate

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mutating launch selects Bubblewrap when available (SC 1) | `test/confinement.test.ts` "selectConfinement selects bubblewrap when available for a mutating launch"; `test/bubblewrap-guard.test.ts` "spawnAndTee preserves stdout and exit status through bwrap" | Pass |
| Bubblewrap-unavailable + native sandbox → native path (SC 2) | `test/confinement.test.ts` "supportsNativeSandbox reports true only for codex"; `test/confinement-launch.test.ts` "startAgent takes the native-sandbox path for codex when Bubblewrap is missing without consent" | Pass |
| Neither available → block until consent; both outcomes tested (SC 3) | `test/confinement.test.ts` "selectConfinement blocks when bwrap missing, no native sandbox, and no consent"; `test/confinement-launch.test.ts` "startAgent blocks a mutating launch when Bubblewrap is missing and no native sandbox exists" + "startAgent proceeds on explicit allowUnsandboxedMutation consent when Bubblewrap is missing" | Pass |
| Consent explicit, not implicit fallback/default (SC 4) | `test/confinement.test.ts` "selectConfinement allows unsandboxed execution only on explicit consent"; `allowUnsandboxedMutation` defaults `false` on `startAgent` | Pass |
| Non-mutating launch behavior unchanged (SC 5) | Gate skipped for non-`worktreeWritable` profiles; `test/confinement-launch.test.ts` "startAgent review launch is unaffected by the confinement gate when Bubblewrap is missing"; `test/agents.test.ts` 107 pass / 1 skip; full suite `test/domain-consumer-requirements.test.ts` 11 pass | Pass |
| Mission verification gate `./scripts/verify-local.sh all` | `./scripts/verify-local.sh all` → 2597 tests, 2597 pass, 0 fail, exit code 0 | Pass |

## Work done

**Non-mutating compatibility.** The `startAgent` gate is scoped to `sandboxProfile.worktreeWritable` (mutating). `review` and every read-only step bypass the gate and keep their exact prior confinement path. `test/confinement-launch.test.ts` asserts a `review` launch proceeds with `bwrap` missing and no consent. The pre-existing suite is unchanged: `test/agents.test.ts` 107 pass / 1 skip (monorepo-only gitignore assertion), and the full `./scripts/verify-local.sh all` run is 2597/2597 green.

**Docs.** `docs/agents.md` "Bubblewrap agent guard" updated to state the ordered unavailable-bwrap fallback (native sandbox → explicit consent → block) and that consent is never an implicit/default/env-only bypass. No other user-facing docs describe this behavior.

**Verification gate.** `./scripts/verify-local.sh all` passes (exit 0); `./scripts/verify-local.sh static-analysis` passed earlier (ESLint, tsc, test-hygiene, test typecheck). The `agents.ts` confinement insertion shifted consumer-citation lines; `consumer-domain-requirements.ts` refreshed and `test/domain-consumer-requirements.test.ts` green.

**Restricted-area compliance.** Existing host-level Bubblewrap confinement unchanged when available (SC 1 path untouched). No implicit/default/env/prompt bypass of consent added (`allowUnsandboxedMutation` defaults false; `PARALLIX_NO_BUBBLEWRAP` is a pre-existing explicit opt-out, preserved, not a new bypass). Scope not expanded to read-only policy. No claim that native sandboxing equals Bubblewrap (it is documented as a fallback defense).

## Next action
All checkpoints committed and the mission gate passes. Hand off for Parallix lifecycle (do not push origin, do not run `px review`/`px integrate`).
