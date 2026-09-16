/**
 * Integration preflight: every blocking fact is checked and printed loudly;
 * successful facts move behind DEBUG so the default happy path carries the
 * operator's trust decision (the readiness view) instead of a PASS cascade of
 * equal visual priority (TASK-2479).
 */
import path from 'node:path';
import * as fmt from '../presentation/cli-format.js';
import { isDbAdhocIdentity } from '../../domain/mission.js';
import { evaluateTaskStatusForIntegration, type TaskStatusCheck } from './approval.js';
import { checkReviewProvider } from './preflight-review.js';
import { checkIntegrationCheckout } from './preflight-checkout.js';
import { VARIANT_B_AUTOMATION_SUMMARY, baseTaskSlug } from './support.js';
import type {
  IntegrateCheckoutPort,
  IntegrateForgejoPort,
  IntegrateGitPort,
  IntegrateGitRunner,
  IntegrateMissionPathsPort,
  IntegrateWorkflowPorts,
} from '../ports/integrate-workflow.js';

export interface PreflightOptions {
  readTokenFn?: IntegrateForgejoPort['readToken'];
  resolveTokenFileFn?: IntegrateForgejoPort['resolveTokenFile'];
  detectRebaseStateFn?: IntegrateGitPort['detectRebaseState'];
  getUnresolvedIndexConflictsFn?: IntegrateCheckoutPort['getUnresolvedIndexConflicts'];
  findMissionDocInBranchesFn?: IntegrateMissionPathsPort['findMissionDocInBranches'];
  isForgejoReviewEnabledFn?: (_rootDir: string) => boolean;
  gitFn?: IntegrateGitRunner;
  // Matches `fmt.log.plain`, the production default.
  log?: (_text: string) => unknown;
}

/** Findings accumulated across the preflight sections, in print order. */
export interface PreflightReport {
  readonly failures: string[];
  readonly warnings: string[];
  readonly log: (_text: string) => unknown;
  /** A successful fact: printed only under DEBUG. */
  detail(_text: string): void;
}

export function createIntegrationPreflight(ports: IntegrateWorkflowPorts) {
  const { missionPaths, backlog } = ports;

  function reportStatusCheck(report: PreflightReport, check: TaskStatusCheck) {
    if (!check.ok) {
      report.failures.push('task-status');
      report.log(fmt.status('FAIL', `${check.message}`));
    } else if (check.level === 'warn') {
      report.warnings.push('task-status-review-approved');
      report.log(fmt.status('WARN', `${check.message}`));
    } else {
      report.detail(`${check.message}`);
    }
  }

  function checkMissionDoc(report: PreflightReport, context: any, baseWorktree: string, findMissionDocInBranchesFn: NonNullable<PreflightOptions['findMissionDocInBranchesFn']>) {
    if (context.missionDir) {
      report.detail(`Mission doc: ${path.join(context.missionDir, 'MISSION.md')}`);
      return;
    }
    report.failures.push('mission-doc');
    // Use the base slug for the canonical path even when the working slug
    // carries a suffix.
    const canonicalPath = path.relative(
      baseWorktree,
      path.join(missionPaths.missionDirForSlug(baseWorktree, baseTaskSlug(context.slug)), 'MISSION.md'),
    ).split(path.sep).join('/');
    report.log(fmt.status('FAIL', `Mission doc: ${canonicalPath} not found`));

    const candidates = findMissionDocInBranchesFn(context.slug, baseWorktree);
    if (candidates && candidates.length > 0) {
      report.log(fmt.status('INFO', `Found mission doc candidates on other branches. To recover, run:`));
      candidates.forEach(candidate => {
        report.log(fmt.status('INFO', `  git show ${candidate.branch}:${candidate.path} > ${canonicalPath}`));
      });
    }
  }

  function checkTask(report: PreflightReport, context: any) {
    if (context.task.ok) {
      report.detail(`Backlog task: ${path.basename(context.task.taskFile)} (${context.missionStatus || 'mission store'})`);
      try {
        const classification = backlog.getTaskClassification(context.task.taskFile);
        if (!classification) {
          report.failures.push('classification');
          report.log(fmt.status('FAIL', `Backlog classification: Missing or invalid classification for ${context.slug}; expected exactly one of ai_sdlc, user_value, or unknown in the labels of ${context.task.taskFile}. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.`));
        } else {
          report.detail(`Backlog classification: ${classification}`);
        }
      } catch (error) {
        report.failures.push('classification');
        report.log(fmt.status('FAIL', `Backlog classification: ${(error as Error).message || String(error)}`));
      }
      reportStatusCheck(report, evaluateTaskStatusForIntegration(context, ports.stateMap));
    } else if (context.task.reason === 'ambiguous') {
      report.failures.push('task-ambiguity');
      report.log(fmt.status('FAIL', `Backlog task: ambiguous slug ${context.slug}`));
      if (context.task.matches) {
        context.task.matches.forEach((match: string) => report.log(`  - ${match}`));
      }
    } else if (isDbAdhocIdentity(context.slug)) {
      // An adhoc mission has no Backlog task to find: the Mission store carries
      // its status and labels (ADR 0053), so read them there rather than warning
      // about the absence of a file this intake never creates in the base
      // checkout.
      report.detail(`Backlog task: none — adhoc mission, Mission store is authoritative`);
      const classification = backlog.classificationFromLabels(context.missionLabels || []);
      if (classification) {
        report.detail(`Mission classification: ${classification}`);
      } else {
        report.failures.push('classification');
        report.log(fmt.status('FAIL', `Mission classification: expected exactly one of ${[...backlog.classificationLabels()].join(', ')} in the Mission labels for ${context.slug}.`));
      }
      reportStatusCheck(report, evaluateTaskStatusForIntegration(context, ports.stateMap));
    } else {
      report.log(fmt.status('WARN', `Backlog task: no task file found for ${context.slug}; continuing with synthetic/unknown task metadata.`));
      report.detail('Backlog classification: unknown');
    }
  }

  function printIntegrationPreflight(context: any, options: PreflightOptions = {}) {
    const {
      readTokenFn = ports.forgejo.readToken,
      resolveTokenFileFn = ports.forgejo.resolveTokenFile,
      detectRebaseStateFn = ports.git.detectRebaseState,
      getUnresolvedIndexConflictsFn = ports.checkout.getUnresolvedIndexConflicts,
      findMissionDocInBranchesFn = missionPaths.findMissionDocInBranches,
      isForgejoReviewEnabledFn = ports.productConfig.isForgejoReviewEnabled,
      gitFn = ports.git.git,
      log = fmt.log.plain,
    } = options;
    // A null/undefined slug means the caller failed to resolve a real mission
    // before building preflight context. Fail loudly here instead of letting
    // "null" leak into operator-facing branch/path expectations below.
    if (!context.slug) {
      throw new Error('printIntegrationPreflight requires a context with a non-null mission slug.');
    }

    const report: PreflightReport = {
      failures: [],
      warnings: [],
      log,
      detail: (text: string) => { if (process.env.DEBUG) { log(fmt.status('DEBUG', text)); } },
    };

    // The integration "checkout" is the mission's base worktree on its base branch.
    // For legacy missions these fall back to the primary worktree/branch, so the
    // preflight output and checks are byte-identical to today.
    const baseWorktree = context.baseWorktree || missionPaths.getPrimaryWorktree();
    const baseBranch = context.baseBranch || missionPaths.getPrimaryBranch();

    report.detail(`Integration preflight for ${context.slug}`);

    const branchPrefix = missionPaths.missionBranchName(context.slug, baseWorktree);
    if (context.currentBranch === context.branch || context.currentBranch.startsWith(`${branchPrefix}-`)) {
      report.detail(`Mission branch: ${context.currentBranch}`);
    } else {
      report.failures.push('branch');
      log(fmt.status('FAIL', `Mission branch: current branch is ${context.currentBranch}, expected ${context.branch} (or a branch with a suffix)`));
    }

    checkMissionDoc(report, context, baseWorktree, findMissionDocInBranchesFn);
    checkTask(report, context);

    if (isForgejoReviewEnabledFn(baseWorktree)) {
      checkReviewProvider(report, context, { baseWorktree, baseBranch, readTokenFn, resolveTokenFileFn });
    } else {
      report.detail('Forgejo PR/approval checks skipped (review provider is not forgejo).');
    }

    if (context.taskAssigneeWarning) {
      report.warnings.push('task-assignee');
      log(fmt.status('WARN', `${context.taskAssigneeWarning}`));
    }

    checkIntegrationCheckout(report, context, ports, { baseWorktree, baseBranch, detectRebaseStateFn, getUnresolvedIndexConflictsFn, gitFn });

    report.detail('Forgejo configuration: allow_manual_merge assumed enabled');

    if (report.warnings.length > 0) {
      log(fmt.status('WARN', `Integration warnings: ${report.warnings.join(', ')}`));
    }

    report.detail(`${VARIANT_B_AUTOMATION_SUMMARY}`);

    return { failures: report.failures, warnings: report.warnings };
  }

  return { printIntegrationPreflight };
}
