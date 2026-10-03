---
id: TASK-2639
title: Reconcile public-facing documentation with current Parallix behavior
status: backlog
assignee: []
created_date: '2026-10-03 15:07'
labels: []
dependencies: []
ordinal: 157008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Perform a narrow truthfulness and consistency pass over the public surfaces a skeptical user, contributor, or hiring reviewer is likely to inspect.

This is **not** a README rewrite and **not** a product-change mission.

The goal is to remove stale statements left behind by recent architecture, confinement, CI/CD, and release changes so the repository describes what the current implementation actually does.

---

## Scope

Inspect at minimum:

```text
README.md
docs/use-cases.md
docs/designs/reposition-as-trust-layer.md
docs/adr/0046-npm-publish-process-and-security.md

src/adapters/process/bubblewrap.ts
src/adapters/process/confinement.ts

scripts/verify-local.sh
package.json
.github/workflows/
```

Search the rest of `docs/` for materially stale claims related to:

```text
manual publishing
no CI
no release automation
unsandboxed fallback
Bubblewrap
Node version requirements
npm publication
GitHub Releases
Trusted Publishing
provenance
```

Do not churn historical documentation merely because terminology has evolved.

---

# Required corrections

## 1. Release / CI documentation

The current implementation has:

- GitHub CI;
- protected-main verification;
- continuous npm publication from verified source;
- npm Trusted Publishing;
- provenance;
- matching Git tag and GitHub Release.

Ensure current-status documentation says this accurately.

The current README distribution wording should be concise and grammatical. Do not leave constructions such as:

```text
continuously delivered/ published
```

Prefer one precise description of what happens.

### Historical design records

`docs/designs/reposition-as-trust-layer.md` currently contains historical statements such as:

```text
No CI/release automation exists today; publishing is manual.
```

Do not rewrite the original design exercise as though it had always known about the later implementation.

Instead mark materially superseded operational statements clearly, for example with a short dated note or a `Superseded by` annotation.

A reader should be able to distinguish:

```text
what was true when the design was written
```

from:

```text
what is true now
```

---

## 2. ADR 0046 status and stale operational statements

`docs/adr/0046-npm-publish-process-and-security.md` currently has:

```text
Status: Proposed | Accepted
```

Resolve this to the actual current status.

Do not maintain two mutually exclusive statuses.

The ADR already contains later reconciliation material. Preserve the history of the decision, but remove or annotate current-tense statements in alternatives/consequences that now incorrectly imply:

- publishing is manual;
- no CI exists;
- CI publication is hypothetical.

Do not rewrite legitimate historical reasoning merely to make the document sound current.

---

## 3. Confinement documentation

The top-level comment in:

```text
src/adapters/process/bubblewrap.ts
```

still says that missing Bubblewrap causes execution to continue unsandboxed with a warning.

That is no longer an accurate description of the mutating-agent policy.

Inspect the actual implementation in `confinement.ts` and the launch seam before editing.

The documentation must reflect the real precedence:

```text
Bubblewrap
    ↓ if unavailable
supported agent-native sandbox
    ↓ if unavailable
explicit operator consent
    ↓ if absent
BLOCK
```

Be precise about scope.

If read-only/reviewer execution follows different semantics, document that distinction instead of making a broader claim than the code enforces.

Do not alter confinement behavior in this mission unless a genuine implementation/documentation contradiction reveals a bug.

---

## 4. Node-version statements

`package.json`, README development instructions, CI, coverage tooling, and `scripts/verify-local.sh` currently describe several different Node requirements.

Inspect the actual requirements and distinguish at least:

```text
supported runtime floor
ordinary development/test floor
coverage/test-tooling floor
CI-selected version
```

Do not collapse them into one number if they are legitimately different.

Fix comments/messages that claim, for example, that `package.json` requires Node >=20 when that is not what the manifest says.

If `verify-local.sh` actually permits an unsupported runtime, correct the guard.

If >=20 is intentionally sufficient for a limited verifier path, document what that means rather than calling it the package requirement.

Do not raise the public runtime floor merely to simplify documentation.

---

## 5. ESLint result wording

The static-analysis script currently permits a warning budget while printing language equivalent to:

```text
PASS: ESLint clean
```

Do not change the warning policy in this mission.

Make the output truthful.

For example, distinguish:

```text
no ESLint errors
```

from:

```text
zero ESLint warnings
```

Do not represent an allowed warning budget as a clean zero-warning result.

---

## 6. README image publication contract

The npm package ships the README but does not ship `docs/assets/`.

The first-value demo therefore intentionally uses an absolute URL of the form:

```text
https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/...
```

Preserve this behavior.

Audit user-facing README images and ensure none depend on a relative repository path that works on GitHub but is broken when npm renders the packaged README.

If there is already a suitable documentation verifier for README asset contracts, extend it narrowly.

Otherwise add only a small deterministic check if it materially prevents regression.

Do not introduce a general Markdown framework.

---

# General documentation rules

For every changed statement:

1. inspect the implementation or authoritative configuration;
2. describe only what it actually guarantees;
3. retain important limitations;
4. avoid promotional strengthening as part of cleanup.

In particular do not silently upgrade:

```text
preferentially different reviewer
```

into:

```text
independent reviewer guaranteed
```

or:

```text
configured verification
```

into:

```text
correctness guaranteed
```

or:

```text
operator consent required for an otherwise-unconfined mutating launch
```

into a broader security guarantee.

---

# Out of scope

Do not:

- redesign the README;
- change product positioning;
- add the velocity graph;
- change release architecture;
- change SemVer policy;
- change lint policy;
- refactor production architecture;
- change agent lifecycle behavior;
- add new product capabilities;
- rewrite all ADRs for stylistic consistency.

---

# Verification

Run the narrow documentation/static checks appropriate to changed files plus the repository's normal required gate.

At minimum verify:

- documentation verification passes;
- README links/images remain syntactically valid;
- package-content verification still passes;
- no changed statement contradicts current CI/release/confinement configuration.

If a runtime check was changed, add or update the smallest test covering that behavior.

---

# Completion evidence

Final checkpoint must list:

```text
stale statement
→ authoritative implementation/configuration checked
→ corrected statement
```

Also list any suspicious statement intentionally left unchanged and why.

Do not finish with merely:

```text
documentation updated
```
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
