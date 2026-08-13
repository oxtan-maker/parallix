# Mission: Split forgejo.ts — extract auth and token helpers (task-2369.11)

## Goal
Move 14 auth/token/home-related symbols from `src/adapters/forgejo/forgejo.ts` (1700 lines) into a new `src/adapters/forgejo/forgejo-auth.ts` so the main adapter drops by ~300 lines and consumers can import auth helpers without pulling the full forgejo module.

## Why Now
The forgejo adapter is a 1700-line god module. Auth/token resolution is a self-contained concern with its own dependency chain (`git`, `mission-utils`, `product-config`) and is already imported independently by 4+ callers (`integrate.ts`, `gatekeeper.ts`, `rebase-workflow-adapter.ts`, `setup-review.ts`). Splitting reduces cognitive load, enables faster test mocking, and surfaces a cleaner boundary for future adapter variants.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-file refactor, no behavior change, existing imports already split by symbol

## Scope
- Create `src/adapters/forgejo/forgejo-auth.ts` with these 14 symbols:
  - `resolveForgejoUser()`, `DEFAULT_FORGEJO_USER`
  - `resolveForgejoHome()`, `listGitWorktrees()`, `normalizePathForComparison()`, `isForgejoPath()`
  - `resolveForgejoSettings()`, `resolveForgejoAuth()`
  - `resolveTokenFile()`, `readToken()`
  - `cacheKey()`, `deriveRepoFromGitRemote()` (plus `derivedRepoCache`)
  - `forgejoAvailable()`, `DISPOSITION_PATTERN`
- Remove those symbols from `forgejo.ts` and re-export from `forgejo-auth.ts` so all existing import paths continue to work
- Update `forgejo-api.ts` to import `resolveForgejoSettings` from `forgejo-auth.ts` (resolves circular import note)
- No changes to function signatures, logic, or behavior

## Out of Scope
- Renaming or restructuring any extracted function
- Extracting PR, review, or comment functions (those stay in `forgejo.ts`)
- Adding new tests for extracted functions (existing test coverage via callers is sufficient)
- Updating import paths in files that already import individual symbols from `forgejo.ts` (re-exports cover this)

## Success Criteria
- SC1: `src/adapters/forgejo/forgejo-auth.ts` exists and exports all 14 symbols listed in Scope
- SC2: `forgejo.ts` re-exports all 14 symbols from `forgejo-auth.ts` (no copy, re-export only)
- SC3: `forgejo.ts` line count drops from 1700 to ~1400 (range 1300–1500)
- SC4: `forgejo-api.ts` imports `resolveForgejoSettings` from `forgejo-auth.ts` (not `forgejo.ts`)
- SC5: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs)
- SC6: No runtime behavior change — all existing callers resolve without modification

## Risks and Assumptions
- **Circular import:** `forgejo-api.ts` currently imports `resolveForgejoSettings` from `forgejo.ts` and `forgejo.ts` imports from `forgejo-api.ts`. Moving `resolveForgejoSettings` to `forgejo-auth.ts` breaks the cycle because `forgejo-auth.ts` does not import `forgejo-api.ts`. Assumption: `forgejo-auth.ts` has no dependency on `forgejo-api.ts` functions (verified — it uses stdlib `fs`, `path`, `child_process`, `http`, and shared adapters `git`, `mission-utils`, `product-config`).
- **Re-export fidelity:** Existing callers import symbols from `forgejo.ts`. Re-exporting from `forgejo-auth.ts` must preserve exact names. Assumption: no caller relies on internal-only symbols that are not exported.
- **Test mocking:** Tests that mock `forgejo.ts` exports must still resolve. Re-exports preserve this.

## Checkpoints
- CP 1: Create `forgejo-auth.ts` with all 14 symbols, required imports (`fs`, `path`, `child_process/spawnSync`, `http`, `git`, `mission-utils`, `product-config`), and internal state (`derivedRepoCache`). Verify `forgejo-auth.ts` compiles standalone.
- CP 2: Remove extracted symbols from `forgejo.ts`, add re-exports. Update `forgejo-api.ts` import. Run `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --check src/adapters/forgejo/forgejo-auth.ts` ``
  2. **Test names** — e.g., exact test name string from a test file
  3. **Test file paths** — e.g., `test/task-2242-backlog-drift.test.ts`
  4. **ADR references** — e.g., `ADR 0039`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Prose alone like "file was created" without a path or command is not sufficient.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| forgejo-auth.ts exists with 14 exports | `src/adapters/forgejo/forgejo-auth.ts` | PASS |
| forgejo.ts re-exports all 14 | `src/adapters/forgejo/forgejo.ts` | PASS |
| forgejo.ts line count in range | `wc -l src/adapters/forgejo/forgejo.ts` → 1400 | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/forgejo/forgejo-api.ts` — only update the `resolveForgejoSettings` import path; do not restructure other imports
- Test files — no new tests added; existing test coverage via callers is the authority
- Function signatures and internal logic of extracted symbols — no changes allowed

## Stop Rules
- Stop if static analysis reports type errors in files other than `forgejo.ts` / `forgejo-auth.ts` — investigate import chain before proceeding
- Stop if `forgejo-auth.ts` line count exceeds 150 — re-check extraction boundary
- Do not add documentation (README, ADR) — internal refactor with no user-visible change
- Do not touch `forgejoAvailable` callers outside `forgejo.ts` and `review-adapter.ts` — those imports route through `review-adapter.ts`, not the raw module
