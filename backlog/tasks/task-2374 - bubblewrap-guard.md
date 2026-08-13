---
id: TASK-2374
title: bubblewrap guard
status: active
assignee: [codex]
created_date: '2026-08-13 18:31'
labels: [user_value]
dependencies: []
ordinal: 93912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix deliberately launches capable agents without their vendors' restrictive sandboxes, but the process itself must still be confined when Linux `bubblewrap` (`bwrap`) is available. Apply one shared Bubblewrap boundary at the agent-process launch seam; do not maintain a wrapper in every family launcher.

The boundary must mount the mission worktree read/write and must add every writable location named by the prompt for that workflow step. Prompt text is the source of truth for this allowlist:

- `draft`, `execute`, and `act-on-review`: the selected mission worktree (including its mission files and task copy).
- `review`: the selected mission worktree read-only; the configured review artifact directory `review.tmpDir` read/write; and `/tmp` read/write because `prompts/review.md` explicitly permits temporary diagnostic files there. The artifact directory may be outside the worktree.
- Do not grant the agent arbitrary access to the checkout parent, home directory, or unrelated host paths merely because a launcher happens to use them. Preserve the minimal runtime files, executable/library visibility, networking, and agent state locations required for the chosen CLI to start; those host dependencies are not agent work areas.

Resolve and validate paths before constructing Bubblewrap arguments. A configured artifact directory must be created or otherwise be a usable writable directory before launch. Never turn a missing optional mount, a duplicate/nested bind, or a shell-escaped path into a broader host bind. Keep all command invocation argument-array based.

When `bwrap` is absent or cannot be executed, emit one clear warning identifying that the agent is running unsandboxed, then preserve today’s launch behaviour. When it is present, a failed sandbox setup must fail the launch rather than silently retrying outside the sandbox; operators must be able to distinguish unavailable Bubblewrap from a broken guard.
<!-- SECTION:DESCRIPTION:END -->

## Scope

<!-- SECTION:SCOPE:BEGIN -->
Open these directories while implementing, because they define the launch boundary and the writes prompts authorize:

- `src/adapters/agents/` — common agent dispatch and the family invocations that supply `cwd`, environment, and state roots.
- `src/adapters/process/` — the single child-process spawn seam where the wrapper belongs.
- `src/adapters/review/` and `config/` — resolution of `review.tmpDir`, which can be outside a worktree.
- `prompts/` — authoritative per-step filesystem permissions, especially review’s artifact directory and `/tmp` allowance.
- `test/` — existing launcher/process/review-prompt tests; add the smallest hermetic coverage here.

Do not broaden the sandbox based on unrelated temporary directories found elsewhere in the repository. In particular, package/test fixture temp roots are not workflow-agent permissions unless a workflow prompt explicitly grants them.
<!-- SECTION:SCOPE:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Every production workflow-agent launch passes through one shared Bubblewrap decision point; no family-specific wrapper duplicates are added.
- [ ] #2 With executable `bwrap`, draft/execute/act-on-review can write only the mission worktree, while review can additionally write the resolved artifact directory and `/tmp`; review’s worktree bind is read-only.
- [ ] #3 The guard uses resolved argument arrays and rejects unusable permitted paths without widening the mount set; an artifact directory outside the worktree is supported.
- [ ] #4 If `bwrap` is unavailable, launch continues once with a clear unsandboxed warning. If it is available but guard setup fails, the launch fails and does not fall back to an unsandboxed child.
- [ ] #5 Hermetic tests prove the constructed launch command and the unavailable-versus-setup-failure behaviour without invoking a real agent CLI or Forgejo.
- [ ] #6 `./scripts/verify-local.sh static-analysis` passes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Trace the common dispatch-to-spawn path and derive the allowed writable directories from the rendered workflow step and prompt contract.
2. Add the smallest shared Bubblewrap command builder/availability check at that seam, preserving each existing launcher’s command, environment, and `cwd`.
3. Cover the three mount profiles plus unavailable and setup-failure paths with injected process/availability seams.
4. Run focused hermetic tests and the required static-analysis gate.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
