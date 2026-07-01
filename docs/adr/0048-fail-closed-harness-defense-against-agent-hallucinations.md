# ADR 0048: Fail-closed harness defense against agent hallucinations

Status: Accepted
Date: 2026-06-29

Related: ADR 0041 (integration pipeline gates), ADR 0047 (NEL budget), task-1268 (shift-left verification), task-1335 (harden publish path)

## Context

Parallix already has meaningful defenses against agent hallucinations and incomplete work, but they are fragmented across commands and missions rather than expressed as one coherent harness policy. The repo has exact-tree verification proof (task-1335), handoff pre-checks, gatekeeper mandatory-artifact checks (gatekeeper.js), integration-time gates (ADR 0041), and a narrow auto-repair path (repair-handoff.js). It also has open work on shift-left verification (task-1268).

What it does not yet have is one explicit answer to a repository-level question: **given a failed or incomplete agent handoff, which failure classes should auto-repair, which should auto-send-back to the implementer, and which genuinely require human intervention?**

The current `repair-handoff.js` handles only two mechanical error classes (dirty mission artifacts, branch behind primary) and one relaunchable content error (empty goal-check table). All other failures — including genuine gate failures on code issues, the single largest consumer of human time — strand with a generic "not automatically repairable" message that requires manual re-invocation.

This ADR consolidates the existing evidence, classifies the failure modes, and recommends a fully backlog-tracked implementation plan for fail-closed harness behavior. Nothing in the recommended control set is left as an untracked "defer later" idea: every control gets an explicit backlog task, even when the runtime outcome remains "human required".

## Inputs

This decision draws on four prior Parallix artifacts:

1. **Task-1268** (`backlog/tasks/task-1268 - Shift-left.md`): Shift-left verification concept — run the verification gate mechanically before each review round, auto-bounce on failure without consuming a reviewer cycle. Key insight: the machinery exists (`captureVerifiedTreeProof` / `assertVerifiedTreeProof` in `lib/core/verification.js`), but enforcement before review rounds is missing.

2. **Task-1335** (`backlog/completed/task-1335 - Harden-parallix-self-hosting-publish-path...md`): Exact-tree verification proof, implemented and completed. Established the principle that a verification proof must be tied to the exact tree being published — a green run from a different checkout, commit, or pre-squash state cannot satisfy the guard.

3. **ADR 0041** (`docs/adr/0041-integration-pipeline-gates.md`): Integration-time pipeline gates with per-area dispatch, config-driven gate plan, and `--no-integration-gates` escape hatch. Established the pattern of gate execution before squash-merge.

4. **ADR 0047** (`docs/adr/0047-per-mission-change-size-budget.md`): NEL budget with observational capture at handoff. Demonstrates the pattern of observational instrumentation without enforcement — a template for what NOT to do when enforcement is needed.

## Inventory of Existing Checks

The following checks are currently implemented across the harness lifecycle. Each is mapped to the failure class it catches.

### Before Handoff

| # | Check | Location | Failure Class |
|---|-------|----------|---------------|
| 1 | Verification gate at checkpoint | `lib/commands/checkpoint.js:44` | Unverifiable test claims (Class 1) |
| 2 | Checkpoint existence validation | `lib/commands/active.js:386-391` | Missing artifacts (Class 3) |
| 3 | Checkpoint committed check | `lib/commands/active.js:407-414` | Uncommitted state (Class 4) |

### During Handoff

| # | Check | Location | Failure Class |
|---|-------|----------|---------------|
| 4 | Mission branch verification | `lib/commands/handoff.js:37-39` | Git blockers (Class 5) |
| 5 | MISSION.md existence | `lib/commands/handoff.js:42-44` | Missing artifacts (Class 3) |
| 6 | MISSION.md uncommitted check | `lib/commands/handoff.js:96-99` | Uncommitted state (Class 4) |
| 7 | Auto-checkpoint generation | `lib/commands/handoff.js:103-126` | Missing artifacts — auto-repair (Class 3) |
| 8 | Goal Check heading validation | `lib/commands/handoff.js:141-147` | Incomplete evidence (Class 4) |
| 9 | Goal Check evidence rows | `lib/commands/handoff.js:152-179` | Incomplete evidence (Class 4) |
| 10 | Verification gate execution | `lib/commands/handoff.js:200-209` | Gate failure (Class 1, 6) |
| 11 | Rebase onto primary | `lib/commands/handoff.js:214-229` | Git blockers (Class 5) |
| 12 | Gatekeeper mandatory artifacts | `lib/commands/handoff.js:322-335` | Missing artifacts (Class 3) |
| 13 | Declared gates execution | `lib/commands/handoff.js:429-480` | Gate failure (Class 2, 6) |

### Before Review

| # | Check | Location | Failure Class |
|---|-------|----------|---------------|
| 14 | Mission dir + branch + status | `lib/review/review-commands.js:367-401` | State violations (Class 8) |
| 15 | PR existence and state | `lib/review/review-commands.js:403-430` | Infra blockers (Class 7) |
| 16 | Verification gate | `lib/review/review-commands.js:438-445` | Gate failure (Class 1, 6) |

### During Integration

| # | Check | Location | Failure Class |
|---|-------|----------|---------------|
| 17 | Integration preflight | `lib/commands/integrate.js:500-504` | Multiple classes |
| 18 | Integration gates | `lib/commands/integrate.js:507-534` | Gate failure (Class 6) |
| 19 | Exact-tree proof capture | `lib/commands/integrate.js:742-749` | Unverifiable claims (Class 1) |
| 20 | Exact-tree proof assertion | `lib/commands/integrate.js:753-757` | Stale proof (Class 1) |

### Repair Path

| # | Mechanism | Location | Coverage |
|---|-----------|----------|----------|
| 21 | Auto-commit mission artifacts | `lib/commands/repair-handoff.js:130-191` | Dirty mission files only (Class 5) |
| 22 | Auto-rebase | `lib/commands/repair-handoff.js:194-223` | Simple rebase only (Class 5) |
| 23 | Agent relaunch (empty goal-check) | `lib/commands/active.js:462-483` | Single error sub-class only (Class 4) |

**Total: 23 check points across 5 lifecycle phases.**

## Failure Classification

Eight failure classes have been identified, each classified as auto-repair, auto-send-back, or human-only:

| # | Failure Class | Proposed | Rationale |
|---|---------------|----------|-----------|
| 1 | Unverifiable "tests passed" claims | **Auto-send-back** | Gate exit code is deterministic; agent prose is never sufficient |
| 2 | Malformed or non-runnable declared gates | **Auto-repair** | Static validation (file existence, syntax) can catch before execution |
| 3 | Missing mandatory mission artifacts | **Auto-send-back** | Unambiguously the implementer's responsibility; no human judgment needed |
| 4 | Incomplete checkpoint evidence | **Auto-send-back** | Agent-fixable content errors; fix prompt already exists for one sub-class |
| 5 | Mechanical git/handoff blockers | **Auto-repair** (mission-only); **Human-only** (shared files) | Mission conflicts auto-resolvable; shared-file conflicts require judgment |
| 6 | Genuine gate failure (code issues) | **Auto-send-back** | Gate output sufficient for agent to diagnose; highest-ROI improvement |
| 7 | Forgejo/infra blockers | **Human-only** | No agent relaunch will fix infrastructure issues |
| 8 | Task state machine violations | **Human-only** | State confusion requires human determination of correct state |

## Decision Matrix: Candidate Harness Controls

Seven candidate controls are evaluated and prioritized. The classification column answers backlog treatment, not runtime disposition: every control below is scheduled work with an explicit task.

| # | Candidate Control | Complexity | ROI | Risk | Backlog Treatment |
|---|-------------------|-----------|-----|------|-------------------|
| C1 | Pre-review-round gate enforcement with auto-bounce | Medium | High | Low — gate machinery already exists; enforcement is the missing piece | **Implement now** (`TASK-1385`) |
| C2 | Gate-failure auto-send-back with captured output | Low | High | Low — capture stdout/stderr, build fix prompt, relaunch with retry limit | **Implement now** (`TASK-1387`) |
| C3 | Error classifier and dispatch table replacing generic strand | Medium | Medium | Low — refactor, not new behavior; existing repair-handoff.js is the seam | **Implement now** (`TASK-1389`) |
| C4 | Declared-gate pre-validation (syntax + file existence) | Low | Medium | Low — static check before execution | **Implement next wave** (`TASK-1386`) |
| C5 | Gatekeeper auto-send-back with agent relaunch | Low | Medium | Medium — must avoid relaunch loops when artifacts genuinely cannot be created | **Implement next wave** (`TASK-1388`) |
| C6 | Forgejo/infrastructure blocker classification and operator handoff | Low | Low | Low — mostly classification and operator guidance, but still worth making explicit | **Implement next wave** (`TASK-1392`) |
| C7 | Pre-review checkpoint evidence reference validation | Medium | Low | Medium — keep the check mechanical and avoid semantic-quality scoring | **Implement next wave** (`TASK-1393`) |

### Implement Now (C1, C2, C3)

**C1: Pre-review-round gate enforcement** (task-1268 / task-1385). Run the configured verification gate mechanically before each review round. On gate failure, auto-bounce to the implementer with the gate output as a fix prompt. No reviewer cycle consumed. This is the single highest-impact control because it closes the fail-open path where an agent can hand off with a green gate, receive review feedback, "fix" the code, and re-submit without the gate re-running.

**C2: Gate-failure auto-send-back** (task-1387). When the verification gate fails at handoff time (`handoff.js:200-209`), capture the gate stdout/stderr, classify the error as "genuine gate failure — code issue", and relaunch the implementer with the captured output. Limit relaunch attempts to 2 to prevent infinite loops. This is the highest-ROI single control because it eliminates the most common human-intervention scenario: manually copying gate output and re-invoking the agent.

**C3: Error classifier and dispatch table** (task-1389). Replace the binary `isRelaunchableError` / `isDirtyError` / `isBehind` classification in `repair-handoff.js` with a structured error classifier that maps each error message pattern to a failure class and a dispatch action (auto-repair, auto-send-back with prompt, or human-only with clear message). This is foundational work that makes C1 and C2 cleaner to implement.

### Implement Next Wave (C4, C5, C6, C7)

**C4: Declared-gate pre-validation** (`TASK-1386`). Validate that gate commands reference existing files and are syntactically valid before executing them. This stays after C1-C3 only because the earlier controls close larger fail-open paths first, not because C4 is optional.

**C5: Gatekeeper auto-send-back** (`TASK-1388`). When gatekeeper detects missing mandatory artifacts and the task strands in `active`, auto-send-back to the implementer with explicit artifact creation instructions. The auto-checkpoint generation at `handoff.js:103-126` already covers one sub-case, but the remaining cases still deserve explicit automation and therefore explicit backlog tracking.

**C6: Forgejo/infrastructure blocker classification and operator handoff** (`TASK-1392`). Label Forgejo and related infrastructure failures as "infrastructure — human required", preserve the existing runtime outcome, and make the operator message deterministic and actionable. Human-required runtime behavior is still harness work and therefore still gets a backlog task.

**C7: Pre-review checkpoint evidence reference validation** (`TASK-1393`). Validate that checkpoint evidence rows cite real file:line references, ADR references, or test names rather than placeholder prose. The task must stay mechanical: it should verify reference shape and existence, not attempt to score evidence quality semantically.

## Implementation Order

```
C3 (error classifier) → C2 (gate-failure send-back) → C1 (pre-review gate) → C4 → C5 → C6 → C7
```

C3 first because it provides the dispatch framework that C1 and C2 plug into. C2 before C1 because C2 is lower complexity and higher immediate ROI (handoff-time gate failures are already the blocking point; pre-review-round enforcement adds a new check point). C4-C7 remain sequenced backlog work rather than untracked ideas.

## Consequences

### Positive

- The most common human-intervention scenario (copying gate output and re-invoking agent) is eliminated by C2
- The fail-open path between review rounds is closed by C1 (task-1268)
- Error handling moves from binary (repairable / not) to a classified dispatch table (C3)
- Each failure class has an explicit owner (auto-repair, auto-send-back, or human)

### Negative

- Automatic relaunching (C2) increases compute cost per failed handoff (bounded by retry limit)
- The error classifier (C3) adds a maintenance surface — new error patterns must be classified
- Pre-review gate enforcement (C1) adds wall-time to each review round (bounded by gate duration)

## See Also

- Task-1268: Shift-left verification concept (backlog)
- Task-1335: Exact-tree verification proof (completed)
- ADR 0041: Integration pipeline gates
- ADR 0047: NEL budget (observational pattern)
- `lib/commands/repair-handoff.js`: Current repair path
- `lib/commands/active.js:426-498`: Automated handoff-and-repair flow
