---
id: TASK-2664
title: Add a generic decision-model port with zero-friction Jev discovery
status: done
assignee: [codex]
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
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Final checkpoint

### Goal Check

| Goal | Evidence | Result |
|---|---|---|
| Generic application capability and composition-owned binding | `src/application/ports/decision.ts:29`; `src/composition/decision.ts:7`; test `composition normalizes mixed questions, probabilities, model and usage` at `test/unit/adapters/decision/decision-contract.test.ts:61` | PASS |
| Automatic unambiguous discovery, explicit selection, setup guidance and operator-only routing | `src/adapters/decision/provider.ts:20`; tests `discovers each sole conventional provider without prompting (TASK-2664)` at `test/unit/adapters/decision/decision-contract.test.ts:21` and `explicit routes disambiguate and generic SDK credentials follow operator routing` at line 47 | PASS |
| Typed results, bounded HTTP, no harness launch, secret-safe failures or implicit fallback | `src/adapters/decision/system-one.ts:119`; tests `rejects partial, malformed, mismatched and nonfinite provider answers` at `test/unit/adapters/decision/decision-contract.test.ts:114` and `HTTP and transport failures redact remote bodies and do not retry or fallback` at line 166 | PASS |
| Provider-independent budget/credit/quota block exception | `src/application/ports/decision.ts:34`; `src/adapters/decision/provider-errors.ts:20`; test `usage blocks have a provider-independent exception distinct from transient limits (TASK-2664)` at `test/unit/adapters/decision/decision-contract.test.ts:139` | PASS |
| Architecture rationale and operator guidance | `docs/adr/0065-generic-decision-capability-and-operator-provider-discovery.md:1`; `docs/config.md:24` | PASS |

Verification on the final source tree:

- `npm test -- --unit-test-headroom test/unit/adapters/decision/decision-contract.test.ts test/unit/adapters/architecture/dependency-graph.test.ts test/unit/domain/domain-architecture-guards.test.ts test/unit/repository/file-size-cap.test.ts`: 85 passed, zero failed/skipped; all cases within the 500 ms headroom cap.
- `./scripts/verify-local.sh static-analysis`: all four stages passed; ESLint zero errors/warnings, production and test typechecks clean, hygiene and layout registrations clean.
- Explicit ESLint on every changed TypeScript file, including the new test suite: zero errors/warnings.
- `./scripts/verify-local.sh docs` and `git diff --check`: passed.
- Three manual live OpenRouter Jev calls passed, returning `typesafe/jev-1.13-20260917` and normalized answers/usage. The two final-tree calls validated the default OpenRouter model with a negative boolean, blue choice and lowest score, then a generic SDK key routed through `TYPESAFE_BASE_URL` with a pinned model, apple choice and positive boolean criteria. Combined usage: 1121 input tokens, 181 output tokens, cost 0.000047082 USD. Credentials were loaded directly from `/tmp/open.txt` and never printed. No automated test calls Jev; the new suite uses injected HTTP doubles only. Other hosted providers were not live-tested.

The new contract suite owns generic decision discovery and transport because no existing decision-service suite or workflow consumer existed. Bug reproduction is not applicable: this mission has no bug label. No classifier policy, workflow integration, credential store or agent family was added.
