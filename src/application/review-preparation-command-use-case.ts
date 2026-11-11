/**
 * ReviewPreparationCommandUseCase — the complete review preparation workflow, re-homed from
 * `src/adapters/cli/commands/review-preparation.ts` (TASK-2332.09).
 *
 * This module owns the public surface of the review preparation workflow and composes the
 * two collaborators that reach it: `ReviewPreparationExecutor`, which sequences a full
 * review preparation, and the lighter-weight delegating collaborators (gate validation,
 * NEL capture, contract verification).
 *
 * It reaches the outside world only through `ReviewPreparationWorkflowPorts`
 * (`./ports/review-preparation-workflow.js`). The only direct imports permitted here are
 * the application's own presentation module and `src/domain/*` value objects —
 * no adapter module is imported.
 */
import * as fmt from './presentation/cli-format.js';
import { bookkeepingCommitMessage } from '../domain/approval-coverage.js';
import type { ReviewPreparationLog, ReviewPreparationResult, ReviewPreparationWorkflowPorts, PerformReviewPreparationOptions } from "./ports/review-preparation-workflow.js";
import type { LiveMissionExecutionContext } from './ports/mission-execution-context.js';
import { ReviewPreparationExecutor } from "./review-preparation-executor.js";
import { ReviewPreparationNelCapture } from "./review-preparation-nel-capture.js";
import type { DeclaredGateRunner } from "./review-preparation-declared-gates.js";
import type { ReviewSubmissionService } from "./review-submission-service.js";
export { isReviewerPoolExhausted } from "./review-submission-service.js";

/** Location facts `verifyReviewPreparation` establishes for an on-branch mission. */
type ReviewPreparationLocation =
  | { ok: false; error: string }
  | { ok: true; missionDir: string; area: string | null; branch: string; rootDir: string };

/**
 * CLI-independent application entry point for the review preparation workflow.
 *
 * Every collaborator arrives through the injected port bag; the composition
 * root is the only place that knows which concrete adapters implement them.
 */
export class ReviewPreparationCommandUseCase {
  private readonly ports: ReviewPreparationWorkflowPorts;
  private readonly executor: ReviewPreparationExecutor;

  constructor(ports: ReviewPreparationWorkflowPorts) {
    this.ports = ports;
    this.executor = new ReviewPreparationExecutor(ports, (slug, summary, options) => this.writeFallbackSummary(slug, summary, options));
  }

  /**
   * Write a fallback summary (`## Fallback:` heading) into the backlog task file.
   */
  writeFallbackSummary(slug: string, summary: string, options: { executionContext: LiveMissionExecutionContext; log?: ReviewPreparationLog }): boolean {
    const { fileSystem, git, backlog } = this.ports;
    const rootDir = options.executionContext.missionWorktree;
    const log = options.log || fmt.log.plain;
    const resolution = backlog.resolveTaskFile(slug, rootDir);
    if (!resolution.ok) {
      log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: ${resolution.reason}`));
      return false;
    }

    const taskFile = resolution.taskFile;
    if (!taskFile) {
      log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: task file not found.`));
      return false;
    }
    let content = fileSystem.readText(taskFile);

    // Already present — no-op
    if (content.includes('## Fallback:')) {
      return true;
    }

    // Insert after frontmatter block (first occurrence of "---" closing)
    const firstDash = content.indexOf('---');
    if (firstDash === -1) {
      content = summary + '\n\n' + content;
    } else {
      // Find the closing --- of frontmatter
      const closingDash = content.indexOf('---', firstDash + 3);
      if (closingDash === -1) {
        content = summary + '\n\n' + content;
      } else {
        const insertPos = closingDash + 3;
        content = content.slice(0, insertPos) + '\n\n' + summary + content.slice(insertPos);
      }
    }

    fileSystem.writeText(taskFile, content);

    // Both mutations run against the resolved mission checkout: the process may
    // have been admitted from a different checkout of the same repository.
    const gitResult = git.git(['-C', rootDir, 'add', taskFile]);
    if (gitResult.status !== 0) {
      log(fmt.status('WARN', `Failed to stage fallback summary for ${fmt.slug(slug)}`));
      return false;
    }

    const commitResult = git.git(['-C', rootDir, 'commit', '-m', bookkeepingCommitMessage(`backlog(${slug}): set fallback summary`, 'backlog-mirror')]);
    if (commitResult.status !== 0) {
      log(fmt.status('WARN', `Failed to commit fallback summary for ${fmt.slug(slug)}`));
      return false;
    }

    log(fmt.status('PASS', `Set fallback summary on ${fmt.slug(slug)}.`));
    return true;
  }

  validateDeclaredGates(...args: Parameters<DeclaredGateRunner['validateDeclaredGates']>) {
    return this.executor.validateDeclaredGates(...args);
  }

  runDeclaredGates(...args: Parameters<DeclaredGateRunner['runDeclaredGates']>) {
    return this.executor.runDeclaredGates(...args);
  }

  executeGateCommands(...args: Parameters<DeclaredGateRunner['executeGateCommands']>) {
    return this.executor.executeGateCommands(...args);
  }

  captureNelAtReviewPreparation(...args: Parameters<ReviewPreparationNelCapture["captureNelAtReviewPreparation"]>) {
    return this.executor.captureNelAtReviewPreparation(...args);
  }

  resolveReviewPreparationReviewAssignment(...args: Parameters<ReviewSubmissionService["resolveReviewPreparationReviewAssignment"]>) {
    return this.executor.resolveReviewPreparationReviewAssignment(...args);
  }

  verifyReviewPreparation(...args: Parameters<ReviewPreparationExecutor["verifyReviewPreparation"]>): ReviewPreparationLocation {
    return this.executor.verifyReviewPreparation(...args);
  }

  /**
   * Sequences a full review preparation for a mission slug.
   */
  async performReviewPreparation(slug: string, options: PerformReviewPreparationOptions): Promise<ReviewPreparationResult> {
    return this.executor.performReviewPreparation(slug, options);
  }

  /**
   * Application entry point for an already translated CLI request. Argument
   * parsing, exit-code mapping, and usage rendering belong to the CLI interface.
   */
  async execute(request: { slug?: string; skipGate: boolean; force: boolean }, options: PerformReviewPreparationOptions): Promise<ReviewPreparationResult> {
    const slug = this.ports.missionUtils.inferSlug(request.slug);

    if (!slug) {
      return { ok: false, usage: true };
    }

    return await this.performReviewPreparation(slug, {
      ...options,
      skipGate: request.skipGate,
      force: request.force,
    });
  }
}
