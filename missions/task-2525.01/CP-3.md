# CP 3 — Regular-Expression Findings (`S5850`)

## Summary

Repaired the regular-expression findings in the `S5850` class (implicit
anchor/alternation precedence): regex literals of the form
`/^['"]|['"]$/g` / `/^-+|-+$/g` / `/^-|-$/g` where the `^`/`$` anchors were
scoped only to one side of an alternation. The anchor scope is now made
explicit with non-capturing groups:

```ts
/^['"]|['"]$/g   ->   /(?:^['"])|(?:['"]$)/g
^-+|-+$/g        ->   /(?:^-+)|(?:-+$)/g
^-|-$/g          ->   /(?:^-)|(?:-$)/g
```

The rewrite is behavior-preserving: for these patterns the anchors already bound
each alternative correctly, so grouping changes nothing about matched text.
Files repaired:
- `src/adapters/backlog/task-file-io.ts` (frontmatter value parsing)
- `src/adapters/backlog/task-metadata.ts` (assignee / label parsing, 5 sites)
- `src/adapters/cli/commands/draft-setup.ts` (`slugifyDraftIntent`)
- `src/adapters/review/review-events.ts` (`sanitizeFilename`)
- `src/application/handoff-command-use-case.ts` (path token cleaning)
- `src/application/projections/bug-frequency.ts` (`stripQuotes`)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| S5850 anchor scope made explicit | `git diff` shows `/^['"]|['"]$/g` -> `/(?:^['"])|(?:['"]$)/g` in `src/adapters/backlog/task-metadata.ts` (5 sites), `draft-setup.ts`, `review-events.ts`, `handoff-command-use-case.ts`, `task-file-io.ts`, `bug-frequency.ts` | PASS |
| Repairs behavior-preserving | `test/sonarqube-reliability-repairs.test.ts`, `"slugifyDraftIntent trims only leading and trailing hyphens"`, `"parseAssigneeFamilies strips leading and trailing quotes only"` | PASS |
| SC4 — no rule disabled | grep `sonar.comments`/`@sonar`/`sonar.exclusions` in changed tree yields none | PASS |
| Full suite green | `` `npm test` `` → 2636 pass, 0 fail | PASS |

## Next action

CP-4: repair the control-character findings (`S6324`) by removing literal
control characters from source and detecting them by code point.
