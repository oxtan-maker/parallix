/**
 * HandoffCommandUseCase — the complete handoff workflow, re-homed from
 * `src/adapters/cli/commands/handoff.ts` (TASK-2332.09).
 *
 * This module owns the public surface of the handoff workflow and composes the
 * two collaborators that reach it: `HandoffExecutor`, which sequences a full
 * handoff, and the lighter-weight delegating collaborators (gate validation,
 * NEL capture, contract verification).
 *
 * It reaches the outside world only through `HandoffWorkflowPorts`
 * (`./ports/handoff-workflow.js`). The only direct imports permitted here are
 * the application's own presentation module and `src/domain/*` value objects —
 * no adapter module is imported.
 */
import * as fmt from './presentation/cli-format.js';
import { bookkeepingCommitMessage } from '../domain/approval-coverage.js';
import type { HandoffLog, HandoffResult, HandoffWorkflowPorts, PerformHandoffOptions } from './ports/handoff-workflow.js';
import { HandoffExecutor } from './handoff-executor.js';
import { HandoffNelCapture } from './handoff-nel-capture.js';
import type { DeclaredGateRunner } from './handoff-declared-gates.js';
import type { HandoffReviewSubmission } from './handoff-review-submission.js';
export { isReviewerPoolExhausted } from './handoff-review-submission.js';

/** Location facts `verifyHandoff` establishes for an on-branch mission. */
type HandoffLocation =
  | { ok: false; error: string }
  | { ok: true; missionDir: string; area: string | null; branch: string; rootDir: string };

/**
 * CLI-independent application entry point for the handoff workflow.
 *
 * Every collaborator arrives through the injected port bag; the composition
 * root is the only place that knows which concrete adapters implement them.
 */
export class HandoffCommandUseCase {
  private readonly ports: HandoffWorkflowPorts;
  private readonly executor: HandoffExecutor;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
    this.executor = new HandoffExecutor(ports, (fallbackSlug, summary, options) => this.writeFallbackSummary(fallbackSlug, summary, options));
  }

  /**
   * Write a fallback summary (`## Fallback:` heading) into the backlog task file.
   */
  writeFallbackSummary(slug: string, summary: string, options: { rootDir?: string; log?: HandoffLog } = {}): boolean {
    const { fileSystem, git, backlog, missionUtils } = this.ports;
    const launchRoot = process.cwd();
    const rootDir = options.rootDir || missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
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

    const gitResult = git.git(['add', taskFile]);
    if (gitResult.status !== 0) {
      log(fmt.status('WARN', `Failed to stage fallback summary for ${fmt.slug(slug)}`));
      return false;
    }

    const commitResult = git.git(['commit', '-m', bookkeepingCommitMessage(`backlog(${slug}): set fallback summary`, 'backlog-mirror')]);
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

  captureNelAtHandoff(...args: Parameters<HandoffNelCapture['captureNelAtHandoff']>) {
    return this.executor.captureNelAtHandoff(...args);
  }

  resolveHandoffReviewAssignment(...args: Parameters<HandoffReviewSubmission['resolveHandoffReviewAssignment']>) {
    return this.executor.resolveHandoffReviewAssignment(...args);
  }

  verifyHandoff(...args: Parameters<HandoffExecutor['verifyHandoff']>): HandoffLocation {
    return this.executor.verifyHandoff(...args);
  }

  /**
   * Sequences a full handoff for a mission slug.
   */
  async performHandoff(slug: string, options: PerformHandoffOptions = {}): Promise<HandoffResult> {
    return this.executor.performHandoff(slug, options);
  }

  /**
   * Application entry point for an already translated CLI request. Argument
   * parsing, exit-code mapping, and usage rendering belong to the CLI interface.
   */
  async execute(request: { slug?: string; skipGate: boolean; force: boolean }, options: PerformHandoffOptions = {}): Promise<HandoffResult> {
    const slug = this.ports.missionUtils.inferSlug(request.slug);

    if (!slug) {
      return { ok: false, usage: true };
    }

    return await this.performHandoff(slug, {
      ...options,
      skipGate: request.skipGate,
      force: request.force,
    });
  }
}
