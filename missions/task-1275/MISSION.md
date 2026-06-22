# Mission: Guard transitionTask/commitTaskFileUpdate against slug/task-id mismatch to prevent stray commits (task-1275)

## Goal

Add a defensive guard in `transitionTask()` so that when the requested `slug` has a suffix after the numeric base id (matching `/^(task-\d+)-/i`), the function warns and returns `false` without calling `commitTaskFileUpdate()`. The guard fires on slug shape alone, independent of frontmatter id comparison. This prevents a mistyped or suffixed slug from silently committing a status change to an unrelated task file.

## Why Now

TASK-1265 exposed a test-isolation leak where `parallix/test/task-1048-regression.test.js` invoked `transitionTask` against `process.cwd()` with a suffixed slug (`task-1048-regress`), causing `resolveTaskFile` to resolve to `TASK-1048` and silently create a `backlog(<wrong-slug>): transition to ...` commit on the checked-out `mission/task-1264` branch. TASK-1265 fixed the test, but without a runtime guard in `transitionTask` itself, a future caller passing a mistyped slug can still produce the same stray-commit bug. Adding the guard now closes the class of bugs at the source.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Prevent regression of TASK-1265 mechanism; close the gap between test-fix and production guard

## Scope

- Modify `transitionTask()` in `parallix/lib/tools/backlog.js` to reject suffixed slugs (e.g., `task-1048-regress`) before calling `commitTaskFileUpdate()`. The guard fires on slug shape alone — any slug matching `/^(task-\d+)-/i` is rejected regardless of frontmatter id.
- The "intended canonical-id mapping" in `resolveTaskFile` (base-ID suffix stripping) is NOT a permit path. The guard rejects ALL suffixed slugs to prevent the exact class of bug TASK-1265 exposed: a suffixed slug base-ID-resolving to an unintended task file and silently committing.
- Add a unit test in `test/backlog.test.js` covering the mismatch-no-op scenario.
- Ensure existing callers (review-loop, handoff, active, integrate, draft, mission-start, rebase, gatekeeper) remain functional — they all pass `resolveTaskFileFn` overrides where needed, so the guard applies transparently.

## Out of Scope

- Modifying `commitTaskFileUpdate()` directly (the guard belongs in `transitionTask` at the decision boundary).
- Changing `resolveTaskFile()` resolution logic (already hardened in TASK-1265).
- Updating callers to pass explicit slug validation — the guard is internal to `transitionTask`.
- Modifying `transitionVirtual()` wrapper in `state-map.js` (it delegates to `transitionTask` and inherits the guard).
- Adding CLI flags or configuration options for this guard.

## Success Criteria

1. `transitionTask('task-1048-regress', 'active', { rootDir })` — any suffixed slug — **does not commit** and returns `false`, logging a WARN about the suffix.
2. `transitionTask('task-1048', 'active', { rootDir })` where the resolved file has frontmatter `id: TASK-1048` **commits normally** and returns `true` (slug matches id — no guard trigger).
3. `transitionTask('task-0999', 'active', { rootDir })` where no task file matches at all **returns false** (original missing-error path preserved).
4. A new unit test in `test/backlog.test.js` verifies the suffixed-slug rejection: creates a temp repo with two tasks (`TASK-1048` and `TASK-1049`), invokes `transitionTask('task-1048-regress', 'active')` which resolves to `TASK-1049` via filename prefix match, asserts the function returns `false`, asserts no git commit was created, and asserts a warning was logged.
5. All existing tests pass: `npm test` completes with zero failures.
6. The guard does not alter the return value of `transitionTask` when slug and resolved id match (returns `true` on success, `true` when already in desired state).

## Risks and Assumptions

- **Risk**: Some callers may rely on the existing behavior where a suffixed slug resolves and commits. **Mitigation**: The guard rejects ALL suffixed slugs regardless of frontmatter id match. A caller audit shows no production path passes a suffixed slug. The guard reopens the TASK-1265 bug for the case where a suffixed slug base-ID-resolves to the *same* task id — but this is the correct tradeoff because the base-ID suffix-stripping path is inherently unreliable and was the mechanism of the original incident.
- **Assumption**: The only intended canonical-id mapping is the base-ID suffix stripping (`task-NNN-suffix` -> `TASK-NNN`). Any other slug-to-id divergence is a bug.
- **Risk**: `transitionVirtual()` in `state-map.js` wraps `transitionTask` and may mask the guard's return value. **Mitigation**: The wrapper already propagates `transitionTask`'s boolean return; the guard's `false` will propagate correctly.
- **Assumption**: `resolveTaskFile`'s resolution logic (prefix match, ID match, base-ID fallback) correctly identifies the target file. The guard adds a second check on top, not a replacement.

## Checkpoints

- CP 1: Identify the exact code path in `transitionTask` where the slug-to-file resolution occurs and where `commitTaskFileUpdate` is called. Draft the guard logic: extract the frontmatter `id` from the resolved file, compare against the slug's canonical form, decide permit/reject.
- CP 2: Implement the guard in `transitionTask()`, add the unit test, and verify locally with a temp repo (two tasks, suffixed slug targeting wrong task).
- CP 3: Run full test suite (`npm test`), confirm zero regressions.

## Gates

- [ ] npm test (zero failures)

## Restricted Areas

- Do not modify `resolveTaskFile()` — its resolution logic is already hardened and changing it risks broader breakage.
- Do not modify `commitTaskFileUpdate()` — the guard is a caller-side decision, not a callee-side restriction.
- Do not modify `transitionVirtual()` in `lib/core/state-map.js` — it inherits the guard automatically.
- Do not add new configuration, CLI flags, or environment variables for this guard.

## Stop Rules

- Stop if the guard breaks any existing caller's expected behavior (detected via `npm test`).
- Stop if the guard would incorrectly reject a legitimate pattern that is not the suffix-stripping canonical mapping described in `resolveTaskFile`.
- Stop if implementing the guard requires restructuring `transitionTask`'s control flow beyond a single pre-commit check.
