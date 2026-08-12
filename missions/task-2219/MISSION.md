# Mission: Extract Forgejo API transport from workflow operations (task-2219)

## Goal
Separate Forgejo's synchronous and asynchronous HTTP transport from `lib/tools/forgejo.ts` into one focused transport module, while retaining the existing public API, request semantics, error normalization, and injection seams used by Forgejo workflow operations.

## Why Now
`forgejo.ts` currently combines configuration and authentication resolution, Curl execution, HTTP response handling, pull-request and review operations, Git remote synchronization, and merge reconciliation in one large module. Isolating the transport boundary makes those responsibilities easier to test without changing the Forgejo workflow behavior that depends on them.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: extract the Curl/request-response boundary; preserve the `forgejo.ts` compatibility surface; add focused deterministic tests for both synchronous and asynchronous transport failure modes; constrain the final diff to 250–500 added-plus-deleted lines where feasible.

## Scope
- Create one focused Forgejo API transport module containing `forgejoApi`, `forgejoApiAsync`, and only helpers that construct requests, invoke Curl/the injected runner, parse responses, enforce existing timeout behavior, and normalize transport errors.
- Change `lib/tools/forgejo.ts` to consume the extracted transport while continuing to publicly export `forgejoApi` and `forgejoApiAsync`.
- Retain in `lib/tools/forgejo.ts` settings and authentication resolution, token discovery, pull-request/review/comment operations, Git remote work, review polling, and merge-state synchronization.
- Add focused mocked unit coverage for synchronous and asynchronous success, non-2xx response, malformed JSON, runner/request failure, and timeout behavior.
- Update generated runtime artifacts only when the repository's established build/verification workflow requires them.

## Out of Scope
- Replacing Curl with another HTTP client or changing its process-level transport design.
- Changing Forgejo authentication, token discovery, token storage, request credentials, or configuration semantics.
- Changing pull-request, review, comment, polling, merge, or Git remote synchronization behavior.
- Adding networked Forgejo tests, changing unrelated workflow modules, or broad restructuring of `forgejo.ts` beyond the transport extraction.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `forgejoApi` and `forgejoApiAsync`, together with only transport-specific helpers, are defined in one dedicated Forgejo API transport module; the domain operations listed in Scope remain in `lib/tools/forgejo.ts`.
- `lib/tools/forgejo.ts` continues to publicly export both `forgejoApi` and `forgejoApiAsync`, and existing internal callers use the preserved exports or the extracted module without an API break.
- For both synchronous and asynchronous paths, tests demonstrate unchanged request method and URL construction, authorization-header handling, JSON-body behavior, timeout behavior, response parsing, returned `status`/`statusCode` fields, and normalized error text.
- Focused mocked tests cover, for each path where applicable, successful responses, non-2xx responses, malformed JSON, process-runner/request failures, and timeout behavior; those tests make no real Forgejo network call.
- `./scripts/verify-local.sh static-analysis` completes successfully on the final tree, with no focused or unannotated skipped tests and no `.only` introduced by this mission.
- Excluding `graphify-out/`, `git diff --numstat` reports 250–500 total added-plus-deleted lines. If the measured total is outside that interval, the final checkpoint records the total, the reason, and the scope-reduction attempt.

## Risks and Assumptions
- Moving helpers can accidentally alter injection timing or which runner implementation is used; preserve the existing dependency-injection boundary and prove it with mocked tests.
- Transport error strings and status fields may be consumed outside the immediate module; retain their current shape and text, including malformed-response and non-2xx cases.
- Curl timeout and asynchronous failure behavior can differ subtly from synchronous behavior; test both paths independently rather than assuming shared helpers prove both.
- The stated diff budget assumes a focused extraction; generated runtime artifacts required by repository convention count toward the budget.

## Checkpoints
- CP 1: Map the current `forgejoApi`/`forgejoApiAsync` call surface, their transport-only helpers, injection seams, and existing Forgejo tests. Record which helpers will move and which domain responsibilities will remain in `lib/tools/forgejo.ts` before editing implementation code.
- CP 2: Extract the synchronous and asynchronous transport into the dedicated module, preserve re-exports from `lib/tools/forgejo.ts`, and keep all settings/authentication, domain operations, Git operations, and merge synchronization there.
- CP 3: Add or refine mocked transport tests for synchronous and asynchronous success, non-2xx, malformed JSON, runner/request failure, and timeout cases. Confirm tests do not call a real Forgejo instance.
- CP 4: Run the static-analysis gate, inspect `git diff --numstat` excluding `graphify-out/`, complete the Goal Check with durable evidence, and record any justified diff-budget exception and scope-reduction attempt.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead every evidence entry with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Use exact test names for the synchronous and asynchronous transport cases and their test file paths; cite `./scripts/verify-local.sh static-analysis` for the final verification and `git diff --numstat` for the diff-budget measurement.
- File:line references are accepted when necessary but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; when used as supplemental context, pair it with an accepted command, path, exact test name, or ADR reference above.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with the exact header `| Criterion | Evidence | Status |` and at least one evidence row for every success criterion.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not replace Curl, change authentication/token behavior, alter Forgejo workflow semantics, or refactor Git remote synchronization.
- Do not introduce real Forgejo network access in unit tests; tests must mock the process runner/request implementation.
- Keep the extraction bounded to the dedicated transport module, `lib/tools/forgejo.ts`, focused Forgejo tests, and required generated runtime artifacts.
- Do not change the public `forgejoApi` or `forgejoApiAsync` export contract from `lib/tools/forgejo.ts`.

## Stop Rules
- Stop and request direction if preserving the current transport behavior requires a public API change or a change to Forgejo authentication/token handling.
- Stop and request direction if the extraction requires replacing Curl, changing Git remote synchronization, or changing pull-request, review, comment, polling, or merge semantics.
- Stop and report the evidence if deterministic mocked tests cannot reproduce an existing synchronous or asynchronous transport behavior without contacting a real Forgejo server.
- Stop and request scope guidance if the smallest behavior-preserving extraction cannot reasonably be reduced toward the 250–500 added-plus-deleted-line budget after excluding `graphify-out/`.
