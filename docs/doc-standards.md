# Documentation Standard

This standard exists to keep Parallix documentation useful, credible, concise,
and resistant to drift.

It is primarily a **review and editing standard**, not a document template.
Agents should use judgment about structure. The goal is to improve what a reader
understands, not to satisfy a prescribed set of headings.

## 1. Audience and purpose

Public-facing documentation, especially `README.md`, should work for a skeptical
engineering manager, senior engineer, or experienced AI-workflow operator.

A reader should be able to understand:

* what Parallix is;
* why it exists;
* what concrete problem it solves;
* what makes it different from running a coding agent directly;
* how to get to a useful first result;
* which claims are observations, limitations, or guarantees.

Write for a reader evaluating whether the tool is worth trying, not for someone
who already understands Parallix internals.

## 2. Preserve the product value

Do not make Parallix sound more generic or less useful in an attempt to sound
careful.

The README should make the important differentiators clear while they remain
true:

* useful parallel AI work rather than one serialized agent session;
* isolated mission work so parallel agents do not share one mutable checkout;
* agent-agnostic orchestration, including hosted and local AI;
* continuity across long-running agent work;
* separate review and repository-owned verification;
* operator control over what ultimately lands.

State limitations accurately, but do not bury the reason someone would use the
tool.

## 3. Prefer clarity over structure

There is no canonical README section order.

Choose the shortest structure that explains the product well.

Do not add a section because an older README, benchmark document, task, or
documentation standard used that section.

Before adding or retaining a section, ask:

1. What new question does this section answer?
2. Has that question already been answered elsewhere?
3. Would removing or merging it make the document easier to understand?

If two sections have substantially the same purpose, merge them or remove one.

A heading is not evidence that the content deserves its own section.

## 4. Optimize the path to first value

The top of the README should quickly establish the product and give the reader a
low-friction way to try it.

Within roughly the first 300 words, a reader should normally be able to answer:

* What is Parallix?
* Why would I use it?
* Why not just run Claude Code, Codex, or another agent directly?
* What is the first useful thing I can do?

Keep the happy path short.

Do not put diagnostics, optional setup, advanced configuration, troubleshooting,
or infrastructure choices before the first useful workflow unless they are
strict prerequisites.

For example, an environment diagnostic belongs in troubleshooting when normal
users can simply try the product first.

## 5. Edit before rewriting

When improving an existing document, start from the current document.

Prefer the smallest change that fixes the identified problem.

A complete rewrite is justified only when the existing structure or framing is
itself the problem.

Do not replace good existing prose merely to make the document internally
consistent with an agent's preferred style.

Before a large rewrite:

* identify what is currently wrong;
* identify what should remain;
* explain why local edits are insufficient.

Documentation reviews should normally produce deletion, consolidation, or
targeted changes before they produce new sections.

## 6. Avoid repetition

After editing a document, summarize the purpose of each major section in one
sentence.

If two summaries are materially the same, inspect them for duplication.

Common forms of accidental duplication include:

* explaining the workflow once in the introduction, again in Quick start, again
  in a lifecycle section, and again in an example;
* repeating the same limitation in a capability section, use-case section, and
  "What this is not" section;
* listing the same supported agents or commands in multiple places;
* restating a feature once as a problem, again as a capability, and again as a
  status item without adding information.

Repetition is justified only when the later occurrence adds meaning rather than
restating the same fact.

## 7. Keep one authority for executable facts

Authored documentation must not become a second implementation.

Current executable behavior is owned by the executable system: commands,
configuration, schemas, source, and tests.

Do not manually maintain prose inventories of:

* every command or flag;
* every configuration field or default;
* every supported implementation adapter;
* source file locations;
* line-number references;
* test file inventories;
* internal state mappings.

When a reader needs exact current details, point them to the appropriate stable
interface such as `px --help`, `px config`, a schema, or another deliberately
maintained user-facing surface.

Do not create a prose "authority reference" that attempts to summarize the
runtime.

If a useful reference can only remain correct by synchronizing it with code,
either derive it mechanically from the real authority or do not maintain the
duplicate.

## 8. Do not use prose as proof of other prose

An explanatory Markdown document is not evidence that another Markdown
document's factual claim is correct.

When reviewing a claim about current behavior, verify it against an executable
authority.

Historical missions, checkpoints, ADRs, benchmarks, and task documents may
explain why a decision was made or preserve evidence from a particular tree.
They do not automatically describe current runtime behavior.

Do not "fix" one document because another old document disagrees with it until
the actual authority has been checked.

## 9. Claims and measurements

Quantitative claims are welcome when they help explain why the product exists.

Do not weaken a real measured result merely because it is not universal.

Instead, state:

* what was measured;
* the approximate result;
* the context needed to interpret it;
* what is not being claimed.

Distinguish observed evidence from universal promises.

For example, a measured throughput improvement or context reduction may be
reported as an observed result without claiming every repository or operator
will see the same improvement.

Never invent precision that the measurement does not support.

Never repeat a third party's marketing number as though Parallix reproduced it.

## 10. Product claims should be durable

Prefer statements about useful product behavior over details of today's
implementation.

Good:

> Parallix can continue a mission with another eligible agent family when one
> provider becomes temporarily unavailable.

Less durable:

> Function X detects provider message Y and writes field Z before invoking
> adapter Q.

Good:

> Review is separate from implementation and prefers a different agent family
> when one is available.

Less durable:

> Provider-specific self-approval is rejected in module X.

Implementation details belong in code and technical investigation, not in the
landing page unless the detail itself is important to the user.

## 11. Be specific about meaningful differentiators

Do not hide differentiators behind generic language such as "AI orchestration"
or "developer productivity."

Prefer concrete explanations:

* multiple missions can progress concurrently;
* each mission has isolated Git state;
* different agent families can participate in one workflow;
* local AI is supported rather than requiring one hosted vendor;
* review is separate from implementation;
* repository verification remains authoritative;
* filesystem confinement is provided where supported.

Explain *why* a capability matters, not merely that it exists.

## 12. Tone

Write engineer-to-engineer.

Prefer:

* concrete language;
* short explanations;
* active voice;
* explicit limitations;
* measured confidence.

Avoid:

* hype;
* unexplained superlatives;
* defensive caveat stacking;
* internal jargon in introductory material;
* marketing filler;
* exaggerated claims of autonomy;
* making a strong product sound weak in the name of caution.

Credibility comes from being precise, not from underselling the product.

## 13. Separate product documentation from project history

`README.md` is a product landing page.

It is not:

* a changelog;
* a development diary;
* a repository architecture catalog;
* a test report;
* a historical mission record;
* a documentation-design benchmark;
* a complete operational reference.

Historical research can inform the README without being linked from the README
unless it is genuinely useful to a user evaluating or operating Parallix.

Likewise, internal documentation should exist because someone has an ongoing
need for it, not because an earlier mission produced it.

## 14. Documentation hygiene

When editing live documentation:

* remove stale statements instead of updating unnecessary inventories;
* remove dead links;
* remove duplicated explanations;
* verify current-behavior claims against executable sources;
* keep measurements attached to enough context to remain honest;
* preserve intentional historical artifacts rather than rewriting them to match
  today's tree;
* prefer deletion over creating synchronization machinery for unnecessary prose.

Run the repository's documentation verification after changing live
documentation.

The documentation verifier (`scripts/verify-docs.mjs`) enforces two contracts.
First, live docs must not contain volatile implementation evidence (source
paths or test inventories) and every relative link must resolve. Second, the
npm manifest must point at the operator-confirmed canonical location: the
verifier compares `package.json` `repository.url`, `homepage`, and `bugs.url`
against `git remote get-url origin` and fails on disagreement, normalizing
only representational differences (transport syntax, a trailing `.git`, a
`#readme` fragment, or an `/issues` suffix). The comparison is offline; it
never makes a network request. A regression test covers the failing case — a
manifest whose URLs disagree with `origin` is rejected.

## 15. Review checklist

Before committing a README or substantial documentation change, ask:

### Reader

* Can a new reader understand what this is and why it matters?
* Does the important value appear early?
* Is the first useful action easy to find?

### Differentiation

* Is the reason to use Parallix instead of one coding agent clear?
* Are parallelism and operator leverage visible?
* Is the agent-agnostic/local-AI capability clear where relevant?

### Credibility

* Are limitations stated without diluting real value?
* Are quantitative claims described as measurements rather than universal laws?
* Have current-behavior claims been checked against an executable authority?

### Editing quality

* Did this change preserve useful existing content?
* Did it add unnecessary structure?
* Do any two sections now serve substantially the same purpose?
* Can anything be deleted without losing important meaning?

### Drift

* Did this edit duplicate command, config, source, test, or adapter details that
  already have another authority?
* Is any explanatory document being treated as proof of current executable
  behavior?
* Will an internal refactor force this prose to change even though user-facing
  behavior did not?

If the answer to the last question is yes, reconsider whether that detail
belongs in authored documentation at all.

## 16. Agent instruction

Agents editing `README.md` or live authored documentation must consult this
standard before making substantive changes.

The standard defines desired outcomes and failure modes. It does **not**
authorize restructuring a document merely to conform to a preferred template.

When in doubt, preserve good existing content and make the smallest change that
improves correctness, clarity, credibility, or usefulness.
