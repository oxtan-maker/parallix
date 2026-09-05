# Configuration reference

`workflow.config.json` is optional. Parallix merges its contents over built-in
defaults; run `px config` to see the effective result for the current checkout.
Use JSON values of the types listed below. Invalid JSON and invalid top-level
or adapter-section shapes report a failure and print fallback defaults; the
real CLI currently exits zero for those failures (see the known gaps below).

Field-level schema enforcement is not complete yet; see the known gaps below.
Until that is fixed, use the documented types and the schema as the contract.

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
with string `tasksDir` and `completedDir` members. A string normally names the
storage root, below which Parallix derives its `tasks`, `completed`, archive,
and draft directories. If the string ends in `tasks`, it is the tasks directory
itself and the sibling directories are derived from its parent. The object form
overrides the two named directories.

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

```json
{
  "adapters": {
    "review": {
      "provider": "forgejo",
      "baseUrl": "http://localhost:3300",
      "remote": "review",
      "repo": "acme/delivery"
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
defaulting to no limit; zero also means no limit.

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

## Workflow safeguards

Configuration does not waive the lifecycle checks. Before review, a handoff
checks the required mission artifacts and evidence, rebases on the primary
branch, and runs verification plus any declared gates. A failed check keeps the
mission with the implementer rather than consuming a reviewer round.

Integration requires a recorded reviewer approval, reruns the repository's
configured integration gates before merging, and verifies the exact resulting
tree. These built-in lifecycle controls are language-neutral, but they are not
configurable hooks. The only hook setting today is the post-integration
maintenance command above; configurable hooks around handoff, review, and
integration are tracked in [TASK-2457](../backlog/tasks/task-2457%20-%20make-lifecycle-guard-hooks-configurable.md).

## Known configuration gaps

The following schema-declared fields are deliberately not presented as working
overrides because the audit found no end-to-end runtime effect:

- `adapters.tasks.provider`: [TASK-2455.02](../backlog/tasks/task-2455.02%20-%20make-task-provider-config-effective.md)

`px config` currently does not validate individual schema field types, enums,
or unknown properties (except `adapters.tasks.provider` and
`agents.maxConcurrentCustom`); that issue is
tracked in [TASK-2455.03](../backlog/tasks/task-2455.03%20-%20enforce-workflow-config-schema-validation.md).

Malformed JSON also currently reports a failure while the real CLI process exits
zero; that process-status defect is tracked in [TASK-2455.04](../backlog/tasks/task-2455.04%20-%20preserve-config-command-failure-exit-status.md).
