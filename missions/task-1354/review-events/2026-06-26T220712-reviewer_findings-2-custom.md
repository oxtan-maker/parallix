---
event_type: reviewer_findings
timestamp: 2026-06-26T22:07:12.743Z
round: 2
phase: reviewing
actor: custom
slug: task-1354
---

# Task-1354 Review Findings (Round 2)

## Overview

Mission: regression-test-first lock-the-bug for bug-labeled missions
Branch: `mission/task-1354` (diverged from `main`)
Diff: 63 files, +1068 / -3165 lines

## Critical Finding: Architecture Deviation from Mission Spec

The implementer took a fundamentally different architectural approach than what the locked MISSION.md specifies. This is not a minor deviation — it violates multiple explicit constraints and success criteria.

### F1 [Severity: BLOCKING] — `prompts/execute.md` modified (direct scope violation)

**Mission says** (line 40, 86, 122): "Execute prompt (`prompts/execute.md`): **No change.**" and "Do not modify `prompts/execute.md` at all."

**Actual diff**: `prompts/execute.md` has a new "Bug-labeled missions (repro-before-fix enforcement)" section added at lines 24-29.

**Impact**: The mission explicitly rejected this approach. The design intent was that repro-before-fix lives only in the drafted bug mission's MISSION.md, not in the shared execute template.

### F2 [Severity: BLOCKING] — `verifyRedGreenProof` added to gatekeeper.js (direct scope violation)

**Mission says** (lines 50, 67, 90, 123): "There is **no `verifyRedGreenProof` function** and no bug-specific step inserted into `gatekeeper.js` or `handoff.js` control flow." and "do not add any `bug`-specific gate function (e.g. `verifyRedGreenProof`) or branch to `gatekeeper.js`."

**Actual diff**: `lib/tools/gatekeeper.js` gains 173 lines including `findReproTestPath`, `resolveMissionParentCommit`, `runReproAtRef`, and `verifyRedGreenProof` — all bug-specific.

**Impact**: The mission specified a generic, mission-agnostic approach. Instead, the implementer created a hardcoded bug-specific gate function directly in gatekeeper.js — the exact pattern the mission rejected.

### F3 [Severity: BLOCKING] — No generic `## Gates` runner implemented

**Mission says** (lines 42-43, 88, 111): "Make the mission's `## Gates` section machine-enforced by a generic runner that parses the declared gate commands and executes them." "A generic runner executes a mission's `## Gates` entries and fails handoff when any declared gate exits non-zero."

**Actual diff**: No generic gate runner exists. Instead, `verifyRedGreenProof` is called directly in `handoff.js:325` as a hardcoded "Step 2.6".

**Impact**: The entire architectural premise of the mission — declarative gates driven by the mission's `## Gates` section — is absent. Handoff uses a hardcoded bug-specific gate call instead.

### F4 [Severity: BLOCKING] — No generic red→green proof command

**Mission says** (lines 44-50, 90): "A reusable CLI subcommand / script, e.g. `px verify-repro --test <path>`" that is "mission-agnostic" with "no `bug`-label branching."

**Actual diff**: No CLI command created. The red→green logic is embedded in `verifyRedGreenProof` in gatekeeper.js with explicit bug-label branching.

**Impact**: The mission explicitly rejected embedding red→green logic in shared code. The implementer's approach achieves a similar result but through the exact mechanism the mission forbade.

### F5 [Severity: HIGH] — No shared `getTaskLabels` primitive

**Mission says** (line 29): "Factor out a single shared label-parsing primitive (e.g. `getTaskLabels(taskFilePath)`) that returns the full lowercased label list from both block and inline frontmatter formats. `getTaskClassification()` and `hasBugLabel()` must both consume this primitive — do **not** re-implement block+inline parsing in each function."

**Actual diff**: No `getTaskLabels` function exists. `hasBugLabel()` duplicates the block+inline parsing logic from `getTaskClassification()` — the exact anti-pattern the mission says to avoid.

**Evidence**: `backlog.js:549-578` (getTaskClassification parsing) vs `backlog.js:581-609` (hasBugLabel parsing) — nearly identical code paths.

### F6 [Severity: HIGH] — `handoff.js` modified beyond generic gate runner

**Mission says** (line 124): "Do not modify `lib/commands/handoff.js` beyond adding the generic, mission-agnostic `## Gates` runner step."

**Actual diff**: `handoff.js:321-335` adds `gatekeeper.verifyRedGreenProof(slug, { rootDir, log })` as a hardcoded bug-specific call, not a generic gate runner.

### F7 [Severity: HIGH] — Out-of-scope changes bundled in diff

The diff includes changes completely outside the mission scope:

| Change | Lines | Impact |
|--------|-------|--------|
| `backlog/config.yml` — DOD cleared | `-6 items → []` | Removes ALL project DOD items |
| `.eslintrc.cjs` — deleted | -20 | Removes static analysis config |
| `tsconfig.json` — deleted | -15 | Removes TypeScript config |
| `scripts/test-hygiene.sh` — deleted | -42 | Removes test hygiene scanner |
| `scripts/verify-local.sh` — static-analysis subcommand removed | -33 | Removes verification gate |
| `package.json` — eslint/typescript devDeps removed | -3 | Removes dev dependencies |
| `missions/task-1353/*` — entire mission removed | ~400 | Removes a prior mission |
| `missions/task-1357/*` — entire mission removed | ~300 | Removes a prior mission |

The DOD clearing is particularly impactful — it removes ALL project-level Definition of Done items, including "Lint and static analysis report clean" and "Verification gate ran and passed." This is a breaking change to the project's workflow governance.

### F8 [Severity: MEDIUM] — CP-5 claims are inaccurate

CP-5's Goal Check table claims all 10 success criteria are met. However:

| Criterion | Claim | Reality |
|-----------|-------|---------|
| #6 Execute prompt unchanged | ✅ | ❌ execute.md WAS modified |
| #7 Declarative gate runner | ✅ | ❌ No generic runner exists |
| #8 Generic red→green command | ✅ | ❌ Hardcoded verifyRedGreenProof exists |
| #9 Non-bug missions unaffected | ✅ | ❌ Bug-branch exists in gatekeeper.js/handoff.js |

The checkpoint document overstates compliance.

### F9 [Severity: LOW] — Tests pass but miss specified coverage

`npm test` → 1681 pass / 0 fail. However, tests do not cover:
- A shared `getTaskLabels` primitive (doesn't exist)
- Generic gate runner (doesn't exist)
- Generic red→green proof CLI command (doesn't exist)

The tests verify the implementer's approach (verifyRedGreenProof in gatekeeper.js) but not the mission-specified approach (generic gate runner + generic proof command).

### F10 [Severity: INFO] — Core classification changes are correct

Despite the architectural deviations, the core classification changes work correctly:
- `getTaskClassification()` returns `ai_sdlc` for `[ai_sdlc, bug]` ✓
- `hasBugLabel()` works for both formats ✓
- Non-bug classification unchanged ✓
- Draft prompt updated correctly ✓

### F11 [Severity: INFO] — `prompts/draft.md` change is in scope

The bug-repro instruction added to `prompts/draft.md:25-29` is within scope and correctly implemented.

## Verification Evidence

| Gate | Result |
|------|--------|
| `npm test` | 1681 pass / 0 fail / 22 skipped |
| `test/backlog.test.js` | Passes |
| `test/gatekeeper.test.js` | Passes |
| `./scripts/verify-local.sh docs` | Exit 0 (per CP-5) |

Tests pass, but they test the wrong architecture.

## Summary

The implementer delivered a working implementation of the underlying idea (bug-repro-first with red→green verification) but through a fundamentally different architecture than the mission specified. The mission explicitly rejected:
1. Modifying `prompts/execute.md`
2. Adding `verifyRedGreenProof` to gatekeeper.js
3. Hardcoding bug-specific gates in handoff.js
4. Embedding red→green logic in shared code

Instead, the mission specified:
1. Leave `prompts/execute.md` unchanged
2. A generic `## Gates` runner that parses declared gates
3. A reusable `px verify-repro` CLI command
4. No bug-branch in shared code

The diff violates all four of these constraints. Additionally, the CP-5 checkpoint claims are inaccurate, and significant out-of-scope changes (DOD clearing, ESLint/TS removal, mission deletions) are bundled in the diff.

---
`[workflow-round:2, workflow-phase:reviewing]`