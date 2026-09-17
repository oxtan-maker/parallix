# Mission: Preserve raw squash payload paths (task-2533)

## Goal
Make `px integrate` land a mission payload containing a backslash or non-ASCII
filename by carrying its changed paths as raw Git pathspecs rather than
Git-quoted display strings.

## Why Now
Task-2521.01 exposed a landing failure after all mission work had completed:
the squash commit rejected a Git-quoted payload filename. Existing task files
already include names Git quotes, so later integrations can hit the same abort.
The shared capture that prevents this already uses Git's `-z` raw-path protocol;
this mission guards that protocol with a regression test rather than changing
production code.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one shared payload-path capture in the squash integration flow
  and one focused regression test covering Git's quoted versus NUL-delimited
  filename output.

## Scope
- Add a regression guard at `test/task-2533-squash-payload-pathspec-quotes.test.ts`
  using a throwaway Git repository and a payload filename Git quotes in
  line-delimited `--name-only` output.
- Confirm the shared squash payload capture in `src/application/integrate/squash.ts`
  already requests NUL-delimited cached changed paths (`git diff --cached
  --name-only -z --`) and parses those raw paths for both the scoped squash
  commit and intended-payload check. No production change was required: this
  NUL-delimited protocol was introduced by task-2525.02 (commit `fd6b0d485`),
  ~1.75h before the mission parent `b791205`.
- Preserve the existing payload set and `git commit --only -- <paths>` scoping.

## Out of Scope
- Changing the integration workflow, closeout path generation, commit message,
  or bare-board concurrency behavior.
- Renaming existing files with special characters or normalizing filenames.
- Changing other Git command output parsing outside the squash payload flow.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test asserts, in a throwaway repository, that Git's line-
  delimited `--name-only` output quotes special filenames and that the quoted
  form cannot serve as the scoped commit pathspec, and that the raw NUL-delimited
  form commits the same path. It guards the shared capture against a future
  regression to quoted `--name-only` output; it is not a red-to-green production
  reproduction, since the `-z` protocol already existed at the mission parent.
- `src/application/integrate/squash.ts` obtains its cached changed-file payload
  with `git diff --cached --name-only -z --` and uses NUL-separated raw paths,
  excluding only the terminal empty entry.
- A payload containing a backslash or non-ASCII filename reaches the squash
  commit without a `pathspec did not match any git-known files` failure.
- Ordinary ASCII payload paths retain the same intended payload set and remain
  scoped through `git commit --only -- <paths>`.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: Git's `-z` output is the raw filename protocol needed by every
  Git invocation that consumes the captured set.
- Risk: trimming parsed entries could alter valid filenames containing leading
  or trailing whitespace; parse only the NUL separator and terminal empty
  record.
- Risk: the integration test must remain in the CI-safe tier by using only a
  local throwaway repository and no Forgejo or agent process.

## Checkpoints
- CP 1: Author `test/task-2533-squash-payload-pathspec-quotes.test.ts` before
  changing production code. In a throwaway repository, create a staged payload
  file whose name Git quotes in line-delimited `--name-only` output; assert
  that using that quoted value with `git commit --only --` fails at the mission
  parent commit (red), while committing the raw NUL-delimited path is the
  intended green behavior after the fix.
- CP 2: Update only the shared squash payload capture and parsing so raw
  NUL-delimited paths feed both the squash commit and intended-payload check.
- CP 3: Run the required verification gate and record criterion-by-criterion
  evidence in the final checkpoint.

Reproduction-Test: test/task-2533-squash-payload-pathspec-quotes.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead each evidence row with durable evidence Parallix verifies today: an exact
  test name, an ADR reference, a test file path, or a recognized repository
  command/path such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
  File:line references are accepted when needed but discouraged because line
  numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table:

  | Criterion | Evidence | Status |
  |---|---|---|

- At least one durable evidence row for every success criterion, including
  `test/task-2533-squash-payload-pathspec-quotes.test.ts` and the exact test
  name for the red-to-green reproduction where applicable.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell
  output with an accepted durable reference above.
- A non-generic `Next action:` line at the bottom.


## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter integration semantics beyond decoding the captured Git filename
  stream; retain `--cached --name-only` selection and `--only` commit scoping.
- Do not modify workflow configuration, mission lifecycle code, or existing
  backlog filenames as part of this fix.
- Do not add a dependency or a Git-output parser abstraction for this single
  NUL-delimited stream.

## Stop Rules
- Stop and report if the reproduction cannot demonstrate Git-quoted
  line-delimited output on the supported local Git version.
- Stop and request direction if making the regression CI-safe requires Forgejo,
  a real agent, or a workflow configuration change.
- Stop and request direction if raw NUL-delimited parsing exposes a requirement
  to support NUL bytes within filenames, which Git paths cannot contain.
