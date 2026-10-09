# ADR 0065: Generic decision capability and operator provider discovery

**Status:** Accepted

**Date:** 2026-10-06

**Task:** TASK-2664

## Context

Future Parallix workflows need bounded judgments over state and typed questions.
Jev provides this capability through System One rather than a coding-agent
conversation. Adding it as an agent family would couple a small inference call
to agent launch, session handling, generated reasoning and unrelated tools.
The inspected application ports contain no generic external decision service.

Operators may already have Jev configured through TypeSafe, OpenRouter or
Vercel AI Gateway. The current jev-code client reads conventional environment
variables and serves the same System One protocol through its CLI and tools.
Its setup can also copy credentials into harness MCP configuration. Reusing
the operator environment is practical; recovering harness-only credentials
would require the scraping this mission excludes.

The capability must preserve application ownership and composition authority.
Provider selection cannot let a checked-out repository redirect operator
credentials or choose where future decision state is sent. A configured route
also cannot guarantee that the provider will authorize or fund a request.

## Options considered

| Option | Application boundary | Existing setup reuse | Costs / risks | Decision |
|---|---|---|---|---|
| Add Jev as a coding-agent family | Agent/session semantics | Through a harness | Extra process, reasoning, latency and tool authority for a bounded request | Reject |
| Invoke the host-side jev-code CLI | Generic port can wrap it | Environment and installed executable | Same environment is already sufficient for HTTP; adds executable/version discovery and process failure modes | Reject for this implementation |
| Extract an existing MCP server configuration | Harness-specific discovery | Includes harness-only secrets | Credential scraping and repository configuration can change destinations | Reject |
| Bind a generic application port to direct System One HTTP | Typed judgment and failure contract | Conventional operator environment | Requires protocol validation and explicit routing rules | **Accept** |

## Decision

Introduce an application-owned DecisionPort exposing availability and decisions
over JSON state and named boolean, choice and ordered-score questions. Preserve
boolean probability without inventing a yes/no threshold; preserve selected
choices, score position, available distributions, confidence, model identity,
provider identity and available token/cost metadata. Business questions,
thresholds, review policy and workflow integration remain future decisions.
Consumers must not depend on provider-specific response JSON.

Composition binds the port to a System One HTTP adapter. Application and domain
code acquire no Jev, OpenRouter, agent-harness or process dependency. Future
compatible or local implementations can satisfy the same port without changing
consumers. This implementation supports the three verified hosted routes;
other jev-code protocols require their own adapters rather than implicit reuse.

Resolve from the operator environment only. Reuse the conventional provider
keys, explicit provider selection and SDK base/model settings. Exactly one
usable unambiguous route requires no prompt. Explicit provider selection or a
known provider base URL can disambiguate multiple keys. Otherwise return
setup-required with actionable guidance instead of choosing an account by
precedence. Availability describes configuration, not a live credit or health
check, and performs no network call.

The key variable determines its host; key prefixes do not select providers.
The generic SDK key can follow an operator-specified compatible route.
Host-specific keys cannot cross to another known provider. An unknown proxy
requires the generic key or an explicit provider choice. Accept only HTTPS
base URLs without embedded credentials, query or fragment. Reject conflicting
provider/base settings and redirects before forwarding credentials. Never read
agent configuration, repository secrets, workflow configuration or dotenv files
for discovery. Never persist decision credentials under PARALLIX_HOME.

Use bounded requests with a finite timeout, local shape validation and typed
response validation. Do not retry or switch providers automatically: doing so
can duplicate billed work or change the operator's intended destination.
Normalize failures into an application-owned DecisionError. Usage-blocked
means budget, credit or quota exhaustion; authentication, transient rate limits,
unavailability, invalid requests and invalid responses remain distinguishable.
Known machine codes and HTTP status determine the category. An OpenRouter
in-flight budget limit is transient rather than exhausted account/key credit.
No provider body, credential or request state appears in an exception.
Callers own recovery; failures never synthesize a successful decision.

Availability distinguishes an absent provider key (`credentials-missing`) from
invalid configuration, so a consumer can tell an unconfigured process from a
misconfigured one. The key is read from the environment of the px process that owns
the work: Parallix passes it to a px command it hosts, and never to a launched agent
or the terminal server (ADR 0064). A px process started from inside an agent therefore
has no key by design. Operators must export keys where non-interactive shells read
them. The classifier records `provider-key-missing` for each affected round and tells
the operator once per process, naming the variables but never a value.

## Relationship to existing decisions

- ADR 0051 retains application ports, dependency direction and composition
  authority. Provider transport remains an outbound adapter.
- ADR 0053 retains operator-state persistence authority. This capability adds
  no credential store or second Mission authority.
- ADR 0057 retains verification tiers. Injected HTTP doubles establish the
  hermetic contract; a live model call requires operator credentials and does
  not belong in the unit or hosted integration lanes.
- ADR 0064 retains terminal credential boundaries. Decision discovery reads
  the current operation environment; it does not recover credentials stripped
  from a retained console or change launcher propagation.

## Consequences

Existing environment-based Jev users can expose the capability without another
setup step or executable. Operators with only harness-stored credentials must
export a compatible provider key; discovery does not silently reuse those
secrets. Multiple unselected providers require an explicit routing choice,
which is deliberately stricter than jev-code's default precedence.

A provider can become usage-blocked after configuration is available. Callers
can distinguish this from transient failures without parsing gateway messages.
Unknown provider-specific errors retain a conservative generic category until
their machine contract is verified. Only request data supplied by a future
consumer leaves the process; this mission introduces no automatic decisions.

## References

- [jev-code client and operator configuration](https://github.com/FrancoisChastel/jev-code)
- [jev-code credential and routing rules](https://github.com/FrancoisChastel/jev-code/blob/main/SECURITY.md)
- [OpenRouter Jev protocol](https://openrouter.ai/docs/guides/community/jev)
- [OpenRouter credit and rate limits](https://openrouter.ai/docs/api/reference/limits)
