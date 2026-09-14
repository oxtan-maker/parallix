# Checkpoint 2 — Confinement-selection + explicit-consent policy and focused tests

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mutating launch selects Bubblewrap when available (SC 1) | `selectConfinement` returns `'bubblewrap'` when `bubblewrapAvailable`; test `test/confinement.test.ts` "selectConfinement selects bubblewrap when available for a mutating launch"; seam prefixing covered by `test/bubblewrap-guard.test.ts` "spawnAndTee preserves stdout and exit status through bwrap" | Pass |
| Bubblewrap-unavailable + native sandbox → native path (SC 2) | `supportsNativeSandbox('codex')` true, others false; test `test/confinement.test.ts` "supportsNativeSandbox reports true only for codex"; launch-level `test/confinement-launch.test.ts` "startAgent takes the native-sandbox path for codex when Bubblewrap is missing without consent" | Pass |
| Neither available → block until consent; both outcomes tested (SC 3) | `ConfinementBlockedError` (code `CONFINEMENT_BLOCKED`); block: `test/confinement.test.ts` "selectConfinement blocks when bwrap missing, no native sandbox, and no consent" + `test/confinement-launch.test.ts` "startAgent blocks a mutating launch when Bubblewrap is missing and no native sandbox exists"; consented: `test/confinement-launch.test.ts` "startAgent proceeds on explicit allowUnsandboxedMutation consent when Bubblewrap is missing" | Pass |
| Consent explicit, not implicit fallback/default (SC 4) | `allowUnsandboxedMutation` defaults `false` on `startAgent`; `selectConfinement` returns `'blocked'` without it and `'unsandboxed-consented'` only when set; test `test/confinement.test.ts` "selectConfinement allows unsandboxed execution only on explicit consent" | Pass |
| Non-mutating launch behavior unchanged (SC 5) | Gate skipped for non-`worktreeWritable` profiles; test `test/confinement-launch.test.ts` "startAgent review launch is unaffected by the confinement gate when Bubblewrap is missing"; `test/agents.test.ts` 107 pass / 1 skip, no regression | Pass |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` ALL STAGES PASSED (ESLint, tsc, test-hygiene, test typecheck) | Pass |

## Work done

**New policy module** `src/adapters/process/confinement.ts`:
- `selectConfinement({ mutating, bubblewrapAvailable, nativeSandboxSupported, operatorConsent })` — pure, strictly ordered: bubblewrap → native-sandbox → consented → blocked. Read-only launches short-circuit to `'bubblewrap'` (never gated).
- `supportsNativeSandbox(family)` — true only for `codex` (the family whose documented headless invocation carries `--sandbox`); `# ponytail: family list is the single source of truth — add a family here only when its provider documents a launch-layer sandbox this invocation supports`.
- `ConfinementBlockedError` — carries machine-readable `code = 'CONFINEMENT_BLOCKED'` so a deliberate block is distinguishable from a runtime launch failure.

**Wiring** `src/adapters/agents/agents.ts` (`startAgent`): added `allowUnsandboxedMutation?: boolean` option (defaults `false`); inside the launch `try`, after `resolveSandboxProfile`, when `sandboxProfile.worktreeWritable` (mutating) and `bwrap` is **missing** (not merely disabled via the pre-existing `PARALLIX_NO_BUBBLEWRAP` opt-out), call `selectConfinement`. `blocked` throws `ConfinementBlockedError` before the launcher runs; `native-sandbox`/`unsandboxed-consented` set the effective profile to `null` so the launcher's own sandbox is the fallback defense. `review` (read-only) profiles skip the gate entirely — byte-identical to before.

**Docs** `docs/agents.md` "Bubblewrap agent guard": the unavailable-bwrap paragraph now states the ordered fallback (native sandbox → explicit consent → block) and that consent is never an implicit/default/env-only bypass.

**Tests added**
- `test/confinement.test.ts` — pure policy: all four decision outcomes, read-only never gated, `supportsNativeSandbox` family gating, `ConfinementBlockedError` code/message.
- `test/confinement-launch.test.ts` — real `startAgent` gate: block (claude, no native), proceed on explicit consent, proceed natively (codex), review unaffected.

## Next action
Run the mission verification gate `./scripts/verify-local.sh all` and confirm non-mutating compatibility end-to-end (CP-3).
