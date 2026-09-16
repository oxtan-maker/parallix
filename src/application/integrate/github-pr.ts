/**
 * `github-pr` integration mode: GitHub owns the merge. A local ref is never
 * evidence; the fresh PR observation is the sole route to lifecycle completion.
 */
import * as fmt from '../presentation/cli-format.js';
import { missionId } from '../../domain/mission.js';
import type { createIntegrationStrategy } from '../services/integration-dispatch.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';

export interface GithubPrLanding {
  slug: string;
  context: any;
  missionServices: any;
  strategy: ReturnType<typeof createIntegrationStrategy>;
}

export function createGithubPrLanding({ git, github, missionPaths }: IntegrateWorkflowPorts) {
  /** Returns false when the PR is not merged yet; the mission stays incomplete. */
  async function landThroughGithubPr({ slug, context, missionServices, strategy }: GithubPrLanding): Promise<boolean> {
    const { baseWorktree, baseBranch } = context;
    const branch = missionPaths.missionBranchName(slug, baseWorktree);
    const candidateSha = git.git(['-C', baseWorktree, 'rev-parse', branch]).stdout.trim();
    // TASK-2517 SC2: submitting or merging the PR is the irreversible step, so
    // the lane must be able to accept the `integrate` decision before it runs.
    // A rebounded (`active`) mission aborts here with zero remote effects.
    const loaded = await missionServices.store.load(missionId(slug));
    // SC2 (task-2517): the lane must be able to accept the `integrate` decision
    // before any remote effect. `decideMission('integrate')` requires
    // `requireStatus(mission, ['integration'])`, so only `integration` and
    // `done` may reach a PR submit/merge. A rebounded (`active`) or otherwise
    // stranded lane aborts here with zero remote side effects. The production
    // flow restores an approved `review` lane to `integration` before landing
    // (SC1), so admitting `review` here would be dead permissiveness — the
    // decision would run after the PR is merged and then reject, stranding the
    // exact change SC2 is written to prevent.
    if (
      loaded.kind !== 'found'
      || (loaded.mission.status !== 'integration'
        && loaded.mission.status !== 'done')
    ) {
      const status = loaded.kind === 'found' ? loaded.mission.status : loaded.kind;
      throw new Error(`Cannot integrate while ${slug} is ${status}; expected integration. Aborting before the GitHub PR is submitted or merged.`);
    }
    const observation = await strategy.run('observe-external-integration', () =>
      github.submitOrObserveGithubPr({ head: branch, base: baseBranch, candidateSha }, baseWorktree));
    if (observation.kind !== 'merged') {
      fmt.log.warn(`GitHub PR integration is ${observation.kind}; mission remains incomplete.`);
      if (observation.kind === 'unavailable') { fmt.log.fail(`GitHub observation unavailable: ${observation.error}`); }
      return false;
    }
    const operation = `${slug}:${observation.resultingSha}`;
    const integrated = await missionServices.integration.decideIntegration({
      operationId: `github-pr-integrate:${operation}`,
      missionId: missionId(slug), capabilities: new Set(['integration:decide']),
      idempotencyKey: `github-pr-integrate:${operation}`,
      actor: context.taskAssignee ?? 'custom',
      facts: { git: { source: 'github', status: 'fresh', value: { merged: true } }, verification: { source: 'integration-gates', status: 'fresh', value: { passed: true } } },
    });
    if (integrated.status !== 'completed') { throw new Error(`GitHub integration transition failed: ${integrated.error?.message || 'unknown error'}`); }
    const closed = await missionServices.integration.close({
      operationId: `github-pr-close:${operation}`,
      missionId: missionId(slug), capabilities: new Set(['closure:record']),
      idempotencyKey: `github-pr-close:${operation}`,
      actor: context.taskAssignee ?? 'custom', closedAt: new Date().toISOString(),
      integration: { source: 'github', status: 'fresh', value: { completed: true } },
    });
    if (closed.status !== 'completed') { throw new Error(`GitHub mission closure failed: ${closed.error?.message || 'unknown error'}`); }
    fmt.log.pass(`GitHub PR #${observation.number} merged into ${observation.base}; mission completed.`);
    return true;
  }

  return { landThroughGithubPr };
}
