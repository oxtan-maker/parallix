# ADR 0034 — Module and Skill Invocation Model

**Status:** Accepted
**Date:** 2026-04-05

## Context

The repo already has:

- `AGENTS.md` as the authority for hard rules, trust tiers, and verification commands
- `MISSION_FLOW.md` plus mode prompts as the lifecycle and execution surface
- `MISSION.md` as the per-mission execution contract
- `Backlog.md` as the current-state layer
- a Skills layer documented in `docs/ai-workflow/SKILLS_ARCHITECTURE.md`

That architecture made the workflow modular, but it left one governance gap unresolved: how agents should select and re-select workflow modules and skills during execution.

The current state had three weaknesses:

1. the workflow rejected always-loaded optional context, but did not fully define the replacement model
2. some documents implied explicit invocation, but the repo did not yet decide how much should be phase-driven versus self-invoked versus registry-driven
3. no durable decision explained how autonomy, explicitness, debuggability, and validation guarantees should coexist

This matters because the repo is intentionally multi-agent and tool-agnostic. A hidden or runtime-specific invocation model would undermine portability and make debugging difficult. A manual-only model would undermine autonomy. An always-loaded model would grow the default context surface every time the workflow added a new capability.

## Decision Drivers

- Keep default context bounded as the workflow gains more modules
- Preserve autonomy for normal mission execution
- Keep invocation behavior explicit and inspectable
- Avoid hidden runtime-specific or wrapper-specific attachment logic
- Guarantee that validation and review-critical modules cannot be silently skipped
- Keep the model teachable across Claude, Codex, Gemini, and future runtimes
- Avoid introducing a heavier registry/control-plane mechanism before it is justified

## Considered Options

### A. Manual human-triggered invocation

Human explicitly names each optional module or skill to load.

### B. Fully implicit model-driven auto-loading

Runtime heuristics or the model silently decide which modules to attach.

### C. Rule-based self-invocation with explicit declaration

The agent loads optional modules using explicit repo rules and declares each load.

### D. Phase-bound invocation

Lifecycle stage determines which modules are used by default.

### E. Registry-driven invocation

A central registry maps task shape or triggers to module selection.

### F. Context-splitting or subagent invocation

When task shape changes materially, a new context or subagent handles the new slice.

### G. Hybrid of C and D, with stronger guarantees for validation-critical modules

Stage/mode establishes the baseline; the agent may explicitly add modules when trigger rules fire; validation and review-critical modules become mandatory once relevant.

### H. GSD-style harness-mediated architecture

Command entrypoints dispatch into workflow orchestrators, which load template-backed state, helper tooling, and specialized agents behind a compact command façade.

## Comparison Summary

The mission-local analysis artifact contains the full matrix and measurement evidence:

- [Task 019 invocation analysis](../missions/2026/task-019/INVOCATION_MODEL_ANALYSIS.md)

Summary outcome:

- A is explicit but too dependent on the human
- B is flexible but too opaque and runtime-sensitive
- C is strong, but by itself does not give enough stage-level predictability
- D is strong, but by itself is too rigid for real mid-flight shape changes
- E is viable later, but too heavy for the current workflow maturity
- F is a useful secondary tactic, not a good primary invocation model
- H is credible and has real ergonomic strengths, but adopting it here would imply a broader workflow-architecture migration rather than a bounded invocation-governance decision
- G best balances autonomy, boundedness, explicitness, and validation integrity

## Decision

Adopt this invocation model for the repo AI workflow:

**Phase-bound default invocation with rule-based self-invocation, explicit declaration, and mandatory validation-module loading.**

The model works as follows:

1. **Stage-bound baseline**
   - Mode, mission contract, and current checkpoint establish the mandatory baseline context.
   - The baseline includes the relevant authority docs, the current mode prompt, and only the inventory-level visibility needed to discover optional modules.

2. **Rule-based optional expansion**
   - The agent may load additional modules or skills only when explicit trigger conditions are met.
   - Trigger conditions include phase change, checkpoint change, entering a new restricted subsystem, failed verification, review feedback, blocked evidence path, or a material task-shape shift.

3. **Explicit declaration**
   - Optional module loads must be declared at load time.
   - The declaration must make visible:
     - what is being loaded
     - what triggered the load
     - why the already-loaded set is insufficient

4. **Validation and review guarantees**
   - Validation, gate, review, and integration-critical modules are not optional once their gate or handoff point is active.
   - They may still be loaded on demand, but they cannot be skipped silently or replaced by vague "best effort" reasoning.

5. **Fallback rule**
   - If no existing module fits, the agent falls back to canonical authorities plus an explicit local plan.
   - The agent does not invent hidden attachment behavior.
   - If the gap is recurring and reusable, it becomes follow-up workflow work rather than an undocumented convention.

6. **Context-splitting is secondary**
   - New contexts or subagents may still be used when task shape changes materially.
   - They are not the primary invocation mechanism and do not replace the declaration model above.

## What Is Decided

- Invocation is not manual-only.
- Invocation is not hidden auto-loading.
- Stage and lifecycle position matter for the baseline.
- Optional expansion is allowed, but only through rule-bounded self-invocation with explicit declaration.
- Validation and review-critical capabilities must remain impossible to skip silently.
- The runtime-governing model is repo-defined and tool-agnostic.

## What Is Not Decided

- No registry schema or control-plane implementation is introduced here.
- No wrapper-level auto-loader is introduced here.
- No vendor-specific attachment behavior is standardized here.
- No new subagent orchestration policy is introduced here beyond keeping it secondary.
- No new skill inventory expansion is required by this ADR.

## Consequences

### Positive

- The workflow gets an explicit answer for how invocation works without requiring always-loaded detail.
- Agents retain autonomy during normal execution.
- Invocation decisions become inspectable and teachable.
- The Skills layer remains modular without drifting into hidden behavior.
- The model scales to more modules without forcing them into the default read surface.

### Negative

- Agents must now follow declaration discipline when adding optional modules.
- Some prompt and workflow docs need maintenance to keep trigger rules visible and aligned.
- The model still relies on human-readable rule quality; poor trigger wording would weaken it.
- Registry-driven automation is deferred, so repeated manual declaration patterns may still exist for a while.

## Rejected Options And Why

### Manual-only invocation

Rejected because it makes autonomous execution too dependent on human prompting quality and handles mid-flight change poorly.

### Fully implicit auto-loading

Rejected because it weakens explicitness, portability, and debuggability, and creates silent validation risk.

### Pure phase-bound invocation

Rejected because it is too rigid for real checkpoint and evidence-path changes during execution.

### Registry-driven invocation as the primary model

Rejected for now because it adds control-plane and maintenance complexity before the governance model itself needs that weight.

### Context-splitting or subagent-first invocation

Rejected as the primary model because it is too heavy for routine execution and should remain a secondary tactic.

### GSD-style harness-mediated architecture

Rejected for this mission's target decision because it solves the invocation problem partly by changing a broader set of workflow assumptions:

- command façade becomes the dominant entry surface
- more workflow behavior moves behind installed harness files, templates, and helper tooling
- the repo's current authority-first visibility would give way to a more orchestration-first model

Those are real strengths in GSD, and this ADR does not dismiss them. But adopting that architecture here would exceed the scope of a bounded invocation-governance mission and would effectively reopen larger decisions about authority layout, state ownership, and workflow packaging.

## Follow-On Implications

- `docs/ai-workflow/CORE_WORKFLOW.md` should explain the invocation loop and re-evaluation triggers explicitly.
- `docs/ai-workflow/SKILLS_ARCHITECTURE.md` should define the new invocation contract in operational terms.
- Mode prompts should reference declaration and re-evaluation expectations where needed.
- Future implementation missions may add metadata or registry support only if they preserve this ADR's explicit declaration and validation guarantees.

## Links

- [ADR 0023](0023-ai-sdlc-configuration.md)
- [ADR 0026](0026-ai-task-state-and-agent-recovery-surface.md)
- [ADR 0032](0032-mission-refinement-state-and-usage-budget-signals.md)
- [Task 019 mission](../missions/2026/task-019/MISSION.md)
- [Task 019 invocation analysis](../missions/2026/task-019/INVOCATION_MODEL_ANALYSIS.md)
