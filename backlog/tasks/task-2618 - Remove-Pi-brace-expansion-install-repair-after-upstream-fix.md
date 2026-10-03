---
id: TASK-2618
title: Remove Pi brace-expansion install repair after upstream fix
status: backlog
assignee: []
created_date: '2026-09-30 06:40'
labels:
  - maintenance
  - dependencies
dependencies: []
references:
  - 'https://github.com/earendil-works/pi/issues/6882'
modified_files:
  - package.json
  - package-lock.json
  - scripts/repair-pi-brace-expansion.mjs
priority: low
ordinal: 145008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pi currently publishes an npm-shrinkwrap.json that pins vulnerable brace-expansion@5.0.9, including in pi-coding-agent@0.99.1. Parallix temporarily repairs the nested install and lock metadata through scripts/repair-pi-brace-expansion.mjs, the package.json prepare hook, and a direct brace-expansion@5.0.12 development dependency. Remove this workaround after a compatible Pi release installs a patched brace-expansion without local repair. Upstream context: https://github.com/earendil-works/pi/issues/6882

This mission also includes upgrading `@earendil-works/pi-coding-agent` to the latest published release as part of the same change set.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify a compatible @earendil-works/pi-coding-agent release whose published shrinkwrap resolves brace-expansion to a version outside the current npm audit advisory ranges.
- [ ] #2 Upgrade Pi as needed, remove scripts/repair-pi-brace-expansion.mjs, the prepare hook, and the direct brace-expansion pin if no longer needed; regenerate package-lock.json without manually patching nested entries.
- [ ] #3 From a clean install, npm ls shows no vulnerable nested brace-expansion; npm audit --audit-level=high passes before and after npm ci, and npm ci leaves package-lock.json unchanged.
- [ ] #4 Run focused Pi integration tests and ./scripts/verify-local.sh static-analysis; confirm package build and optional Pi SDK behavior still work.
<!-- AC:END -->

## Investigation (2026-10-02)

**Verdict: premise is stale. task-2618 is ready, and the "fix" it targets does not exist.**

The task assumes pi pins a *vulnerable* brace-expansion. That is false:

- Advisory GHSA-3jxr-9vmj-r5cp (high, DoS via exponential expansion) vulnerable range is `brace-expansion >= 3.0.0, < 5.0.7`.
- Every published pi-coding-agent release pins `brace-expansion@5.0.9`, which is **outside** the vulnerable range (5.0.9 >= 5.0.7 = safe).
- Upstream issue #6882 was closed by maintainer `badlogic` with "fixed on main" (2026-07-21), and upstream already ships 5.0.9.

Raw published-shrinkwrap evidence (all `5.0.9`, all safe):

| pi release | brace-expansion pinned |
|---|---|
| 0.87.1 (currently installed) | 5.0.9 |
| 0.99.0 | 5.0.9 |
| 0.99.1 | 5.0.9 |
| 0.99.2 | 5.0.9 |
| 1.0.0 | 5.0.9 |

Project audit is already clean: `npm audit` reports 0 vulnerabilities. `npm ls brace-expansion` shows pi's nested copy at 5.0.12 (the repair script forces it), but even without the repair, 0.87.1 ships 5.0.9 which is safe.

**Conclusion:** the repair script (`scripts/repair-pi-brace-expansion.mjs`), the `prepare` hook, and the direct `brace-expansion@5.0.12` dev pin are all fixing a non-problem. AC#1 ("identify a compatible release whose shrinkwrap resolves outside advisory range") is already satisfied by the installed 0.87.1.

### Recommended path
1. Upgrade `@earendil-works/pi-coding-agent` to the latest published release in `package.json` (`^0.87.1` -> latest), then regenerate `package-lock.json` clean (no manual nested patching).
2. Remove `scripts/repair-pi-brace-expansion.mjs`, the `prepare` hook, and the direct `brace-expansion` pin (keep the pin only if the upgraded pi still needs it; verify with the audit below).
3. Verify: `npm audit` = 0 vulns, `npm ls brace-expansion` shows 5.0.9 under pi, lockfile unchanged after `npm ci`.
4. Run `./scripts/verify-local.sh static-analysis` + focused Pi integration tests.

No pi upgrade required — the already-installed 0.87.1 is safe.

### References
- Upstream issue: https://github.com/earendil-works/pi/issues/6882 (closed, "fixed on main")
- Advisory: https://github.com/advisories/GHSA-3jxr-9vmj-r5cp (vulnerable `< 5.0.7`)
- brace-expansion versions: `npm view brace-expansion versions`

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
