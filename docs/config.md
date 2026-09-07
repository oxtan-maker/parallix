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

`adapters.verification.command` is an optional string. When present, it is run
through the shell and every `{{area}}` token is replaced with the selected
verification area. When absent, verification is a successful no-op.
`defaultArea` is an optional string, default `docs`, used when no explicit or
diff-derived area is available.

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

`adapters.agents.maxConcurrentCustom` is an optional positive integer. Its
default is unlimited custom-agent launches. `models` is an object whose keys
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

## Integrate

`adapters.integrate.postIntegrateCommand` is an optional string with no default.
After a successful non-dry-run integration, Parallix runs it once from the base
checkout. The command receives `INTEGRATE_HOOK_SLUG`,
`INTEGRATE_HOOK_BASE_WORKTREE`, `INTEGRATE_HOOK_BASE_BRANCH`, and
`INTEGRATE_HOOK_VARIANT` in its environment.

```json
{
  "adapters": {
    "integrate": { "postIntegrateCommand": "./scripts/refresh-px.sh" }
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
prose), and an optional numeric `order` (default `0`; gates run in ascending
order).

`adapters.gates` is a closed section: `requirePreIntegration`, `preHandoff`,
`preReview`, and `preIntegration` are its only permitted keys, so a typo such
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
      "preHandoff": [
        { "key": "docs-verification", "command": "./scripts/verify-local.sh docs", "order": 0 }
      ],
      "preIntegration": [
        { "key": "build", "command": "npm run build", "order": 1 },
        { "key": "integration-suite", "command": "npm run test:integration", "order": 2 }
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
`preReview` gates run before the review phase. `preIntegration` gates run
before the integration merge. Configuring one phase does not require
configuring the others; unconfigured phases remain gated-off.

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
