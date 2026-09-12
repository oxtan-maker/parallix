---
id: TASK-2486
title: Reposition the README and npm description around the trust ladder
status: done
assignee: [codex]
created_date: '2026-09-11 08:35'
updated_date: '2026-09-11 08:38'
labels:
  - repositioning
  - docs
  - distribution
  - user_value
dependencies:
  - TASK-2484
  - TASK-2485
references:
  - README.md
  - package.json
  - src/adapters/process/bubblewrap.ts
  - src/domain/review.ts
  - src/adapters/review/setup-review.ts
documentation:
  - docs/designs/reposition-as-trust-layer.md
  - docs/readme-rewrite-benchmark.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix is marketed as an isolation product in a category where isolation became free and commoditized during 2026. The approved design doc concludes the differentiator is the trust ladder: review by a preferentially different agent family, self-approval blocked at the provider, a repository-owned verification gate, sandboxed execution, and a human-owned squash merge. The README's opening still leads with running agents in parallel without giving up Git isolation, which invites a comparison against a dozen free tools on Parallix's weakest axis.

The job is to change what the README leads with, not to fix its honesty. A review checked every trust claim in the file against the code that implements it and found them all already correctly conditional:

- The review rung is described as forcing a second review *attempt*, guaranteeing a different reviewer only when one is available.
- The lifecycle summary likewise says a different agent family is used when one is available.
- The Bubblewrap confinement claim is scoped to Linux, conditioned on Bubblewrap being available, and states explicitly that Parallix warns when the agent runs unsandboxed. The Defence in depth section repeats the condition.
- Forgejo is already described as optional, and `reviewProvider` already defaults to `none` in setup.

Those caveats are an asset and the main risk of this rewrite is losing them. They are spread across the file at some distance from the headline claims they qualify, so a lead rewrite that reorders or compresses the opening can separate a claim from its condition without anyone noticing. Inventory them first, then write the lead against the inventory.

The accurate framing of what holds on the documented default path is narrower than an unqualified five-rung pitch would suggest: the human-owned squash merge is unconditional; the repository-owned verification gate holds wherever one is configured; the review and confinement rungs are conditional in the ways the README already states. Write the pitch to what actually fires, and keep the existing conditions attached to it.

Two inputs should land before the lead is finalized. The single-family rehearsal transcript from task-2485 shows what a cold operator actually sees at the review step, and the npm metadata fix in task-2484 determines whether the demo image renders on the npm page at all (the tarball ships `README.md` but not `docs/assets/`, so npm can only resolve the relative image path against a reachable repository).

Also in scope: move the Forgejo bootstrap out of the main setup narrative into an optional-integrations section. The `px setup` help text itself currently advertises that it bootstraps Forgejo, which tells a stranger that Forgejo is part of the required path when it is not.

The ASCII lifecycle strip in the README sits some distance above the review caveat that qualifies it; verify they do not become separated by the rewrite.

`docs/readme-rewrite-benchmark.md` records how seven comparable developer tools open, and its decisions column is the intended style reference. Task-1336 rewrote the README as a credible landing page and task-1350 established a README standard; both are complete and this task changes what the file leads with rather than redoing either.

Surfaced by a CEO plan review of the trust-layer repositioning work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An inventory of every guarantee claim in README.md exists, each paired with its current caveat and with a verification against the code that implements it
- [ ] #2 The README opening and the npm package description both lead with the trust ladder rather than with parallel isolation
- [ ] #3 No caveat that exists in the README today is lost, weakened, or separated from the claim it qualifies
- [ ] #4 Any claim the inventory finds to be uncaveated or inaccurate against the code is either caveated or removed
- [ ] #5 No claim in the rewritten README contradicts another claim elsewhere in the file
- [ ] #6 The Forgejo bootstrap is presented only as an optional integration, in the README and in the px setup help text
- [ ] #7 The README's ASCII lifecycle diagram remains accurate and adjacent to the caveat that qualifies it
- [ ] #8 The internal self-measurement figure remains labelled as internal and is not presented as external evidence
- [ ] #9 The README standard established by task-1350 is still satisfied
- [ ] #10 scripts/verify-docs.mjs passes on the rewritten README
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
