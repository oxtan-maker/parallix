---
id: TASK-2484
title: Fix dead npm metadata URLs and verify them automatically
status: done
assignee: [custom]
created_date: '2026-09-11 08:34'
labels:
  - repositioning
  - packaging
  - distribution
  - user_value
  - bug
dependencies: []
references:
  - package.json
  - scripts/verify-docs.mjs
  - scripts/release-metadata.ts
documentation:
  - docs/designs/reposition-as-trust-layer.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every "Repository", "Homepage", and "Bugs" link on the npm page for `@magnusekdahl/parallix` currently resolves to HTTP 404 for anonymous visitors. `package.json` points all three at `github.com/magnusekdahl/parallix` (404), while the git remote `origin` is `github.com/oxtan-maker/parallix` (200, verified 2026-09-11).

This matters more than ordinary metadata hygiene. Parallix is being repositioned to lead with trust, and a developer evaluating a trust pitch clicks the repository link first. The pitch is falsified before the README is read. The dead URL also propagates beyond the npm page: `scripts/release-metadata.ts` reads `repository` and `homepage` out of the manifest and carries them into generated release metadata.

Nothing in the repository could have caught this. `scripts/verify-docs.mjs` skips absolute URLs by design and only reads `README.md`, `docs/use-cases.md`, and `docs/doc-standards.md`; `package.json` is verified by nothing.

Choosing which URL is canonical is an operator decision, not an implementer one: the `magnusekdahl/parallix` repository may be intentionally private rather than nonexistent. Confirm the intended canonical repository before editing, and if it should be `magnusekdahl/parallix`, the fix is to make that repository reachable rather than to repoint the manifest.

A network-free check is sufficient and preferable: compare the three manifest fields against `git remote get-url origin` and fail on disagreement. That keeps the docs verifier usable offline.

Surfaced by a CEO plan review of the trust-layer repositioning work (see docs/designs/reposition-as-trust-layer.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The canonical repository URL is confirmed with the operator before any edit is made
- [x] #2 package.json repository.url, homepage, and bugs.url all resolve to a reachable page for an anonymous visitor
- [x] #3 scripts/verify-docs.mjs fails when package.json repository.url, homepage, or bugs.url disagree with the git remote origin URL
- [x] #4 The new verification check runs without network access
- [x] #5 A test covers the failing case: a manifest whose URLs disagree with origin is rejected
- [x] #6 The docs verifier still passes on the repository's current authored docs
- [x] #7 docs/ is updated where it describes what verify-docs.mjs checks
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using test names and repository commands
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
