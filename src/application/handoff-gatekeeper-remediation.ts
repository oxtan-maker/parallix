/**
 * Gatekeeper pushback handling: classify the gatekeeper outcome and run
 * the bounded agent relaunch that repairs missing artifacts.
 */

import * as fmt from './presentation/cli-format.js';
import type { GatekeeperOutcome, HandoffLog, HandoffMissionServicesPort, HandoffResult, HandoffWorkflowPorts, PerformHandoffOptions } from './ports/handoff-workflow.js';
import { rebound } from './rebound-kernel.js';

interface GatekeeperRemediationContext {
  gatekeeperResult: GatekeeperOutcome;
  rootDir: string;
  forgejoUser: string;
  retriesLeft: number;
  currentAttempt: number;
  log: HandoffLog;
  error: HandoffLog;
  startAgentFn: NonNullable<PerformHandoffOptions['startAgentFn']>;
  worktree: string | null;
  skipGate: boolean;
  forceWithLease: boolean;
  isForgejoReviewEnabledFn: NonNullable<PerformHandoffOptions['isForgejoReviewEnabledFn']>;
  rebaseFn: NonNullable<PerformHandoffOptions['rebaseFn']>;
  runVerificationGateFn: NonNullable<PerformHandoffOptions['runVerificationGateFn']>;
  runGatekeeperFn: NonNullable<PerformHandoffOptions['runGatekeeperFn']>;
  missionServicesFn: HandoffMissionServicesPort;
  occurredAt: string;
  retryHandoff: (_slug: string, _options: PerformHandoffOptions) => Promise<HandoffResult>;
}

/**
 * Gatekeeper pre-review validation. Missing artifacts with a posted pushback
 * keep the task active for repair; missing artifacts it could not post block the
 * handoff outright, because nothing would tell the implementer what to fix.
 */
export function gatekeeperOutcome(gatekeeperResult: GatekeeperOutcome, slug: string, log: HandoffLog, error: HandoffLog): { pushedBack: boolean; blocked?: HandoffResult } {
  if (gatekeeperResult.ok) { return { pushedBack: false }; }
  if (gatekeeperResult.posted) {
    fmt.log.warn(`Gatekeeper posted pushback for ${fmt.slug(slug)}: missing ${gatekeeperResult.missing.join(', ')}.`);
    log(`Keeping task ${fmt.slug(slug)} active while required artifacts are missing.`);
    return { pushedBack: true };
  }
  fmt.log.fail(`Gatekeeper detected missing artifacts for ${fmt.slug(slug)} but could not post pushback: skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}. Blocking handoff — task remains in active until artifacts are present.`);
  error(`Missing mandatory artifacts: ${gatekeeperResult.missing.join(', ')}.`);
  return {
    pushedBack: false,
    blocked: { ok: false, error: `Gatekeeper detected missing artifacts but could not post pushback (skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}). Fix missing artifacts before handoff: ${gatekeeperResult.missing.join(', ')}.` },
  };
}

/** Bounded relaunch after gatekeeper pushback. */
export class GatekeeperRemediation {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  /**
   * Bounded agent relaunch after gatekeeper pushback. Re-enters `performHandoff`
   * with a decremented retry budget and an incremented attempt counter, so the
   * recursion guard (3 attempts) and the global retry budget both hold.
   */
  async remediateGatekeeperPushback(slug: string, context: GatekeeperRemediationContext): Promise<HandoffResult> {
    const {
      gatekeeperResult, rootDir, forgejoUser, currentAttempt, log, error,
      startAgentFn, worktree, skipGate, forceWithLease,
      isForgejoReviewEnabledFn, rebaseFn, runVerificationGateFn, runGatekeeperFn, missionServicesFn,
      occurredAt,
    } = context;
    let retriesLeft = context.retriesLeft;

    log(`Gatekeeper pushback posted for ${fmt.slug(slug)} — attempting automated artifact remediation...`);
    // Build a prompt listing every missing artifact with explicit creation instructions
    const missingItems = gatekeeperResult.missing;
    const relaunchPrompt = [
      `Gatekeeper pushback: missing mandatory artifacts for \`${slug}\`.`,
      '',
      'The following files are required before a reviewer engages:',
      '',
      ...missingItems.map(item => `- ${item}`),
      '',
      '**Action: create the missing artifacts so the handoff can proceed.**',
      '',
      ...missingItems
        .filter(item => item.includes('MISSION.md'))
        .map(() => '- **create** `MISSION.md` with the standard mission contract template (title, goal, scope, checkpoints, gates).'),
      ...missingItems
        .filter(item => item.includes('CP-'))
        .map(() => '- **create** at least one checkpoint document (e.g. `CP-1.md`) with a `## Goal Check` table containing real evidence such as a backticked command, test name, ADR reference, or test file path.'),
      ...missingItems
        .filter(item => item.includes('backlog/tasks') || item.includes('backlog/task'))
        .map(() => '- **create** a backlog task file at `backlog/tasks/<slug> - <title>.md` with YAML frontmatter (id, title, status, labels) and a description section.'),
      '',
      `After creating the missing artifacts, re-run the review start (\`px review ${slug} --start\`).`,
    ].join('\n');

    // TASK-2377.05 (SC7): gatekeeper pushback bounces through the one rebound
    // kernel like every other agent-fixable failure. The kernel owns the launch,
    // the budget, and the verified fix; `verify` re-runs the handoff itself, so
    // this is reported repaired only when the handoff actually completes.
    //
    // The budget is clamped to the caller's remaining global retry budget so the
    // recursion guard (`maxAttempts` / `remainingRetries`) still holds: the
    // verify re-enters `performHandoff` with both decremented exactly as before.
    const initialBudget = retriesLeft;
    if (retriesLeft <= 0) {
      // Budget already spent by an outer attempt — strand without launching.
      const spent = `Gatekeeper pushback persisted after ${currentAttempt - 1} relaunch attempts (${currentAttempt - 1}/2 budget). Manual intervention required to create: ${missingItems.join(', ')}.`;
      error(spent);
      return { ok: false, gatekeeperPushedBack: true, error: spent };
    }
    let repairedResult: HandoffResult | null = null;
    const outcome = await rebound(
      {
        kind: 'artifact-incomplete',
        role: 'implementer',
        diagnostic: relaunchPrompt,
      },
      {
        slug,
        worktree: rootDir,
        implementer: forgejoUser,
        // One launch per level: the retry budget is spent by the recursion into
        // `performHandoff` below (which decrements `remainingRetries`), not by
        // the kernel looping here. Two nested levels give the same two total
        // launches the pre-kernel loop made.
        maxAttempts: 1,
        maxLaunchRetries: 0,
        startAgent: startAgentFn,
        readHead: () => {
          const result = this.ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
          return result.status === 0 ? (result.stdout ?? '').trim() : null;
        },
        verify: async (attempt: number) => {
          const retryResult = await context.retryHandoff(slug, {
            worktree,
            skipGate,
            force: true,
            forceWithLease,
            isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
            rebaseFn: rebaseFn,
            runVerificationGateFn: runVerificationGateFn,
            runGatekeeperFn: runGatekeeperFn,
            startAgentFn: startAgentFn,
            missionServicesFn: missionServicesFn,
            log,
            error,
            maxAttempts: currentAttempt + 1,
            remainingRetries: Math.max(0, initialBudget - attempt),
            occurredAt,
          });
          repairedResult = retryResult;
          return { ok: Boolean(retryResult.ok), diagnostic: retryResult.error || '' };
        },
        log,
        error,
      },
    );

    if (outcome.outcome === 'fixed' && repairedResult) {
      log('Handoff succeeded after agent relaunch.');
      return { ...(repairedResult as HandoffResult), gatekeeperPushedBack: true };
    }

    // Budget spent, or the classifier ruled the pushback human-only.
    // Only the outer handoff returns the dossier. Recursive verification levels
    // return their last diagnostic so the outer dossier retains the evidence
    // once instead of nesting copies of itself on every bounded retry.
    const msg = `Manual intervention required. ${currentAttempt === 1 ? outcome.dossier || outcome.diagnostic : outcome.diagnostic}`;
    error(msg);
    return { ok: false, gatekeeperPushedBack: true, error: msg };
  }

}
