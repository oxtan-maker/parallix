# Automatic repair prompts

## repair

{{label}} — FRESH-CONTEXT DIAGNOSTIC REPAIR REQUIRED

Mission: {{slug}}
{{worktreeLine}}{{facts}}

Original failure evidence (this is not necessarily the root cause):
---
{{originalDiagnostic}}
---
Latest failure evidence (this is not necessarily the root cause):
---
{{latestDiagnostic}}
---

Classification: {{failureClass}} — {{dispatchAction}}
Recovery strategy: fresh-diagnostic ({{attempt}}/{{maxAttempts}})
Retry attempt: {{attempt}}/{{maxAttempts}}

{{evidenceRoute}}
{{authorityRoute}}

You have a fresh context. Re-diagnose the failure from the repository and exact evidence; do not assume either diagnostic identifies the root cause.
Before repair, reload px status {{slug}} --json for the locked goal, scope, success criteria, gates, review disposition and authorized repair/checkpoint obligations. Read applicable AGENTS.md repository rules and inspect the current branch revision and working-tree edits. If authority or evidence is missing, incomplete or stale, report that explicitly; do not invent retrieval or treat an old revision as current proof.
This dedicated repair prompt defines this launch; do not inherit prior execute/review conversation instructions or review-approval authority. Honor recorded operator decisions and the authorized mission behavior. Preserve locked gates and success criteria; investigate and repair failures rather than bypassing checks or claiming unverified success.
{{remedy}}
The failing check re-runs automatically after your fix; this bounce is only reported as fixed when that re-run passes.
Perform the repair and preserve valid commits and working-tree edits already in the mission worktree; do not reset, clean or silently recommit unrelated work. Commit tracked repair changes as required above. Only the harness rerunning this exact failing check can establish success.

## authority

REPAIR AUTHORITY: These dedicated instructions govern this session, including resumed execute or act-on-review context. Preserve locked gates and success criteria. Test code and assertions are repairable within the authorized mission after investigating the behavior they protect.
Before changing a test, inspect its owning suite, nearby assertions and Git history to understand why the test exists. Trace what this mission changes through the production callers and compare the failure with the authorized behavior. If it exposes a product regression, fix the production code. If the authorized change supersedes the old expectation, update the test while preserving distinct safety and behavioral coverage. Make this decision yourself within the authorized mission, explain the evidence and product risks in the repair checkpoint, and verify the repaired behavior. A failing assertion or the need to edit a test is not a reason to request human attention. Escalate only an unresolved product decision or conflict with locked gates, scope or success criteria that you cannot resolve from the mission, recorded operator decisions and repository evidence; identify the conflicting requirements, investigated alternatives and behavioral consequences.
Run px checkpoint check --slug {{slug}} --json before declaring completion. Inspect ready and primaryStopReason. A recorded unresolved human-only contract blocker is the primary stop reason even when checkpoint evidence is incomplete: stop for the operator; do not fabricate proof, start repeated evidence-only repair, use record --force, or treat prose as resolution. Only an explicit operator decision can clear the recorded blocker.
Only a successful harness rerun of the authorized required check establishes repair success; an unrelated passing test or an agent claim does not.

## checkpoint

Harness-created repair checkpoint: {{checkpointName}}; Version at launch: {{checkpointVersion}}.
Within the locked scope and success criteria, record verifiable evidence with px checkpoint record --name {{checkpointName}} --criterion "<exact affected success criterion>" --evidence "<verifiable reference and result>" --next "<specific next action>" for {{checkpointName}}, and the same command with --name <CP-N> for every other planned checkpoint (for example an original CP-3) still without recorded evidence. The write resolves its own current version. Retain valid earlier evidence for unaffected criteria without restating it; affected criteria need fresh verifiable evidence from this round. If the fix shows earlier evidence is no longer accurate, re-record that checkpoint with corrected fresh evidence for the criteria it affects. Every planned checkpoint needs evidence and every success criterion must be covered before review preparation. Complete every remaining planned checkpoint before review preparation. Do not edit locked scope or criteria, weaken or bypass gates, or self-approve: independent review stays the approver.

## report

Only if that investigation establishes an unresolved conflict requiring a product decision outside your authority, run px checkpoint report-invalid-contract --name {{checkpointName}} --command "<exact failing command>" --diagnostic "<exact diagnostic>" --authority-reason "<investigated conflict requiring operator authority>" --proposed-correction "<operator correction>", then stop. The first report stops automatic repair retries and routes that unresolved decision to human review.

## report-without-checkpoint

Only after establishing an unresolved conflict outside your authority, report it with command, diagnostic, authorityReason and proposedCorrection, then stop for human review.

## repair-authority

Diagnose the actual cause from the failed check and its logs; do not assume it is a test or code path inside the original mission scope. Repair the cause wherever it lies within your authority (repository code, tests, configuration, the local environment, or runner configuration). Preserve locked gates and success criteria, mission deliverables and safety boundaries; do not suppress failures or reduce behavioral coverage merely to obtain a passing check. If the repair changes tracked files, commit it before the automatic re-verification: the re-run verifies the committed mission tree, so an uncommitted repair cannot be verified and is reported as still failing. A repair outside the repository needs no commit. If the cause is external and you cannot repair it (for example a model service or network dependency that is down), make no speculative changes: report the exact blocker with its evidence and stop, because another repair attempt cannot fix it.

## mission-outcome

the locked goal and success criteria of {{slug}} (px status {{slug}}), delivered with this check passing

## integration-cause

The integration gate (not the review gate) failed: the mission was reviewed and approved, then a red pre-integration gate rejected the finalized tree on the way to a human integration. Repair the integration failure, not a review finding.

## gate

Start with the listed gate command in the listed worktree and the captured failure output. Do not substitute a broader verification command or integration suite to rediscover the failure. {{repairAuthority}}

## hook

Make the Git hook pass when Parallix commits or rebases this mission. {{repairAuthority}}

## rebase

Review shared conflicts semantically in the mission worktree. Before resolving unexpectedly replayed inherited work, inspect the target branch, Git history and actual diffs. Preserve intended Mission changes and current base behavior, including relocations and completed work; do not restore obsolete code or task metadata merely to apply an old commit or use blanket ours/theirs. Use ordinary Git rebase tools when the intended range is clear; otherwise explain the specific uncertainty with paths and evidence. Stage every resolved path and continue through successive pauses until Git reports no rebase and no unmerged paths. Stop on ambiguous intent or a human-only decision.

## review-preparation

Fix the underlying issue so review preparation verification passes.

## declaration

Stop and request an operator decision for this mechanically invalid declaration; do not replace your own locked check.

## artifacts

Produce the complete {{role}} artifacts the workflow requires.

## timeout

Produce {{output}} and report it through the normal review artifact or provider path.

## history

Earlier agent runs of this mission are searchable with `px history search <pattern>` and `px history show <ref>` (bounded; cite the run: references).

## evidence-read

Read the stdout/stderr files directly. Repository APIs (not CLI commands or callable agent tools; use the captured mission identity): listRecoveryEvidence({ cwd }) or lookupRecoveryEvidence({ cwd, incidentId: "{{incidentId}}" }).

## reviewer-output

{{label}}
Reviewer output recovery. You have a fresh context. You remain the independent reviewer.
Retry attempt: {{attempt}}/{{maxAttempts}}
{{expectedOutput}}{{evidenceRoute}}
Mission: {{slug}}; attempt {{attempt}}/{{maxAttempts}}.
Original failure: {{originalDiagnostic}}
Latest failure: {{latestDiagnostic}}
Read px status {{slug}} --json and the current revision; complete the remaining independent review obligations.
Submit your verdict through px verdict approve or px verdict request-changes with the assigned reviewer actor. You have authority to approve a correct fix.
Read applicable AGENTS.md repository rules. Inspect the current branch revision and working-tree edits. If evidence is missing or stale, report it explicitly. This retry requires reviewer output only. Preserve the mission tree and report any workflow rejection with its cause and supported operator recovery action.
