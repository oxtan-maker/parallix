# Mission: Add macOS and Windows process-start identities (task-2373.01)

## Goal
Prevent a live process with a recycled PID from being mistaken for the process that originally started a managed agent on native macOS and Windows, while preserving the current Linux and WSL behavior and safe expiry fallback.

## Why Now
PID reuse is already distinguished on Linux through `/proc/<pid>/stat` field 22, but native macOS and Windows currently rely on PID liveness plus TTL expiry. That leaves those platforms with a platform-specific correctness gap for long-lived or rapidly reused PIDs.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: native per-PID start-time lookup, platform selection, conservative unreadable-data fallback, focused platform-aware tests

## Scope
- Add a native macOS lookup that obtains a start identity for one supplied PID without enumerating the process table.
- Add a native Windows lookup that obtains a start identity for one supplied PID without enumerating the process table.
- Route process identity capture and comparison through those lookups on their respective native platforms.
- Preserve the existing `/proc/<pid>/stat` field-22 identity behavior for Linux and WSL.
- Treat unavailable, malformed, inaccessible, or unsupported identity data as no identity: continue PID-only liveness behavior and let existing TTL expiry govern cleanup.
- Add focused mocked tests for macOS, native Windows, Linux/WSL preservation, identity mismatch, and fallback.

## Out of Scope
- Changing process ownership, session semantics, TTL values, or the existing cross-platform PID liveness check.
- Supporting additional operating systems or adding a process-table scan, persistent identity store, or new runtime dependency.
- Changing public CLI commands, workflow contracts, or user documentation unless implementation reveals a user-visible behavior change.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- On macOS, the process-start identity code reads identity data only for the requested PID and rejects a live PID whose observed identity differs from the stored identity.
- On native Windows, the process-start identity code reads identity data only for the requested PID and rejects a live PID whose observed identity differs from the stored identity.
- Linux and WSL continue to use `/proc/<pid>/stat` field 22 as their process-start identity source.
- If identity data is unreadable, malformed, inaccessible, or unsupported, liveness remains PID-only and TTL expiry remains available rather than reporting a false identity match or throwing.
- Focused tests cover matching identity, mismatching identity, and fallback for macOS and native Windows, plus Linux/WSL source preservation.
- `./scripts/verify-local.sh all` succeeds on the completed implementation.

## Risks and Assumptions
- Assumption: platform-native utilities or Node facilities can expose a per-PID start time without adding a dependency or listing processes.
- Risk: native command output and permissions vary by OS version; parsers must fail closed to the existing PID-only fallback rather than treating partial output as an identity.
- Risk: WSL can report Linux platform details while running Windows-hosted workflows; retain its established `/proc` path rather than treating it as native Windows.
- Risk: test execution runs on one host OS; platform behavior must be tested through controlled mocks without invoking real process-management tooling.

## Checkpoints
- CP 1: Trace the existing process liveness and start-identity flow, then add the smallest per-PID macOS and native Windows identity lookups with conservative parse and access failure handling.
- CP 2: Add focused mocked platform-aware tests for match, PID reuse mismatch, unreadable identity fallback, and Linux/WSL preservation; run the mission verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST begin its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.

Each checkpoint document MUST include a concise account of the implemented platform branch or test scenario, then the exact heading `## Goal Check` followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| macOS per-PID identity behavior | exact test name and test file path | PASS / FAIL |
| Windows per-PID identity behavior | exact test name and test file path | PASS / FAIL |
| Linux and WSL preservation | exact test name and test file path | PASS / FAIL |
| Fallback and verification | exact fallback test name and `./scripts/verify-local.sh all` | PASS / FAIL |

Include one evidence row for every Success Criterion, using actual references rather than the sample text above. Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted test name, ADR reference, test path, or recognized repository command/path. End with a specific `Next action:` describing the remaining platform branch, test case, or verification step.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not add dependencies, process-table enumeration, background polling, or external process-management services.
- Do not alter Linux or WSL identity semantics, TTL policy, public CLI behavior, or unrelated workflow code.
- Keep tests hermetic: mock platform and process-identity dependencies; do not invoke real Forgejo, real platform process commands, or expensive agent workflows.

## Stop Rules
- Stop and request direction if a native macOS or Windows per-PID identity cannot be obtained without a process-table scan, a new dependency, elevated privileges, or a public-contract change.
- Stop and request direction if preserving Linux/WSL behavior requires changing the existing `/proc/<pid>/stat` field-22 contract.
- Stop and request direction if a safe fallback conflicts with existing process cleanup or TTL semantics.
