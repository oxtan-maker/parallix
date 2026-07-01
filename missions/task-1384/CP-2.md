# CP-2: Failure-class matrix

Incomplete-work / hallucination classes mapped to current handling and proposed auto-repair / auto-send-back / human-only outcomes.

## Failure-Class Model

### Class 1: Unverifiable "tests passed" claims

**Description:** Agent claims tests passed in prose output but the verification gate was not mechanically executed, or the gate exit code was non-zero.

| Attribute | Value |
|-----------|-------|
| Current handling | Gate runs at checkpoint (`checkpoint.js:44`), handoff (`handoff.js:200`), review --verify (`review-commands.js:439`), and integrate (`integrate.js:742`). However, gate is not enforced before each review round (task-1268 gap). `--no-gate` bypass available at every phase. |
| Current gap | Pre-review-round enforcement missing. An agent can hand off with a green gate, then reviewer finds issues, sends back, agent "fixes" and re-submits without gate re-run. |
| Proposed outcome | **Auto-send-back**: Run gate mechanically before each review round. On failure, auto-bounce to implementer with captured gate output as fix prompt. No reviewer cycle consumed. |
| Rationale | The gate exit code is deterministic and trustworthy. An agent's textual claim is never sufficient. This is the task-1268 shift-left concept. |

### Class 2: Malformed or non-runnable declared gates

**Description:** The `## Gates` section in MISSION.md contains commands that are not syntactically valid shell commands, reference non-existent scripts, or fail for environmental reasons unrelated to the mission's code quality.

| Attribute | Value |
|-----------|-------|
| Current handling | `runDeclaredGates` (`handoff.js:429-480`) executes each gate line as a bash command. Invalid commands fail at execution time with a non-zero exit code. |
| Current gap | No pre-validation. A gate typo (e.g., `./script/verify-local.sh` instead of `./scripts/verify-local.sh`) blocks handoff with a confusing shell error. The error is not classified differently from a genuine gate failure. |
| Proposed outcome | **Auto-repair**: Before executing, validate each gate command is syntactically parseable and that referenced files exist. On validation failure, report the specific issue and auto-send-back to the implementer (or the mission author) with a fix instruction. |
| Rationale | Gate validation is a static check (file existence, basic syntax). Failing early with a clear message is better than failing mid-handoff with a shell error. |

### Class 3: Missing mandatory mission artifacts

**Description:** MISSION.md, checkpoint documents (CP-*.md), or backlog task file are absent at handoff time.

| Attribute | Value |
|-----------|-------|
| Current handling | Gatekeeper (`gatekeeper.js:61-88`) checks for these at handoff step 2.5. On missing artifacts, posts a "request-changes" review pushback and keeps task in 'active' state (`handoff.js:324-339`). Auto-checkpoint generation exists for missing CP-*.md (`handoff.js:103-126`). |
| Current gap | Gatekeeper blocks Backlog transition but does not auto-send-back to the implementer or relaunch the agent. The task strands in 'active' until a human or the next `px active` invocation. |
| Proposed outcome | **Auto-send-back**: When gatekeeper detects missing artifacts, auto-send-back to implementer with explicit instructions listing which artifacts to create. Relaunch agent if automated execution context is available. |
| Rationale | Missing artifacts are unambiguously the implementer's responsibility. No human judgment needed. |

### Class 4: Incomplete checkpoint evidence / uncommitted checkpoint state

**Description:** The final checkpoint exists but lacks a `## Goal Check` section, has an empty goal-check table, or checkpoint files are uncommitted.

| Attribute | Value |
|-----------|-------|
| Current handling | Handoff checks for Goal Check heading (`handoff.js:141-147`) and evidence rows (`handoff.js:152-179`). Uncommitted checkpoints blocked at `handoff.js:131-135`. The "no evidence rows" error is classified as relaunchable (`repair-handoff.js:12-19`), triggering agent relaunch with fix prompt (`active.js:462-483`). Uncommitted files trigger auto-commit repair (`repair-handoff.js:106-191`). |
| Current gap | Coverage is narrow: only "no evidence rows" is relaunchable. Missing `## Goal Check` heading is not. Auto-commit only handles mission-safe artifacts. |
| Proposed outcome | **Auto-send-back**: Expand `isRelaunchableError` to cover all checkpoint evidence failures (missing heading, empty table, insufficient evidence rows). Relaunch agent with specific fix prompt for each sub-class. |
| Rationale | These are all agent-fixable content errors. The fix prompt already exists for one sub-class; extending it to the others is incremental. |

### Class 5: Mechanical git/handoff blockers (dirty files, rebase needed)

**Description:** Uncommitted mission artifacts, branch behind primary, rebase conflicts on mission-only files.

| Attribute | Value |
|-----------|-------|
| Current handling | `repairHandoff` (`repair-handoff.js:82-226`) auto-commits safe mission artifacts and auto-rebases. On success, retries handoff with `force: true` (`active.js:457`). On conflict or unsafe files, returns blocker. |
| Current gap | Rebase conflicts on shared files (non-mission paths) are not auto-resolved. The error message is generic ("not automatically repairable") with no dispatch to a more specific handler. |
| Proposed outcome | **Auto-repair** for mission-only conflicts. **Human-only** for shared-file conflicts (these indicate integration-level issues). Improve error classifier to distinguish conflict types. |
| Rationale | Mission-only conflicts can be auto-resolved by accepting the agent's changes. Shared-file conflicts require human judgment about which side to keep. |

### Class 6: Genuine implementation failures (gate fails on real code issues)

**Description:** The verification gate fails because the agent's code changes broke lint, typecheck, or tests. This is distinct from Class 1 (unverifiable claims) because the gate actually ran and produced a real failure.

| Attribute | Value |
|-----------|-------|
| Current handling | Gate failure at handoff returns `{ ok: false }` with message "Fix errors before submitting" (`handoff.js:208`). The error is not classified as relaunchable by `isRelaunchableError`. The agent is not relaunched with the gate output. |
| Current gap | Gate failures strand. The agent is not given the gate output and asked to fix the code. This is the single largest consumer of human time — the human must manually re-invoke the agent with the failure output. |
| Proposed outcome | **Auto-send-back**: Capture gate stdout/stderr, classify as "gate failure — code issue", relaunch implementer with the captured output as a fix prompt. Limit relaunch attempts (e.g., max 2) to avoid infinite loops. |
| Rationale | Gate output is sufficient for an agent to diagnose and fix most lint/typecheck/test failures. This is the highest-ROI improvement. |

### Class 7: Forgejo/review-surface blockers (token missing, PR creation failed, sync-merged failure)

**Description:** Infrastructure issues with the Forgejo review surface — missing tokens, failed PR creation, failed sync-merged during integration.

| Attribute | Value |
|-----------|-------|
| Current handling | Token bootstrap attempted (`handoff.js:249-293`), fallback to 'human' user if bootstrap fails. Sync-merged diagnostics table in `integrate.js:22-28`. |
| Current gap | These are infrastructure issues, not agent code quality issues. But they block the workflow with the same generic error path. |
| Proposed outcome | **Human-only**: Forgejo infrastructure issues require human intervention (start service, create token, fix network). The harness should clearly classify these as "infrastructure blocker — human action required" rather than letting them fall into the generic error path. |
| Rationale | No amount of agent relaunching will fix a missing Forgejo service. Clear classification prevents wasted relaunch attempts. |

### Class 8: Task status / state machine violations

**Description:** Backlog task is in wrong state for the attempted operation (e.g., trying to hand off a 'done' task, trying to integrate a 'backlog' task).

| Attribute | Value |
|-----------|-------|
| Current handling | Checked during handoff (`handoff.js:84-89`), review verification (`review-commands.js:382-401`), and integration preflight (`integrate.js:1079-1088`). |
| Current gap | State violations are reported but not dispatched to a corrective action. |
| Proposed outcome | **Human-only**: State machine violations usually indicate a workflow confusion (e.g., task was already integrated by someone else). Human must determine the correct state. |
| Rationale | Automatically transitioning tasks between states without understanding why they're in the wrong state could mask real workflow issues. |

## Decision Matrix Summary

| # | Failure Class | Current Handling | Proposed | Priority |
|---|---------------|-----------------|----------|----------|
| 1 | Unverifiable "tests passed" claims | Gate at checkpoint/handoff/integrate; no pre-review-round enforcement | Auto-send-back | High (task-1268) |
| 2 | Malformed declared gates | Fail at execution time | Auto-repair (validate first) | Medium |
| 3 | Missing mandatory artifacts | Gatekeeper blocks transition; strands | Auto-send-back | Medium |
| 4 | Incomplete checkpoint evidence | Partial relaunch (1 of 3 sub-classes) | Auto-send-back (all sub-classes) | Medium |
| 5 | Mechanical git blockers | Auto-commit/rebase for safe files | Auto-repair (mission-only); Human (shared) | Low (mostly covered) |
| 6 | Genuine gate failure (code issues) | Strands with generic error | Auto-send-back with gate output | High |
| 7 | Forgejo/infra blockers | Bootstrap fallback; generic error | Human-only (clear classification) | Low |
| 8 | Task state violations | Report and block | Human-only | Low |

Next action: Write ADR 0048 with the full inventory, decision matrix, and implementation recommendations. Rewrite parent and child backlog tasks to reflect the ADR plan (CP-3).
