# CP-3 — Prompt conditional sections for bug-labeled missions

## Summary

Added bug-labeled conditional sections to both phase prompts. Each section is self-gating ("applies only when the backlog task carries a `bug` label … otherwise ignore this section entirely"), so non-bug missions read the prompts identically to before. The rest of each template is untouched, satisfying the restricted-area constraint.

- `prompts/draft.md`: new "Bug-labeled missions (regression-test-first / 'lock the bug')" section inserted before the Graphify-first paragraph. It instructs the drafter to make the failing reproduction test the **first checkpoint** and to record the test path as a `Reproduction-Test: <path>` line in MISSION.md — the exact convention the CP-4 gate reads (`prompts/draft.md:30`).
- `prompts/execute.md`: new "Bug-labeled missions (repro-before-fix enforcement)" section inserted before `{{checkpoint_context}}`. It requires the reproduction test be committed before any fix commit, instructs the agent to HALT if the test is absent/uncommitted/undeclared, and names `verifyRedGreenProof` as the handoff gate (`prompts/execute.md:24`).

## Goal Check

| Success criterion | Evidence (file:line) | Status |
| --- | --- | --- |
| #5 Draft prompt has bug-conditional repro-test instruction | `prompts/draft.md:25-29` (conditional section requiring first-checkpoint failing repro test + `Reproduction-Test:` declaration) | ✅ |
| #6 Execute prompt enforces repro-before-fix with halt | `prompts/execute.md:24-28` (commit-before-fix requirement + HALT-on-missing) | ✅ |
| Restricted area: rest of templates unchanged | Both edits are additive blocks only; existing lines unchanged (`git show` diff is insert-only) | ✅ |

Verification: `node --test test/draft.test.js test/draft-command.test.js test/active.test.js` → all pass (prompts load and render without unsubstituted tokens introduced — the sections use plain-English gating, not new template variables).

Next action: CP-4 — implement `verifyRedGreenProof` in `lib/tools/gatekeeper.js` (skip non-bug, locate `Reproduction-Test:`, run red at parent commit + green at HEAD) and wire it into the `handoff.js` verification flow.
