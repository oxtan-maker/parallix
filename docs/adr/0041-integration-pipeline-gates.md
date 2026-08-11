# ADR 0041: Integration-time pipeline gates + per-area gate dehallucination

Status: Accepted

## Context

The repo runs integration via `node workflow integrate`, which currently performs only preflight checks and squash-merge operations. There are two active problems:

1. **Missing integration-time gates:** Staging deploy and e2e validation do not run as part of integration. task-1093 recorded that "I have not been running the full e2e web tests flows as part of the mission integration, as a result of this the store tests have been failing." This creates a gap where integration can land code that breaks staging.

2. **Network-dependent per-area web gate:** The `web` verifier used to invoke staging Playwright checks even though its documented contract covered local lint, type checking, tests, coverage, and build work. Since staging is not redeployed on every agent edit, that check can validate a local diff against a stale, unrelated environment, producing **green false positives when the diff is broken** and noise when staging is sick for unrelated reasons.

ADR 0028 (line 58) explicitly noted "the current CI lane currently proves wiring and review visibility more than full clean-checkout confidence; broader PR-time gates remain a follow-up tradeoff decision." This ADR addresses that follow-up.

Task-1063 is extracting `workflow/` as a standalone product. Any integration pipeline must therefore read visualBoard-specific paths from a **repo-side config file**, not hardcode them into `workflow/lib/*.js`.

## Options Evaluated

| Option | Local-first fit | Config seam | Credentials burden | Visibility | Abort-before-merge | Reusability |
|--------|-----------------|-------------|-------------------|------------|-------------------|-------------|
| **A. CLI preflight (in `node workflow integrate`)** | High | Repo config | None (workstation) | CLI output | Yes | Single path |
| **B. Forgejo Actions / runner-side** | Medium | Repo config | Runner: docker push + kustomize | PR UI | Yes | PR-time + manual |
| **C. Hybrid via new `integrate` area in `verify-local.sh`** | High | Repo config | None (workstation) | CLI output | Yes | Both `integrate` CLI and future Actions |

### Option A: CLI preflight (in `node workflow integrate`)

Have integration preflight read a repo-side config and dispatch area gates before the dry-merge step.

**Pros:**
- Same process as the squash; easy abort before merge
- No new runner credentials needed
- No new services to maintain

**Cons:**
- Long-running build/deploy becomes part of a CLI command on the workstation
- Progress/visibility limited to terminal output

### Option B: Forgejo Actions / runner-side

Create new `.forgejo/workflows/integrate.yml` triggered on `mission/**` branch updates or PR open.

**Pros:**
- Visible in PR UI
- Reproducible runner environment
- Matches ADR 0028's broader-PR-gate trigger

**Cons:**
- Requires runner to hold docker push + kustomize credentials
- Longer feedback loop (runner availability, queue time)
- Grows ops surface (runner lifecycle, secrets management)

### Option C: Hybrid via a new `integrate` area in `scripts/verify-local.sh`

Add an `integrate` area to `./scripts/verify-local.sh` that performs change detection and per-area dispatch. Both `node workflow integrate` and a future Forgejo workflow file invoke it.

**Pros:**
- One dispatch surface, no duplication
- `workflow/lib/*` stays generic (config in repo)
- Reusable by both CLI and future runner-based CI

**Cons:**
- Still requires gating `node workflow integrate` to require it
- Needs an executable spec for the area-key\u21a6command map

## Decision

**Choose Option C: Hybrid via new `integrate` area in `scripts/verify-local.sh`**, with `node workflow integrate` invoking it as a preflight step.

**Rationale:**

- **Local-first preservation:** Option C keeps execution on the workstation without introducing new credentials or services. Option B would require docker push + kustomize credentials on the runner, which is a material ops burden not justified by current signal.
- **Workflow-product boundary:** The area-key\u21a6command map lives in a repo-side config file (`config/integration-pipelines.json`). This preserves the task-1063 workflow-product boundary — no visualBoard-specific paths appear in `workflow/lib/*.js`.
- **Future extensibility:** Once Option C is proven locally, a Forgejo Actions workflow can invoke the same `integrate` area. This defers the runner credential question until we have evidence that the local workstation cannot handle the load.
- **Abort-before-merge invariant:** The dispatch runs during integration preflight, before squash-merge, so any gate failure aborts before the merge lands.

### Follow-up trigger

Revisit Option B (Forgejo Actions) when the median `pr_fix_rounds` across a trailing 20-mission window exceeds 2, **or** when the local workstation proves unable to complete integration gates within 30 minutes wall-time for a typical single-area mission. This trigger is grounded in the available `workflow/data/stats.csv` signal.

## Data and Evidence

### 1. Originating incident

> task-1093 (closed 2026-05-16):
> > "I have not been running the full e2e web tests flows as part of the mission integration, as a result of this the store tests have been failing."

This mission (task-1094) was filed nine minutes later. The incident directly links missing integration-time e2e execution to production failures.

### 2. Help/implementation drift

The former `web` verifier included:
```bash
run_gate "web:e2e"      sh -c "cd web-client && ./scripts/run-playwright-stage.sh"
```

Its documented contract stated:
```
web      — lint + tsc + jest + coverage (85% gate) + Next.js build
```

The help text **excludes** e2e. This shows the staging check was unintentional drift, not a designed gate.

### 3. Per-area gate audit

The remaining area gates had no equivalent network-dependent check:

- server and auth: checkstyle, spotbugs, compile, and test — all local
- android: detekt and unit-jacoco — all local
- k8s: dry-run validation
- deps: dependency scanning

**Result:** The hallucination is isolated to `gate_web:web:e2e`.

### 4. Available rate signal from `workflow/data/stats.csv`

The stats file contains 54 rows as of 2026-05-22 with columns: `date,mission,classification,implementer,pr_fix_rounds`.

For the last 20 missions (rows 35-54):
- `pr_fix_rounds` sorted: `[0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 8]`
- **Median:** 1.0
- **Max:** 8
- **Count with `pr_fix_rounds >= 3`:** 2 (missions with 4 and 8 rounds)

**Interpretation:** The current median of 1.0 suggests most missions do not require multiple fix rounds. However, the presence of outliers (max=8) indicates that some missions do benefit from earlier detection. This is an imperfect proxy for "would integration-time gates have caught the regression earlier" because it measures review rounds, not integration failures. The limitation is acknowledged.

### 5. Reasoning chain

Option B (Forgejo Actions) would require runner credentials for docker push and kustomize. The only data point that would justify that ops cost is **sustained `pr_fix_rounds >= N` after Option C lands**, demonstrating that local-first execution is insufficient. We adopt **Option C now** — which needs no new credentials and preserves the local-first model — and set the follow-up trigger at `pr_fix_rounds median >= 2 over a trailing 20-mission window`. This threshold is above the current median (1.0) and would be crossed if integration-time gates become systematically necessary.

## Consequences

### Positive

- Integration-time staging deploys and e2e run **before** the squash-merge lands, catching regressions earlier
- Per-area `web` gate becomes deterministic against local source (no false positives from stale staging)
- Workflow-product boundary preserved: visualBoard-specific paths live in repo config, not in `workflow/lib/*`
- One dispatch surface (`integrate` area) reusable by CLI and future CI

### Negative

- Integration (`node workflow integrate`) wall-time increases by minutes for missions touching multiple areas
- New config file (`config/integration-pipelines.json`) requires maintenance
- Agents must learn a new area (`integrate`) and its opt-out flag (`--no-integration-gates`)

## Deliverables

1. **Repo-side config:** `config/integration-pipelines.json` with entries for `server`, `auth-server`, `web-client`, `web-e2e`; `web-e2e` carries `run_last: true`. Task-1362 added a `lib` entry mapping to `./scripts/verify-local.sh static-analysis` as a required gate for `lib/` changes.
2. **Change detection:** Compute the set of top-level dirs touched by `mission/<slug>` vs the primary branch
3. **Dispatch in `scripts/verify-local.sh`:** New `gate_integrate()` function and `integrate` area in the case statement
4. **`node workflow integrate` preflight:** Calls the new `integrate` area as part of `printIntegrationPreflight`
5. **`--no-integration-gates` flag:** Explicit opt-out for emergencies (Hard Rule #2 preserved)
6. **`--dry-run` enhancement:** Prints the resolved gate plan (ordered list) and exits without executing
7. **Web-gate fix:** Remove the staging e2e check from the local `web` gate
8. **Tests:** Unit tests in `scripts/test/` for change-detection, ordering, missing/empty config, command failure abort, dry-run
9. **ADR update:** This document, added to `docs/adr/index.md`
10. **Docs:** Update `AGENTS.md` Section 2 and `workflow/README.md`

## See Also

- ADR 0028: Integration review surface and CI posture
- ADR 0039: Draft phase discipline and requirements language
- task-1063: Workflow product extraction
- task-1093: Originating incident (e2e tests broken)
- `workflow/data/stats.csv`: Mission stats with `pr_fix_rounds`
