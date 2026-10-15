# Configuration reference

`workflow.config.json` is optional. Parallix merges its contents over built-in
defaults; run `px config` to see the effective result for the current checkout.
Use JSON values of the types listed below.

Configuration is validated before it is merged. `px config` checks the JSON
syntax, the top-level and adapter-section shapes, and each `adapters` field
documented below — its type, its permitted values, and, for the closed
sections noted in this reference, its key names. Two documented fields are
exceptions that carry no type check: a non-string `product.name` or
`adapters.review.tmpDir` is not reported as a configuration error, so give
both fields string values. When any of the other checks fails, `px config`
reports the specific issues, prints the built-in defaults it fell back to, and
exits non-zero. The fallback is whole-file: a configuration with one rejected
field contributes none of its overrides to the effective configuration, so fix
the reported issue rather than relying on the rest of the file still applying.

Sections not marked as closed below accept extra keys, matching the schema.
An extra key is not an override: only the fields documented here have an
effect.

## Decision provider setup

The generic decision capability reuses compatible classifier provider settings from
the operator's environment. For example, export `OPENROUTER_API_KEY` in the
shell running Parallix. A single compatible route is available without another
setup prompt. If several providers are configured, select the intended account
with `JEV_CODE_PROVIDER`; SDK base and model overrides remain operator-owned.
Export the key where non-interactive shells read it, for example before the
interactive-shell guard in `~/.bashrc` or in `~/.profile`; a key set after that
guard is invisible to cron, `ssh host cmd` and agent shells. Parallix passes the
key to the px commands it hosts but never to launched agents, so run px review
and integration commands from your own terminal rather than from an agent. A
process without a key keeps the general reviewer, records `provider-key-missing`
and prints one notice naming the variables, never their values.
Harness-only credentials must be exported explicitly rather than recovered
from agent configuration. Repository configuration cannot supply decision
credentials or redirect their destination.

Configured availability does not guarantee funded access. Decision calls
report budget, credit or quota exhaustion as `usage-blocked`, separately from
authentication and transient rate limits. They do not automatically retry or
switch accounts. This capability introduces no automatic workflow decisions.
The boundary and rationale are recorded in
[ADR 0065](adr/0065-generic-decision-capability-and-operator-provider-discovery.md).

## Web board

The local web board shows open missions and, by default, closed DONE missions
whose canonical delivery completion falls on or after local midnight six days
before today. This counts seven calendar days including today, and uses the
same boundary as the rolling statistics window. Administrative closure does
not extend retention. Set `adapters.web.completedMissionRetentionDays` to a
non-negative integer to change the day count; `0` retains no closed missions
with delivery evidence through today. Unclosed DONE missions stay visible.
Missing or malformed delivery evidence, including unavailable history, also
keeps the mission visible rather than silently omitting it.

The board follows the host's event stream without page reloads. While that
connection is lost, or when a refresh fails, it keeps showing the last validated
board under an explicit stale notice until a fresh snapshot arrives.

```json
{
  "adapters": {
    "web": { "completedMissionRetentionDays": 14 }
  }
}
```

## Product

`product.name` is a string, defaulting to `Workflow`. It pre-fills the product
name in `px setup`, which writes the configured value back to the generated
file.

```json
{
  "product": { "name": "Acme delivery workflow" }
}
```

## Tasks

`adapters.tasks.provider` names the task tracker implementation. `backlog-md`
is the only supported value in this release and is also the default; any other
value is rejected by configuration validation, so `px config` reports the
failure and task storage refuses to resolve rather than silently running
backlog-Markdown behavior under another provider name.

`adapters.tasks.storage` is either a string (default `backlog`) or an object
whose members are all strings. A string normally names the storage root, below
which Parallix derives its `tasks`, `completed`, archive, and draft
directories. If the string ends in `tasks`, it is the tasks directory itself
and the sibling directories are derived from its parent. The object form
recognises `tasksDir`, `completedDir`, and `archiveTasksDir`; each one it omits
is derived from the parent of `tasksDir` as usual, and the drafts directory is
always derived.

When a mission lands, Parallix moves its task file from the tasks directory to
the completed directory (`backlog/completed/` by default) and sets
`status: done`. No setting turns this off: the
completed record is what later landings check to drop stale task copies.

`adapters.tasks.stateMap` is a string path, defaulting to `state-map.json`.
When that relative file is absent, Parallix uses its shipped state map. Point it
at a repository map to translate lifecycle states for another board.

```json
{
  "adapters": {
    "tasks": {
      "provider": "backlog-md",
      "storage": { "tasksDir": "work/items", "completedDir": "work/done" },
      "stateMap": "config/state-map.json"
    }
  }
}
```

## Missions

`adapters.missions.baseDir` is a string, default `missions`, for mission
documents. `branchPrefix` is a string, default `mission/`; a trailing slash is
added when omitted. `worktreePattern` is a string, default
`../<repo>-<slug>`, whose `<repo>` and `<slug>` tokens become the primary
checkout name and mission slug. `primaryBranch` is an optional string; when it
is unset, Parallix detects `main` or `master`.

```json
{
  "adapters": {
    "missions": {
      "baseDir": "work/missions",
      "branchPrefix": "change",
      "worktreePattern": "../worktrees/<repo>-<slug>",
      "primaryBranch": "trunk"
    }
  }
}
```

## Verification

This repository's lint and compiler enforcement is described in
[Static analysis](static-analysis.md).

`adapters.verification.command` is an optional string. When present, it is run
through the shell and every `{{area}}` token is replaced with the selected
verification area. When absent, verification is a successful no-op.
`defaultArea` is an optional string, default `docs`, used when no explicit or
diff-derived area is available.

`px verify`, handoff, and autonomous review share successful active/review
verification. Backlog task bookkeeping does not invalidate it. Completed rebases,
including conflicts resolved in a terminal before restarting Parallix, advance
the recorded SHA without repeating the check. Parallix records completion through
a worktree-local Git `post-rewrite` hook that forwards existing hooks. New
implementation changes or toolchain changes require fresh verification.
Integration runs its explicitly configured checks. Local squash landing and
review-baseline mirroring add no publication verification tests; downstream CI
owns shared integration validation. The configured post-integration hook still
runs after the squash, for example to build and install a local package.
Repositories may choose to run tests in that hook.

Successful integration can also satisfy later `all` verification when
`adapters.verification.integrationCoverage` explicitly names the resolved
verification command and maps **every** check it performs to required
`preIntegration` gate keys. For example:

```json
"integrationCoverage": {
  "command": "./scripts/verify-local.sh all",
  "checks": {
    "docs": ["documentation"],
    "build": ["build"],
    "unit": ["unit"]
  }
}
```

The repository owner is responsible for complete, accurate coverage: gate names
or arbitrary integration commands alone prove no relationship to `all`.
Every configured integration gate must pass, with all named coverage gates
present, against unchanged clean inputs. A successful partial run or dry run
cannot establish this evidence. Review, handoff and `px verify all` report the
integration evidence location and both the validated and covered revisions when
reusing it.

Integration-backed reuse requires the same checkout, branch, resolved command,
configuration, tracked substantive inputs and runtime/npm toolchain. A different
SHA requires a successful Git diff containing only `backlog/tasks/` or
`backlog/completed/` bookkeeping paths; it does not inherit the completed-rebase
exception of ordinary active/review verification. Missing, malformed, failed or
incomplete evidence, dirty inputs, substantive changes or Git lookup failures
cause normal verification. Starting another integration run clears earlier
integration-backed evidence, so failed or partial retries cannot reuse it.
Review approval, required integration gates and exact publication proof checks
retain their own authorization requirements.

Captured external commands show terminal progress and completion marks with
elapsed time. Bash commands identify the shell payload or script being invoked,
so checks such as `bash -c "npm test"` and `bash -lc "npm run build"` are
distinguishable. Named verification labels retain their purpose and include the
invoked command. Multiline payloads are escaped onto one line, and recognized
credential-bearing text is redacted; direct Git arguments remain hidden.
Redirected logs receive one static completion row per displayed command.

```json
{
  "adapters": {
    "verification": {
      "command": "./scripts/verify-local.sh {{area}}",
      "defaultArea": "all"
    }
  }
}
```

## Review

`adapters.review.provider` is `forgejo`, `none`, or `null`; its default is
unset, which leaves provider mirroring disabled. With `forgejo`, the optional
string `baseUrl`, `remote`, and `repo` values identify the Forgejo server, Git
remote (normally `review`), and `owner/repository` respectively. Environment
values for Forgejo URL and repository take precedence where supported.

`adapters.review.tmpDir` is an optional string naming the directory Parallix
writes review artifacts into, resolved relative to the repository root when it
is not absolute. Its default is the operating system temporary directory. Point
it at a repository-local directory when the review sandbox may not reach the
system temporary directory.

```json
{
  "adapters": {
    "review": {
      "provider": "forgejo",
      "baseUrl": "http://localhost:3300",
      "remote": "review",
      "repo": "acme/delivery",
      "tmpDir": ".parallix/review-artifacts"
    }
  }
}
```

## Agents

`adapters.agents.maxConcurrentCustom` is an optional positive integer enforced
across local custom-agent processes that share `PARALLIX_HOME`; its default is
unlimited custom-agent launches. `subagents.maxParallel` is separate: it is an
advisory prompt limit for subagents created inside one agent, not process
admission control. `models` is an object whose keys
are agent-family names and whose string values are model identifiers; unlisted
families receive no model argument. `runners.custom` is `opencode` or `pi` and
defaults to `opencode`. `subagents.maxParallel` is an integer or `null`,
defaulting to no limit; zero also means no limit. `runners` and `subagents` are
closed objects: `custom` and `maxParallel` are their only permitted keys, and
any other key is a configuration error.

```json
{
  "adapters": {
    "agents": {
      "maxConcurrentCustom": 2,
      "models": { "codex": "gpt-5.6-terra", "custom": "local-model" },
      "runners": { "custom": "pi" },
      "subagents": { "maxParallel": 3 }
    }
  }
}
```

## Terminal sessions

Interactive mission operations automatically use tmux when it is installed
and runnable; headless callers and unavailable terminals use pipes. No configuration is needed. A mission keeps one terminal
across commands, agent roles and retries, including after work stops.

In `px web`, click a mission card to view its live tmux output. The view
keeps updating while open, including when the board changes. A stalled read
shows an unavailable message after thirty seconds and retries while the view
remains open.
If a refresh is interrupted after output has loaded, the view keeps the last
capture visible with a retry notice until the connection recovers.
For missions without a live tmux session, the view shows the latest retained
agent-run output when available, labeled as recorded output with its run dates.
Agents started outside Parallix are not captured by this view.

Explicit host and unavailable-tool overrides remain available through
`px config` and the workflow configuration schema. `whenUnavailable: "fail"`
applies only to `host: "tmux"`; automatic hosting always falls back if a terminal
cannot start, and never retries an operation that already started. Terminal hosting changes
observability, not lifecycle, verification, retry or security authority. See
[agent-run history](agent-run-history.md) for attaching, idle-terminal cleanup
and retained-output retrieval.

## Prompts

Each shipped stage prompt (draft, execute, review, act-on-review, portfolio) is
assembled from two files: a mandatory **Parallix core** half that the loop
mechanically requires (artifact paths and filenames, `{{placeholders}}` the
harness substitutes, parser-visible tokens and formats, permitted
`px`/`git`/`Forgejo` commands, safety and separation-of-duties rules, and
lifecycle mechanics), and an overridable **default-opinion** half that is taste
(how to review, evidence standards, thoroughness, tone).

`adapters.prompts` accepts `override` and the boolean `contextCompaction`.
When `override` is unset, Parallix assembles the shipped core and default-opinion
halves. A shipped default-opinion half may be empty when a stage has no
tailorable opinion content.

When `override` is set to a repo-relative or absolute path, Parallix assembles
the same mandatory core half and reads the local opinion from that one file.
For draft, execute, act-on-review, and portfolio, that file replaces the shipped
opinion half (including an empty shipped default). For review, Parallix keeps
the shipped default-opinion guidance before appending the local opinion, so
reviewers retain the instruction not to repeat large batched coverage that
Parallix already ran or deliberately schedules later. The core half is always
assembled in and cannot be dropped by an override, so no mechanically required
instruction is removable.
There is exactly one such key; there are no per-stage, per-agent, per-model,
or per-user override keys.

```json
{
  "adapters": {
    "prompts": {
      "override": "config/my-review-opinion.md"
    }
  }
}
```

An unknown key beneath `adapters.prompts` (for example `adapters.prompts.draftOverride`,
or any property other than `override` and `contextCompaction`) is rejected through the existing
configuration-error path, so a repository cannot invent a second or per-stage
override surface. The five shipped default-opinion files selected when no
override is configured are `prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`,
`prompts/act-on-review.md`, and `prompts/portfolio.md`.

### Context compaction

Parallix-requested compaction defaults on. To opt out, set:

```json
{
  "adapters": {
    "prompts": {
      "contextCompaction": false
    }
  }
}
```

Omitting this field or setting it to `true` enables compaction. Only boolean
values are valid. The repository's explicit value overrides the built-in on
default; there is no environment, per-user, per-agent or per-stage override for
this policy. An opinion override does not replace the core policy. Inspect
repository configuration with `px config` and the public schema.

Enabled prompts request compaction after recorded checkpoints and successful
mission gates, before review rounds after the first, and before acting on review
findings, including missions with no gates. Both policies use `px status` as the Mission-state authority and retain
mission-state reloads, durable evidence, failed-gate diagnostics and review
rules. Failed gates retain their diagnostics during repair.

This policy controls Parallix's instructions, not the provider's automatic
near-context-limit safeguards. Those remain governed by the agent runtime's
configuration. Checkpoints continue in the retained conversation; toggling this
option does not start fresh checkpoint sessions. See
[the context-management decision](adr/0066-mission-context-management.md) for
its rationale.

## Integration

`integration.mode` is a top-level key naming who owns the merge into the
primary branch. It is separate from review approval: a mission can be reviewed
and approved and still not be integrated, because approval decides whether the
change is good enough to ship while the mode decides where and by whom it lands.

`integration.mode` is one of `local`, `github-publish`, or `github-pr`. Absent
configuration resolves to `local`, so an unconfigured repository is
byte-identical to before. Any other value is a configuration error that fails
closed with a message naming the invalid value and the allowed set — guessing
the merge authority is treated as worse than refusing to run.

- `local` (default): Parallix owns the merge into the configured primary
  branch. It runs the local gates, performs the merge, and records completion
  itself. No external system is asked and no network or credential is required.
- `github-publish`: Parallix integrates locally and continues developing while
  GitHub independently verifies the exact resulting commit, then publishes it to
  the protected primary branch. Publication is GitHub's; it publishes only what
  it has verified. Free of any human-approval requirement.
- `github-pr`: Parallix pushes a reviewable mission branch and GitHub with the
  repository's pull-request policy owns the final merge. Completion is decided
  by GitHub merge evidence and the repository's human review policy, not by a
  Parallix agent review or a local merge.

In the GitHub modes the external evidence is observed — a verified commit or an
observed external integration — never self-asserted by the agent running the
mission. The active mode is visible without opening any config: `px config`
prints it, and `px status` prints it alongside the mission's board state.

```json
{
  "integration": { "mode": "github-publish" }
}
```

The related branch-model and pre-integration-gate boundaries are described in
[ADR 0045](adr/0045-parallax-branch-model.md) and [ADR 0041](adr/0041-integration-pipeline-gates.md).

## Draft

A mission worktree is a fresh checkout: nothing the repository installs or
generates is there yet, so any agent or gate that depends on it fails in the
worktree. `adapters.draft.preDraftCommand` is an optional string that prepares
it. `px draft` runs it in the new worktree before any agent or gate runs there,
with `PRE_DRAFT_HOOK_SLUG` and `PRE_DRAFT_HOOK_WORKTREE` in its environment. A
failing command stops the draft as an environment failure, before an agent is
launched; it is not treated as the implementer's failure. Make it idempotent: a
re-run of the draft runs it again. An empty string is the same as unset.

Each run logs its command, exit code, monotonic duration and whether the package
store was already populated, and the draft output separates worktree checkout
time from hook time. A failed hook prints its exit code and the tail of its
output. Repair the environment or the command and re-run the draft.

Parallix's own hook installs dependencies through a wrapper that records the
semantic dependency identity of the last successful install in the worktree, so
re-running a draft in a worktree whose identity still matches does not install
again. A release version-only change leaves that identity intact; a dependency,
resolution, integrity, install-policy or pinned-toolchain change, and a missing,
unreadable or failed install, all require reconciliation. The record lives in the
worktree, so parallel worktrees never share or overwrite each other's install
state, and a successful record is published only after the installer exits zero.

```json
{
  "adapters": {
    "draft": { "preDraftCommand": "./scripts/px-install.sh" }
  }
}
```

## Integrate

Both integrate hooks are optional strings with no default. Each runs from the
base checkout and receives `INTEGRATE_HOOK_SLUG`,
`INTEGRATE_HOOK_BASE_WORKTREE`, `INTEGRATE_HOOK_BASE_BRANCH`, and
`INTEGRATE_HOOK_VARIANT` in its environment. A failing hook aborts the
integration.

- `adapters.integrate.preCommitCommand` runs in the mission worktree after the
  mission is rebased onto its base branch and before the integration gates.
  Tracked files it modifies are committed onto the mission branch, so the gates
  verify them and they land inside the mission's squash commit. Use it for
  repository metadata that must land with the mission, such as a version bump,
  so each mission lands as exactly one commit. Make it idempotent: a retried
  integration runs it again. A dry run does not run it.
- `adapters.integrate.postIntegrateCommand` runs once after a successful
  non-dry-run integration. The landed commit is already final at this point, so
  the command must not commit.

```json
{
  "adapters": {
    "integrate": {
      "preCommitCommand": "./scripts/bump-version.sh",
      "postIntegrateCommand": "./scripts/refresh-px.sh"
    }
  }
}
```

## Lifecycle gates

`adapters.gates` declares ordered, per-phase lifecycle gate commands. It is
**disabled by default**: omit the section (or a single phase key) and that
phase runs no gate. This keeps Parallix usable in any repository ecosystem
without an implicit Node, npm, tsx, `scripts/verify-local.sh`, or directory
layout requirement — a repository that does not configure gates selects none.

Each phase is an ordered array of gate objects. A gate object has a required
non-empty string `key` (used in logs and failure reports), a required
non-empty string `command` (an exact runnable shell command with no trailing
prose), an optional numeric `order` (default `0`; gates run in ascending
order), and optional `after` keys for gates that must finish first.

Gates run serially unless the repository opts a phase into bounded parallelism
with `parallel`. Independent gates fill that phase's configured limit; a gate
with `after` waits for each named producer. Output is emitted as a complete,
labeled section per gate after it finishes, so concurrent command streams stay
readable. When the interactive dashboard is unavailable, each gate instead
prints a readable start and completion line as it runs. A failure stops queued
gates, terminates active gates, and blocks the phase. Integration then routes
the original failure through gate rebound; operator cancellation aborts instead.

`adapters.gates` is a closed section: `requirePreIntegration`, `parallel`,
`preHandoff`, `preReview`, and `preIntegration` are its only permitted keys, so a typo such
as `requireIntegration` is a configuration error rather than a silently
ignored setting. `requirePreIntegration` must be a boolean and each phase must
be an array. The gate object is not closed by the same check: a key beyond
`key`, `command`, and `order` passes validation and appears in the `px config`
output, but gate execution reads only those three, so the extra key has no
effect. The schema does declare the gate object closed, so do not use extra
keys to carry data.

```json
{
  "adapters": {
    "gates": {
      "parallel": { "preIntegration": 2 },
      "preHandoff": [
        { "key": "build", "command": "npm run build", "order": 0 }
      ],
      "preIntegration": [
        { "key": "build", "command": "npm run build", "order": 1 },
        { "key": "integration-suite", "command": "npm run test:integration", "order": 2, "after": ["build"] }
      ]
    }
  }
}
```

Each configured command runs in the phase checkout — the mission's base
worktree for handoff and integration, the review checkout for the review
phase — and receives three environment values:

- `PARALLIX_MISSION_SLUG` — the mission slug.
- `PARALLIX_CHECKOUT_PATH` — the resolved checkout path the command runs in.
- `PARALLIX_PHASE` — the exact phase identifier: `handoff`, `review`, or
  `integration`.

A non-zero exit from any configured gate blocks that phase's state transition
or merge; a successful gate permits the normal transition. Gates are language
and toolchain neutral: the command may be `cmake --build` and `ctest` for a
C++ repository, `npm run build` for a Node one, or any other shell command.

`preHandoff` gates run before the handoff (`active` → `review`) transition.
`preReview` gates run when a review is submitted with the `approve` outcome —
that is, before the `review` → integration transition, not before the review
itself. `preIntegration` gates run before the integration merge. Configuring
one phase does not require configuring the others; unconfigured phases remain
gated-off.

`requirePreIntegration` opts the repository into a fail-closed integration
merge. It defaults to `false`, so an unconfigured repository completes the
integration path with no lifecycle gate. Set `"requirePreIntegration": true`
to make an empty or missing `preIntegration` list abort the merge instead of
proceeding — the equivalent of the historical mandatory-gate invariant. It is
repository configuration, not hardcoded product policy: one repository can
fail closed while another selects no gate at all.

## Workflow safeguards

Configuration does not waive the lifecycle checks. Before review, a handoff
checks the required mission artifacts and evidence, rebases on the primary
branch, and runs verification plus any declared gates. A failed check keeps the
mission with the implementer rather than consuming a reviewer round.

Integration requires a recorded reviewer approval, reruns the repository's
`adapters.gates.preIntegration` commands before merging, and verifies the exact
resulting tree. These built-in lifecycle controls remain in force alongside the
configurable gates above.

In the self-hosted workflow, integration removes stale active-task copies when
an existing completed record is canonical, preserving that completed history.
Every file beneath `backlog/archive` in the resulting payload blocks landing,
whether inherited from the base or reintroduced by a mission. Preserve any
needed history and commit the retired paths' deletion on the mission branch
before retrying. Recheck after a rebase: the new base may carry retired files
that the previously verified tree did not contain. The final landing guard checks a
disposable copy of the tree destined for the squash commit, including closeout
and excluding unrelated staged board changes. A failed check leaves the base
branch unchanged; a payload change during verification requires a retry.

When changing shipped core or default-opinion prompts, update the corresponding
entry in `test/fixtures/prompt-split-parent.json` in the same mission. Preserve
byte-identical assembly, instruction order and the prompt's non-blank content;
the integration consistency gate rejects an unmatched fixture before landing.

## Review classification

First reviews always use the general reviewer. Re-reviews with prior reviewer
findings or human/operator requests use one frozen obligation question per
obligation, against the last general-reviewer decided revision and the verified
current head. Intervening classifier returns retain that general-decision
baseline. Prior changes-requested F findings and human notes since that decision
are obligations, including requests revoking approval; system notes, cleared
stops and workflow trailers are excluded. Missing recorded revisions retain the
general reviewer.

This obligation route defaults to **shadow**: telemetry records each obligation's
probabilities and the aggregate decision, while the general reviewer retains
decision authority. Set `PARALLIX_JEV_OBLIGATION_REVIEW=on` explicitly to act on
its clear/return decisions. Before activation, collect at least 50 qualifying
post-change shadow rounds with no clear leaving a prior obligation unfixed
according to the general reviewer and no return on a reviewer-approved round.
New findings alone do not count as an unfixed prior obligation. Historical
px-0010 results do not satisfy this prospective confirmation requirement.
`PARALLIX_JEV_REVIEW=shadow` still keeps all classification in shadow, and its
opt-out disables classification.

The versioned obligation policy clears only when every obligation selects
`addresses` at probability at least 0.97. It returns when any obligation selects
`does_not_address` at probability at least 0.97, naming the failing obligations,
only after every call has returned a valid answer. Scores below either bar,
missing or failed calls, invalid answers and oversized mandatory packets defer
to the general reviewer. Each request includes the obligation, prior review
comment, implementer response and diff; budget fitting discloses omitted changes.

Nonqualifying re-reviews retain the experimental panel below. After two
consecutive classifier returns on those rounds, the next eligible panel round
hands off to the general reviewer. A general-reviewer decision or classifier
clear resets that count. Integration repair without human/operator requests
retains its weakening route.

The operator-selected experimental baseline asks three frozen resolution
questions in separate configured Jev calls. All three must finish successfully:
V3 votes to approve at a selected `addresses` probability of at least 0.51;
V1 votes to approve at 0.80 or reject at a selected `does_not_address` probability
of 0.89; the original question votes only to reject at 0.89. V3 rejection and
original approval channels are disabled. Confidence is not the routing score.
Approval votes without rejection clear the prior obligations; rejection votes
without approval return them to the implementer. Conflicts, no votes, incomplete
or invalid results, provider failures and stale revision/version results retain
the general reviewer. No partial panel can approve.

An integration repair without human/operator requests is judged by the weakening questions rather than that panel.
A substantive repair can be classified with or without an admitted green gate
re-run. A recorded result is admitted only when it names the failed gate, precedes
the review round, and covers the candidate or an equivalent mission patch.
Without an admitted fact, the packet says the failed gate has not been re-run at
this revision and that Parallix re-runs every integration gate before integration,
refusing integration if any fails. The classifier judges preservation, not whether
the failure is fixed. The frozen V4 question first asks whether the repair weakened or bypassed
the checked obligation (deleted, skipped or excluded the check, loosened
assertions, or raised a budget without measurement evidence); the approval is
restored when the answer selects `preserves` with probability at least 0.60.
If V4 does not clear, the frozen measured-limit V5 question asks the same packet
and uses the same threshold. V5 permits a resource-limit raise only for the check
that failed, when the failure lines report a measured overrun and the new limit
is finite and at most about twice that measured value. Commit messages never
replace that measurement; removing a limit, raising an entry that did not fail
or lowering a quality bar is weakening. A V4 clear makes no V5 call. The packet carries the
failed gate, its extracted failure lines, the plain prior-to-candidate diff
restricted to the files whose mission change differs (Backlog records excluded),
the repair commit subjects, both main baselines with the main commits a rebase
brought in, and the admitted gate fact or integration re-run guarantee. Baselines
are the recorded main commits each revision was built on, including when main
was rewritten; missing provenance retains general review.
Every other outcome (below threshold, weakens, insufficient
evidence, call failure, unavailable evidence, empty or bookkeeping-only repair,
over-budget packet) leaves the round with the general
reviewer, and the weakening answer can never return a mission to the implementer.
The restored approval records its own decision source and policy version with the
approved revision, candidate, gate, whether a fact was admitted, `preserves`
probability, the clearing question and both question versions. Validation revision,
time and relation are recorded only with an admitted fact. Classification never
replaces mandatory pre-integration gates.

Re-review packets start with the repair delta and changed paths even when
the prior findings and response do not cite them. When both review subjects
retain baselines, the repair is a comparison of their baseline-relative mission
changes, excluding changes made only on main. Both baselines and main commits
touching failure-cited paths are supplied as separate provenance, so a failure
fixed by main remains visible. Missing baselines are explicitly labelled as a
plain revision comparison that may include main changes.

Complete selected candidate files provide context. Admission uses the decision
provider's tokenizer accounting, with no fixed diff or packet byte ceiling.
All packet builders use the same omission order: optional whole-file context
first, then per-file diffs from largest to smallest token cost, then long commit
lists shortened with kept and dropped counts. Each omitted diff is named with
its added and removed line counts, and the packet states that those changes
were not shown. The panel must select insufficient evidence, and the weakening
question must not select preserves, when an omitted change could decide the answer.
The minimum mandatory request includes obligations, failure lines, validation,
the required omission manifest and fixed request/question overhead. If that
minimum cannot fit, the round defers to the general reviewer with
`evidence-over-budget` (or `weakening-over-budget`). No selectable candidate
excerpt records `evidence-preparation-fallback`; pinned read failures record
`evidence-read-failed`.
Classifier measurements record omitted diff counts and omitted token counts.
`px stats` separates clears with omissions from clears without omissions;
historical measurements without omission fields are shown as unknown.
Each final panel question also needs known provider accounting within 32,000
input tokens and 30,000 state-plus-longest-question tokens. `px stats` retains
fallback reasons for evidence, provider, conflict and stale-result failures.

The earlier archived packing baseline produced 17/46 supported decisions on the fitted development
corpus and one supported approval in a frozen 10-case cohort. Development
samples include synthetic and correlated repairs; the fresh cohort had only
historical approvals and three preparation failures. These observations do not
establish production coverage, rejection recall, zero error or workflow savings.
Scores are routing signals, not probabilities that the PR is correct.

The operator will collect ten new regular-development samples over 1–2 days
and evaluate them separately. Keep the questions, thresholds and route fixed; retain per-question choices, probabilities, votes, actual models and
bounded usage/cost with the panel outcome, revisions and evidence identity.
Replay exported local measurements against the frozen policy, then audit the
pinned source and original obligations. Report preparation failures, abstentions
and ambiguous cases separately. Compare relative agreement with the general
reviewer and source-supported correctness: a shared mistake is still an error.
This future study is not part of the implementation's completed evidence.

Configure the classifier through the operator environment used by the decision adapter.
Run `px setup` or `px setup-review` to provision its dedicated `jev` Forgejo
review identity and token alongside the review users. It is a classifier, not
an eligible coding-agent family. Its formal review and local decision record
identify the same candidate revision and original findings.

Set `PARALLIX_JEV_REVIEW=off` in the operator environment to opt out, or `shadow`
to collect classifier judgments while the general reviewer makes the decision.
The default is enabled when the decision adapter and review identity are
available. Invalid mode values disable routing. Missing classifier credentials or
review tokens leave ordinary review usable.

`px stats` shows one local-time PR Classification analysis table comparing this
week and last week for re-reviews, including open missions. Decided pull-request
rounds count once in the period of their approval or changes-requested decision.
Undecided rounds are excluded; decisions without classifier samples still count.
First-review totals use the same rule, although the displayed comparison is for
re-reviews.

Each decided round has one decider: classifier, mechanical restoration or general
reviewer. Classifier share divides classifier-decided rounds by all decided
rounds; an empty period shows n/a. Mechanical restorations have their own column
and do not contribute to the classifier numerator.

Attempted, fell-back, called, omission-evidence and fallback-reason measurements
come from samples, grouped by round and attributed by the latest sample time.
Retries count once per sampled round; any timed invocation counts as called.
These measurements are marked partial when the period predates sample coverage
or decided rounds lack samples. The first recorded sample time is shown.
Decided counts and classifier share remain available independently, including
periods before telemetry began. Statistics read local operational state without
querying Forgejo. Historical observation records remain stored but are no longer
read or written by classification or reported as correctness measurements.

Weekly and range reports also show the [bug-labeled mission trend](metric-contract.md#bug-labeled-mission-trend):
counts and shares for the current and previous rolling seven-day local-time delivery
populations, or the whole explicitly selected range including partial weeks.
Empty populations show “no completions”; unavailable history stays unavailable.
Mission state supplies bug labels, independently of classification flow counts
and Backlog labels.

## Environment variables

`src/composition/config.ts` resolves the supported host environment into frozen typed configuration at startup. Composition passes this configuration to adapters and use cases through arguments; they do not interpret individual environment variables. Numeric controls such as review polling and watchdog values are parsed there, and invalid values behave as unset. Child processes receive their launch environment separately. Pi runs its SDK and tools in an isolated child process so concurrent sessions do not change the orchestrator's environment.

`PARALLIX_CLI_ENTRYPOINT` and `PARALLIX_TERMINAL_RETURN_DIR` are set for child processes, not read as configuration.

| Name | Type | Default | Accepted values | Effect |
| --- | --- | --- | --- | --- |
| `AI_GATEWAY_API_KEY` | string | unset | any | Credential for the Vercel AI Gateway decision provider. |
| `AUTONOMOUS_REVIEW_POLL_INTERVAL_MS` | integer ms | built-in interval | positive integer; invalid falls back | Delay between autonomous review polls. |
| `AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS` | integer ms | built-in maximum wait | positive integer; invalid falls back | Longest wait for a reviewer verdict. |
| `CI` | flag | unset | any non-empty value | Marks a non-interactive CI run. |
| `CODEX_HOME` | path | `~/.codex` | directory | Source of Codex state and auth. |
| `DEBUG` | flag | unset | any non-empty value | Prints debug detail and full agent prompts. |
| `FORCE_COLOR` | flag | unset | standard | Forces colored output. |
| `FORGEJO_AUTHORIZED_APPROVER` | string | unset | Forgejo login | Only this login's approval counts. |
| `FORGEJO_GATEKEEPER_USER` | string | built-in gatekeeper user | Forgejo login | Account used by the gatekeeper. |
| `FORGEJO_HOME` | path | state-home default | directory | Forgejo credential and token home. |
| `FORGEJO_REPO` | string | derived from git remote or config | `owner/repo` | Review repository. |
| `FORGEJO_TOKEN` | secret | unset | any | API token for the current Forgejo user. |
| `FORGEJO_TOKEN_FILE` | path | per-user token file | file path | Token file for the current Forgejo user. |
| `FORGEJO_URL` | URL | config `baseUrl`, else `http://localhost:3300` | URL | Forgejo base URL. |
| `FORGEJO_USER` | string | built-in user | Forgejo login | Acting Forgejo identity. |
| `GIT_AUTHOR_EMAIL` | string | `workflow@example.invalid` | email | Author email for commits Parallix makes; falls back to this value when unset. |
| `GIT_AUTHOR_NAME` | string | `Workflow Setup` | any | Author name for commits Parallix makes; falls back to this value when unset. |
| `GIT_COMMITTER_EMAIL` | string | resolved author email | email | Committer email for commits Parallix makes. |
| `GIT_COMMITTER_NAME` | string | resolved author name | any | Committer name for commits Parallix makes. |
| `GRAPHIFY_BIN` | path | `PATH` lookup | executable | Graphify binary override. |
| `HOME` | path | OS home | directory | Home for state and credential lookup. |
| `JEV_CODE_PROVIDER` | enum | auto-detected from keys | `typesafe`, `openrouter`, `vercel` | Selects the decision provider. |
| `JEV_CODE_TIMEOUT_MS` | integer ms | `30000` | 1 to 120000 | Decision request timeout. |
| `LANG` | string | unset | locale | Locale forwarded to tools. |
| `LOCALAPPDATA` | path | unset | directory | Windows state-home base. |
| `LOGNAME` | string | unset | any | Login name for host identity. |
| `MISSION_YEAR_OVERRIDE` | string | current year | year | Overrides the year used in mission paths. |
| `NODE_TEST_CONTEXT` | flag | unset | set by `node --test` | Isolates Forgejo home during tests. |
| `NO_COLOR` | flag | unset | standard | Disables colored output. |
| `NVM_BIN` | path | unset | directory | Extra location when finding `pi`. |
| `OPENCODE_BIN` | path | `PATH` lookup | executable | OpenCode binary override. |
| `OPENROUTER_API_KEY` | secret | unset | any | Credential for the OpenRouter decision provider. |
| `PARALLIX_CLAUDE_RAW_STREAM` | flag | unset | any non-empty value other than `0` | Forwards Claude stream output unmodified. |
| `PARALLIX_CREDENTIAL_REDACTOR` | command | built-in redactor | command | Credential redactor for recovery evidence. |
| `PARALLIX_CLI_COMMAND` | command | unset | shell command | Command used to launch `px` in agents. |
| `PARALLIX_CLI_ENTRYPOINT` | path | unset | path | Entrypoint recorded for child CLI runs. |
| `PARALLIX_DEBUG_SQL` | flag | unset | any non-empty value | Logs SQLite statements. |
| `PARALLIX_HOME` | path | per-user state dir | directory | Operator state directory. |
| `PARALLIX_JEV_REVIEW` | enum | `on` | `on`, `shadow` (case-insensitive); any other value disables | Repeat-review classification mode. |
| `PARALLIX_KEEP_TEMP_ARTIFACTS` | flag | unset | `1` | Keeps OpenCode export temp files. |
| `PARALLIX_MISSION_SOCKET` | path | unset | socket path | Set for nested mission terminals. |
| `PARALLIX_MISSION_TERMINAL` | string | unset | slug | Set for nested mission terminals. |
| `PARALLIX_NO_BUBBLEWRAP` | flag | unset | any non-empty value other than `0` | Opts out of bubblewrap sandboxing. |
| `PARALLIX_NO_TUI` | flag | unset | `1` | Disables the interactive board. |
| `PARALLIX_TERMINAL_RETURN_DIR` | path | unset | directory | Repository root to return to from a mission terminal. |
| `PARALLIX_TERMINAL_STATE_DIR` | path | derived | directory | Terminal state root override. |
| `PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS` | flag | unset | `1` | Test-only: permits `--no-integration-gates`. |
| `PARALLIX_TEST_NO_FORGEJO` | flag | unset | `1` | Test-only: Forgejo reported unavailable. |
| `PATH` | path list | OS | standard | Executable lookup. |
| `PI_BIN` | path | `PATH` lookup | executable | Pi binary override. |
| `PRIMARY_WORKTREE` | path | derived from git | directory | Primary checkout override. |
| `SHELL` | path | OS | executable | User shell for terminals. |
| `TERM` | string | OS | terminal type | Terminal capabilities. |
| `TMUX` | string | unset | set by tmux | Detects a surrounding tmux session. |
| `TYPESAFE_API_KEY` | secret | unset | any | Credential for the Typesafe decision provider. |
| `TYPESAFE_BASE_URL` | URL | provider default | absolute HTTPS URL without credentials, query or fragment | Decision endpoint override. |
| `TYPESAFE_DEFAULT_MODEL` | string | `typesafe/jev-1.13-20260917` (Typesafe/OpenRouter); `typesafe-ai/jev` (Vercel) | model id | Decision model override. Vercel offers only a moving alias; its returned model may differ from the calibrated build. Token budgeting requires a supported tokenizer. |
| `USER` | string | OS | any | User name for host identity. |
| `VERIFY_AREA` | string | default area | area name | Default `px verify` area. |
| `WORKFLOW_AGENT` | enum | config | agent family | Overrides the selected agent. |
| `WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS` | number ms | `60000` | non-negative number | Initial no-output watchdog delay. |
| `WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS` | number ms | `60000` | non-negative number | No-output watchdog interval. |
| `WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG` | flag | enabled | `0` disables | No-output watchdog switch. |
| `WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS` | number ms | `15000` | non-negative number | Draft-step initial delay; independent of the general value. |
| `WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS` | number ms | `30000` | non-negative number | Draft-step interval; independent of the general value. |
| `WORKFLOW_REVIEW_AGENT_NO_OUTPUT_MAX_MS` | number ms | unset (no maximum) | non-negative number | Review-step maximum silence. |
| `WORKFLOW_SETUP_AGENT_PASSWORD` | secret | unset | any | Setup: agent account password. |
| `WORKFLOW_SETUP_AGENT_USERS` | string | unset | comma list | Setup: agent accounts. |
| `WORKFLOW_SETUP_FORGEJO_REPO` | string | unset | `owner/repo` | Setup: review repository. |
| `WORKFLOW_SETUP_FORGEJO_URL` | URL | unset | URL | Setup: Forgejo base URL. |
| `WORKFLOW_SETUP_NON_INTERACTIVE` | flag | unset | `1` | Setup: skip prompts. |
| `WORKFLOW_SETUP_OWNER_LOGIN` | string | unset | login | Setup: owner account. |
| `WORKFLOW_SETUP_OWNER_PASSWORD` | secret | unset | any | Setup: owner password. |
| `WORKFLOW_SETUP_PRODUCT_NAME` | string | directory name | any | Setup: product name. |
| `WORKFLOW_SETUP_REVIEW_PROVIDER` | enum | `none` | provider name | Setup: review provider. |
| `WORKFLOW_SETUP_REVIEW_REMOTE` | string | unset | remote name | Setup: review git remote. |
| `WORKFLOW_TMP_DIR` | path | OS temp dir | directory | Temporary files location. |
| `XDG_CACHE_HOME` | path | `~/.cache` | absolute directory; relative values are ignored | Base of the OpenCode cache state home. |
| `XDG_CONFIG_HOME` | path | `~/.config` | absolute directory; relative values are ignored | Base of the OpenCode config state home. |
| `XDG_DATA_HOME` | path | `~/.local/share` | absolute directory; relative values are ignored | Base of the OpenCode data state home. |
| `XDG_RUNTIME_DIR` | path | unset | directory | Runtime and socket base. |
