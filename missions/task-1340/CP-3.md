# CP-3: ADR drafted

## Work Done

Created ADR 0046 documenting the npm registry publication process for `@magnusekdahl/parallix`.

### ADR contents:

1. **Registry publish steps** (6-step procedure): clean tree check → version verify → dry-run inspection → publish → verify publication → git tag
2. **npm token security**: token storage in `~/.npmrc`, fine-grained token recommendations, environment variable usage, rotation procedure
3. **Package content review procedure**: pre-publish checklist with 10 items, automated content audit shell script, post-publish verification procedure
4. **Rollback considerations**: npm unpublish limitations, mitigation strategies (private scope first, yank, semver discipline, git tagging), rollback procedure
5. **Security posture**: zero runtime dependencies, AGPL-3.0-or-later license implications, automatic ECDSA registry signatures, dependency audit

### ADR metadata:

- Status: `Proposed` (consistent with other ADRs in the repo)
- Date: 2026-06-23
- Cross-references: ADR 0044, task-1340

### Index updated:

Added ADR 0046 entry to `docs/adr/index.md` (line 17).

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| ADR exists in `docs/adr/` | `docs/adr/0046-npm-publish-process-and-security.md` (243 lines) |
| Listed in `docs/adr/index.md` | index.md:17 → `docs/adr/0046-npm-publish-process-and-security.md` |
| Status: Proposed or Accepted | index.md:17 line → Status: Proposed |
| Covers registry publish steps | ADR lines 61-88 |
| Covers npm token security | ADR lines 90-118 |
| Covers package content review | ADR lines 120-168 |
| Covers rollback considerations | ADR lines 170-210 |
| Covers security posture | ADR lines 212-238 |

## Next action

Proceed to CP-4: document the one-command install path in README.md.
