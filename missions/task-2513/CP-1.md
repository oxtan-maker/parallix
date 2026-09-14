# Checkpoint 1 — Mutating-agent launch decision points & confinement policy boundary

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mutating-agent launch decision points mapped | `resolveSandboxProfile` in `src/adapters/process/bubblewrap.ts` returns `worktreeWritable: true` for every non-`review` step and `false` for `review`; single confinement seam is `wrapWithBubblewrap` called from `spawnAndTee` (`src/adapters/process/spawn-tee.ts`) inside `startAgent` (`src/adapters/agents/agents.ts`) | Mapped |
| Bubblewrap availability boundary identified | `isBubblewrapAvailable` / `probeBubblewrap` (`src/adapters/process/bubblewrap.ts`, test `test/bubblewrap-guard.test.ts` "isBubblewrapAvailable returns true when bwrap is executable"); operator opt-out `isBubblewrapDisabled` / `PARALLIX_NO_BUBBLEWRAP` | Identified |
| Native-sandbox capability boundary identified | Codex headless invocation carries agent-native `--sandbox danger-full-access` (`src/adapters/agents/codex.ts` `buildCodexDraftInvocation`); other families expose no launch-layer sandbox flag | Identified |
| Explicit-consent boundary defined | Consent modelled as an explicit `allowUnsandboxedMutation` option on `startAgent` (defaults `false`); no implicit/default/env/prompt bypass | Defined |
| Policy boundary recorded before changing behavior | Pure decision function `selectConfinement` designed (bubblewrap → native-sandbox → consented → blocked); pure-function scope so no caller changed in this checkpoint | Recorded |

## Mapping (findings, no behavior change yet)

**Where mutation is decided.** `resolveSandboxProfile(step, worktree, …)` in `src/adapters/process/bubblewrap.ts`:
- `step === 'review'` → `worktreeWritable: false` (read-only, **out of scope** for this mission).
- every other step (`draft`, `active`, `implement`, `conflict-resolution`, …) → `worktreeWritable: true` (**mutating**).

**The single confinement seam.** `startAgent` (`src/adapters/agents/agents.ts`, the `withSandboxProfile(sandboxProfile, …)` call at the launch site) builds the profile and threads it through `AsyncLocalStorage` to `wrapWithBubblewrap(command, args, cwd)` in `src/adapters/process/bubblewrap.ts`. `wrapWithBubblewrap` is invoked once per child at the `spawnAndTee` seam (`src/adapters/process/spawn-tee.ts`). Current fallback:
```
if (!profile || isBubblewrapDisabled() || !isBubblewrapAvailable()) { return { command, args }; }
```
This is the silent unsandboxed fallback the mission targets: when `bwrap` is missing, a mutating launch continues with full filesystem access and only a once-per-process warning.

**Bubblewrap boundary.** `isBubblewrapAvailable()` probes `bwrap --version` once per process (`probeBubblewrap`); `isBubblewrapDisabled()` honours `PARALLIX_NO_BUBBLEWRAP` (existing explicit operator opt-out, distinct from a silent miss).

**Native-sandbox boundary.** Codex's headless path already passes `--sandbox danger-full-access` (`buildCodexDraftInvocation`, `src/adapters/agents/codex.ts`). No other family exposes a launch-layer sandbox flag, so native sandboxing is only selectable for `codex`.

**Consent boundary.** Consent is an explicit `allowUnsandboxedMutation` boolean on the `startAgent` port options (defaults `false`). It cannot be triggered by an implicit fallback or default. `PARALLIX_NO_BUBBLEWRAP` remains a pre-existing explicit opt-out for the "operator disabled bwrap" case; the new gate governs the "bwrap missing, no native sandbox" silent-fallback case.

**Designed policy function** (`selectConfinement`, pure, to live in `src/adapters/process/confinement.ts`):
```
bubblewrap available            → 'bubblewrap'
else native sandbox supported  → 'native-sandbox'
else operator consented        → 'unsandboxed-consented'
else                            → 'blocked'
```
Wiring (checkpoint 2): in `startAgent`, only when `sandboxProfile.worktreeWritable` (mutating) and bwrap not explicitly disabled; throw `ConfinementBlockedError` on `blocked`; set effective profile to null for `native-sandbox`/`consented` (launcher's own sandbox is the fallback defense).

## Next action
Implement the confinement-selection + explicit-consent policy in `src/adapters/process/confinement.ts` and wire it into `startAgent` (`src/adapters/agents/agents.ts`), then add focused tests (CP-2).
