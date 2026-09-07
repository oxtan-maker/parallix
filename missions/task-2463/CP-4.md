# CP 4 — Integration gate and closing every success criterion

## Work done

Ran the full integration gate and closed every success criterion. During
integration the write was rerouted from raw `fs.writeFileSync`/`mkdirSync` to
`storage.writeJson` (atomic mkdir + write in the excluded storage boundary) and
`src/adapters/agents/first-run-config.ts` was added to the ADR 0053
persistence inventory as a `Configuration` read+write, so the
`persistence-inventory-guardrail` completeness check stays green without
touching persistence authority or the state-map. `docs/agents.md` documents the
first-run autodetection and `px config --write`.

## Gates

- `./scripts/verify-local.sh all` → **PASS** (exit 0). Full suite:
  `tests 2410 / pass 2410 / fail 0`, including
  `test/first-run-config-autodetect.test.ts`, `test/config-command.test.ts`,
  `test/agents.test.ts`, `test/domain-agent-selection.test.ts`,
  `test/persistence-inventory-guardrail.test.ts`.
- `./scripts/verify-local.sh static-analysis` → **PASS** (ESLint clean,
  `tsc` typecheck clean, test-hygiene clean, test typecheck clean).
- `./scripts/verify-local.sh docs` → **PASS** (no volatile evidence, links resolve).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fresh tree gets filtered `config/agents.json` (draft/active/review) | `test/first-run-config-autodetect.test.ts` "writes a filtered config on first run containing only available families" | PASS |
| Absent family excluded; present family included | `test/first-run-config-autodetect.test.ts` "absent family never appears in any eligible array; present family does" | PASS |
| Pre-existing working-tree file untouched on rerun | `test/first-run-config-autodetect.test.ts` "leaves a pre-existing working-tree config byte-for-byte on a second run" | PASS |
| `custom` judged against its configured runner | `test/first-run-config-autodetect.test.ts` "judges the custom family against its configured runner" | PASS |
| Written config feeds `readAgentConfig`/`eligibleAgentsForStep`, doc keys preserved | `test/first-run-config-autodetect.test.ts` "written config feeds readAgentConfig and eligibleAgentsForStep" | PASS |
| `selectAgent` selection behavior unchanged | `test/agents.test.ts` (105 pass), `test/domain-agent-selection.test.ts` (5 pass) | PASS |
| `px config` non-zero when not a repo root; read-only prints config | `test/config-command.test.ts` "config --write exits non-zero when the working directory is not a repository root" | PASS |
| No new lint / typecheck regressions | `./scripts/verify-local.sh static-analysis` | PASS |
| Full integration gate | `./scripts/verify-local.sh all` (2410 pass / 0 fail) | PASS |
| First-run hook at workflow-command entry, once, idempotent | `src/composition/create-cli.ts` draft/active/review prime; idempotent on `config/agents.json` presence | PASS |

## Round 2 review-response (REQUEST_CHANGES → fixes)

Reviewer (round 2) raised one finding about the R1 F3.1 git guard.

- **F1 (R2): first-run guard hard-fails non-git workflow commands.** The
  `hasGitRepository` guard returned `1` on *every* invocation, regressing the
  supported non-git standalone layout (the `config` command deliberately
  supports it). Made the guard best-effort: skip detection when the target is
  not a repository root and let the command proceed. The write only ever
  happens on first run, so no config is written into a non-git checkout; the
  command itself still runs as it did pre-mission.

Post-fix evidence:

| Item | Evidence | Status |
|---|---|---|
| Non-git target no longer hard-fails | `src/composition/create-cli.ts` best-effort skip; analogous `test/config-command.test.ts` "config leaves a non-git standalone directory unchanged" | PASS |
| No lint / typecheck regression | `./scripts/verify-local.sh static-analysis` | PASS |

## Round 1 review-response (REQUEST_CHANGES → fixes)

Reviewer (round 1) raised three uncovered-behavior findings. All fixed:

- **F1 — all-probes-fail bricks selection.** `ensureFirstRunAgentConfig` now
  skips the write when no family probed available and returns
  `emptyDetection: true`, so selection falls back to the shipped default
  (pre-mission default-to-all) instead of pinning an empty `eligible`. Adds
  `force`/`emptyDetection` to the result/options types. Locks the behavior with
  `test/first-run-config-autodetect.test.ts` "does not persist an
  all-probes-fail detection; falls back to shipped default" and
  "force skips an empty detection instead of overwriting a live config".
- **F2 — `px config --write` never refreshed.** `--write` now passes
  `force: true`, regenerating an existing config; the implicit first-run hook
  never sets `force`, so it stays idempotent. New test:
  "force regenerates an existing working-tree config (px config --write
  refresh)". `docs/agents.md:162` refresh claim is now true.
- **F3 — weaker guard + typo.** `src/composition/create-cli.ts` now applies the
  same `hasGitRepository` guard to the automatic draft/active/review write that
  `px config --write` enforces. Fixed the "Parallx" → "Parallix" typo in
  `docs/agents.md:162`.

Post-fix evidence:

| Item | Evidence | Status |
|---|---|---|
| F1 empty-detection skip + fallback | `test/first-run-config-autodetect.test.ts` "does not persist an all-probes-fail detection; falls back to shipped default" | PASS |
| F2 on-demand refresh | `test/first-run-config-autodetect.test.ts` "force regenerates an existing working-tree config" | PASS |
| F3 repo guard + typo | `test/config-command.test.ts` "config --write exits non-zero when the working directory is not a repository root"; `docs/agents.md:162` | PASS |
| No lint / typecheck regression | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action
Hand off for the next formal reviewer round. Round 1 findings all resolved and
committed; run `px review` / `px integrate` on the next loop iteration, not now.
