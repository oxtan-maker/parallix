# Mission: Remove stale Forgejo owner assumptions from review setup (task-2364)

## Goal
Eliminate hardcoded `magnus` / `magnus/parallix` owner assumptions in review setup and bootstrap logic so a fresh local Forgejo instance with a different admin account (e.g. `human`) works without manual account creation.

## Why Now
Fresh local Forgejo installs default to `human` as the admin account. `px setup-review` and the auto-bootstrap path in `review-commands.ts` fall back to `magnus` when repo config is absent, causing token creation to fail until a `magnus` account is created manually. Blocks self-hosted / local-only onboarding.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 1 source file default change + regression test; existing `setup-review.ts` already uses `human` as default — only `review-commands.ts:1059` fallback and test coverage remain stale

## Scope
- Fix `src/adapters/review/review-commands.ts` line 1059: change fallback `ownerLogin` from `'magnus'` to `'human'` (aligns with `setup-review.ts` defaults)
- Add regression test under `test/` that exercises setup-review and auto-bootstrap with a non-`magnus` owner (e.g. `human`)
- Verify existing `setup-review.ts` helper defaults (`defaultRepoSlug`, `collectSetupAnswers`, `collectWizardAnswers`, `buildNonInteractiveAnswers`) already use `human` — document in checkpoint if confirmed no change needed
- Update `test/setup-review.test.ts` fixtures where `magnus` is used as the *sole* owner test value to also cover a non-`magnus` owner scenario

## Out of Scope
- `src/adapters/filesystem/package-root.ts` — `@magnusekdahl/parallix` is the npm package name, not a review owner assumption
- `config/workflow.config.schema.json` `$id` — namespace URI, not a runtime default
- Docs/README prose updates (no user-facing behavior change in configured setups)
- Migrating existing `magnus` token files for current users

## Success Criteria
- SC1: `src/adapters/review/review-commands.ts` fallback `ownerLogin` is `'human'` (not `'magnus'`)
- SC2: Regression test `test/task-2364-owner-assumption.test.ts` exists and passes — asserts auto-bootstrap uses owner derived from `reviewAdapter.repo` or falls back to `'human'`
- SC3: `npm test` passes (full suite green)
- SC4: `setup-review.ts` helper defaults (`defaultRepoSlug`, `collectSetupAnswers`, `collectWizardAnswers`, `buildNonInteractiveAnswers`) confirmed to use `'human'` or derive from config — no hidden `'magnus'` fallback remains
- SC5: Existing valid review remotes and token files are preserved — no test failure on `setup-review.test.ts` after changes

## Risks and Assumptions
- Assumption: `reviewAdapter.repo` is always populated when auto-bootstrap triggers; fallback `'human'` is only a safety net for empty config
- Risk: Existing users with `magnus` token files see no disruption — fallback only affects the *default* when repo slug is missing, not token lookup by user
- Assumption: `setup-review.ts` already uses `'human'` consistently (verified during draft)

## Checkpoints
- CP 1: Author failing reproduction test (`test/task-2364-owner-assumption.test.ts`) that asserts auto-bootstrap with non-`magnus` owner. Test must be RED on parent commit (fallback is `'magnus'`) and turn GREEN after fix. Scenario: mock `reviewAdapter.repo` as empty string, verify `ownerLogin` resolves to `'human'` not `'magnus'`.
- CP 2: Apply fix — change `review-commands.ts:1059` fallback to `'human'`. Verify all `setup-review.ts` defaults confirmed correct. Run `npm test`.

Reproduction-Test: test/task-2364-owner-assumption.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2364-owner-assumption.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"auto-bootstrap fallback owner is human not magnus"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2364-owner-assumption.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Fallback owner changed to human | `src/adapters/review/review-commands.ts`, `` `npm test -- test/task-2364-owner-assumption.test.ts` `` | PASS |
| Regression test passes | `test/task-2364-owner-assumption.test.ts`, `"auto-bootstrap fallback owner is human not magnus"` | PASS |
| Full suite green | `` `npm test` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/filesystem/package-root.ts` — package name anchor, not review owner logic
- `config/workflow.config.schema.json` — schema `$id` is a namespace URI
- `docs/` — no doc updates required for this fix
- `src/adapters/forgejo/` — no changes expected; `resolveForgejoSettings` already derives owner from config

## Stop Rules
- Do not add new dependencies or abstractions
- Do not modify `package-root.ts` package name resolution
- If `setup-review.ts` defaults already use `'human'` everywhere, document that finding and do not touch those functions
- If more than 2 source files need owner-default changes beyond `review-commands.ts`, pause and re-scope
