---
id: TASK-2664
title: Add a generic decision-model port with zero-friction Jev discovery
status: backlog
assignee: []
created_date: '2026-10-06 10:55'
labels: []
dependencies: []
ordinal: 172008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a **generic decision-model capability** to Parallix that future missions can use for bounded classification/decision tasks.

The implementation must:

- introduce a clean application-level `DecisionPort`;
- avoid coupling the application/domain to Jev, OpenRouter, or any agent harness;
- reuse an operator's existing Jev setup when practical;
- require no user interaction when a compatible provider is already explicitly configured;
- avoid launching a general coding agent merely to proxy a decision-model request;
- avoid scraping credentials out of agent configuration;
- avoid repository-controlled remote endpoints or secrets;
- provide a clear setup-required path when no usable provider exists.

This mission does **not** define any actual Parallix business decision, classifier question, review policy, threshold, or workflow integration beyond exposing the generic capability.

---

## Context

Parallix currently treats Codex, Claude, Qwen, Vibe, and `custom` runners as coding-agent families.

Those agents are the wrong abstraction for Jev/System One.

Jev is a decision model:

```text
state + typed questions
        ↓
typed answers + probabilities
```

It should therefore be represented as a **decision service/application port**, not as another agent family.

Existing ecosystem research also shows that Jev is already exposed to coding agents through normal tool mechanisms:

- Codex: MCP
- Claude Code: MCP/plugin
- OpenCode: MCP/native tool
- Pi: native extension
- other MCP-capable harnesses can use the same stdio MCP server

The `jev-code` project additionally exposes the same functionality through a host-side CLI.

That means Parallix should **not** launch Codex/Claude/Pi/OpenCode simply to invoke Jev. Doing so would add latency, token use, model reasoning and failure modes to something intended to be a cheap deterministic-ish decision primitive.

Instead, Parallix should call the decision service directly or reuse an already configured host-side Jev client.

---

# Required discovery before implementation

Before changing code:

1. Read root `AGENTS.md`.
2. Inspect current `main`.
3. Inspect current:
   - application port conventions;
   - adapter composition;
   - `workflow.config.json` handling;
   - `PARALLIX_HOME` storage conventions;
   - agent launcher environment propagation;
   - existing provider/auth discovery patterns.
4. Verify the current Jev/System One API and the current `jev-code` behavior from primary/current sources rather than relying blindly on this mission text.
5. Check whether any existing Parallix abstraction already represents generic external inference/decision services.

Do not create a parallel abstraction if a suitable one already exists.

---

# Architectural requirement

Introduce an application-level abstraction conceptually equivalent to:

```ts
interface DecisionPort {
  available(): Promise<DecisionAvailability> | DecisionAvailability;

  decide(request: DecisionRequest): Promise<DecisionResult>;
}
```

Exact naming and types should follow current repository conventions.

The request should be **generic System One-style data**, not a business-specific method such as:

```ts
checkReviewFinding(...)
classifyMission(...)
validateEvidence(...)
```

A reasonable conceptual shape is:

```ts
interface DecisionRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
}
```

with typed question variants as supported by the chosen protocol, for example:

- boolean / yes-no;
- choice;
- ordered score / levels;

and a result that preserves:

- selected answer;
- full probabilities where available;
- model identity;
- provider identity;
- token/usage metadata when available.

Do not make application code depend on provider-specific response JSON.

---

# Provider architecture

The application/domain must know only `DecisionPort`.

Provider selection belongs in adapters/composition.

Conceptually:

```text
Application
    │
DecisionPort
    │
Decision adapter
    │
Provider resolution
    ├── existing configured Jev/System One route
    ├── TypeSafe
    ├── OpenRouter
    ├── Vercel AI Gateway
    └── future compatible/local implementation
```

Do not name the application port `JevPort` or `OpenRouterPort`.

Future implementations must be able to satisfy the same port without changing consumers.

---

# Existing operator configuration: reuse before setup

Provider discovery must favor **explicit configuration the operator already owns**.

At minimum investigate and support the current conventional variables used by the Jev ecosystem:

```text
TYPESAFE_API_KEY
OPENROUTER_API_KEY
AI_GATEWAY_API_KEY
JEV_CODE_PROVIDER
TYPESAFE_BASE_URL
TYPESAFE_DEFAULT_MODEL
```

Do not blindly assume this list is current: verify it against current Jev/TypeSafe/jev-code documentation.

## Required behavior

If exactly one unambiguous usable route already exists:

```text
operator environment
        ↓
provider detected
        ↓
DecisionPort available
```

then **do not prompt the user**.

This is explicit operator intent.

Examples:

```bash
export OPENROUTER
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
