---
id: TASK-2487
title: Amend ADR 0046 with the version-drift and post-publish gaps
status: done
assignee: [claude]
created_date: '2026-09-11 08:35'
updated_date: '2026-09-11 08:37'
labels:
  - repositioning
  - release
  - docs
  - adr
  - user_value
dependencies:
  - TASK-2484
references:
  - scripts/refresh-global-px.sh
  - scripts/package-content-audit.ts
  - scripts/verify-docs.mjs
  - package.json
  - docs/adr/0046-npm-publish-process-and-security.md
documentation:
  - docs/designs/reposition-as-trust-layer.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0046 already documents the npm publication process: the manual publish sequence (clean working tree, version check, `npm pack --dry-run`, `npm publish --access public`, verify, git tag), pre-publish verification, token security, the content audit, and rollback through npm's 72-hour unpublish window and deprecation beyond it. It does not need replacing, and no parallel runbook should be created beside it.

A review of the trust-layer repositioning sequence found four things it does not cover, plus one stale fact.

The version does not stay where the operator left it. `scripts/refresh-global-px.sh` runs as the post-integrate hook and bumps the patch version, rebuilds, packs, and installs globally after every successful `px integrate`. It never publishes to the registry. The ADR's "version check" step therefore understates the hazard: the version on disk moves whenever any mission lands, which can happen between deciding to publish and publishing. Concurrent mission integrations should be drained or parked before a publish sequence begins, and the version should be read immediately before each publish rather than carried over from an earlier step.

A multi-step publish needs multiple versions. npm refuses a publish at a version that already exists, so any sequence that publishes twice needs two distinct versions by construction. The repositioning work is such a sequence.

Some properties are only observable on the live registry page and are absent from the current verification list. The tarball ships `README.md` but not `docs/assets/`, so whether the README's demo image renders at all depends on npm resolving the relative path against a reachable repository. The image is several megabytes and sits on the first screen, so time to first paint on a slow connection is also worth a look. Neither can be checked from a local checkout or from `npm pack --dry-run`.

One measurement is time-sensitive rather than procedural: the npm download count should be recorded before a repositioning publish, because the design doc's kill criterion for the experiment is that people read the new pitch and none install, and that cannot be evaluated without a baseline captured beforehand.

Finally, the Context section states that `@magnusekdahl/parallix` returns 404 and the scoped name is unclaimed. That was accurate on 2026-06-23 and is now false; the package is published. Correct it in place.

Amend ADR 0046 in place rather than appending a dated addendum or superseding clause. The ADR should read as the current decision, not as a history of it.

Surfaced by a CEO plan review of the trust-layer repositioning work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ADR 0046's operational procedures state that the post-integrate hook bumps the patch version on every successful integrate, so the version on disk moves without operator action
- [ ] #2 ADR 0046 requires draining or parking concurrent mission integrations before a publish sequence begins
- [ ] #3 ADR 0046 requires reading the version immediately before each publish, and states that a multi-step publish needs distinct versions because npm rejects a republish at an existing version
- [ ] #4 ADR 0046 lists the post-publish checks that can only be performed against the live registry page, including whether the README image renders given that docs/assets is not in the tarball
- [ ] #5 ADR 0046 covers recording the npm download count before a repositioning publish, and says why the baseline is needed
- [ ] #6 The stale claim that @magnusekdahl/parallix returns 404 and the scoped name is unclaimed is corrected in place
- [ ] #7 The amendments are edited into the existing sections rather than appended as a dated addendum or a supersedes clause
- [ ] #8 No parallel release runbook document is created
- [ ] #9 The current npm download count for the package is recorded before the first repositioning publish
<!-- AC:END -->



## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
