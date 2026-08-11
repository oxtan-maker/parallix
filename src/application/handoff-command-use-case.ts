// @ts-nocheck
/**
 * HandoffCommandUseCase — the complete handoff workflow, re-homed from
 * `src/adapters/cli/commands/handoff.ts` (TASK-2332.09).
 *
 * This module owns the sequencing: verify handoff, final gate run, rebase onto
 * primary, NEL capture, Forgejo PR create/update, gatekeeper pre-review with
 * bounded agent relaunch, declared `## Gates` execution, checkpoint recording,
 * mission lifecycle transition to review, and backlog sync.
 *
 * It reaches the outside world only through `HandoffWorkflowPorts`
 * (`./ports/handoff-workflow.js`). The only direct imports permitted here are
 * `node:path` (pure path algebra), the application's own presentation module,
 * and `src/domain/*` value objects — no adapter module is imported.
 */
import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import { startReview, ConfiguredReviewerEligibility, changeRevision } from '../domain/review.js';
import { agentFamily } from '../domain/agents.js';
import { artifactReference } from '../domain/net-engineering-lines.js';
import type { HandoffWorkflowPorts, HandoffResult } from './ports/handoff-workflow.js';

/**
 * A selection failure that means "no other family is available right now",
 * as opposed to a broken configuration or an unreadable agent policy.
 *
 * Only exhaustion may fall back to self-review. Every other failure — an
 * unreadable agent config, no eligible agents at all, no working launcher —
 * must propagate: silently reviewing your own work is not the right answer to
 * a machine that is misconfigured.
 */
export function isReviewerPoolExhausted(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)) || '';
  return message.includes('exhausted') || message.includes('No agents available');
}

export function collectGoalCheckEvidenceRows(afterHeader: string): string[] {
  const separatorPattern = /^\|(?:\s*:?-+:?\s*\|)+$/;
  const headerPattern = /^\| .+\| .+\| .+\|$/;
  const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
  const linesAfterHeader = afterHeader.split('\n');
  const evidenceRows: string[] = [];
  let pastHeader = false;

  for (const line of linesAfterHeader) {
    const trimmed = line.trim();
    if (trimmed === '') { continue; }
    if (!pastHeader && headerPattern.test(trimmed)) {
      pastHeader = true;
      continue;
    }
    if (separatorPattern.test(trimmed)) { continue; }
    if (pastHeader && evidenceLinePattern.test(trimmed)) {
      evidenceRows.push(trimmed);
      continue;
    }
    break;
  }

  return evidenceRows;
}

function collectRepoTestNames(fileSystem, rootDir: string): Set<string> {
  const names = new Set<string>();
  const testRoot = path.join(rootDir, 'test');
  if (!fileSystem.existsSync(testRoot)) {
    return names;
  }

  const queue = [testRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries = [];
    try {
      entries = fileSystem.listEntries(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
        continue;
      }
      const content = fileSystem.readText(fullPath);
      const testNamePattern = /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g;
      let match: RegExpExecArray | null;
      while ((match = testNamePattern.exec(content)) !== null) {
        names.add(match[2]);
      }
    }
  }

  return names;
}

function canonicalSourceContainsFile(fileSystem, rootDir: string, basename: string): boolean {
  const sourceRoot = path.join(rootDir, 'src');
  if (!fileSystem.existsSync(sourceRoot)) { return false; }
  const queue = [sourceRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of fileSystem.listEntries(current)) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name === basename) {
        return true;
      }
    }
  }
  return false;
}

export function evidenceCellHasVerifiableReference(fileSystem, cell: string, rootDir: string, knownTestNames: Set<string>): boolean {
  const normalized = cell.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1');
  const fileLinePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.[\w-]+):(\d+)(?:-\d+)?/g;
  let fileLineMatch: RegExpExecArray | null;
  while ((fileLineMatch = fileLinePattern.exec(normalized)) !== null) {
    const candidatePath = fileLineMatch[1];
    const resolved = path.isAbsolute(candidatePath)
      ? candidatePath
      : path.join(rootDir, candidatePath.replace(/^\.\//, ''));
    // Historical checkpoints may cite the former `lib/...` layout. Validate
    // that the cited source file still exists somewhere in the canonical tree.
    const canonicalSourceExists = !path.isAbsolute(candidatePath) && candidatePath.startsWith('lib/')
      ? canonicalSourceContainsFile(fileSystem, rootDir, path.basename(candidatePath))
      : false;
    if (fileSystem.existsSync(resolved) || canonicalSourceExists) {
      return true;
    }
  }

  const adrPattern = /\bADR\s+(\d{4})\b/g;
  let adrMatch: RegExpExecArray | null;
  while ((adrMatch = adrPattern.exec(normalized)) !== null) {
    const prefix = `${adrMatch[1]}-`;
    const adrDir = path.join(rootDir, 'docs', 'adr');
    if (fileSystem.existsSync(adrDir) && fileSystem.listNames(adrDir).some(name => name.startsWith(prefix) && name.endsWith('.md'))) {
      return true;
    }
  }

  const quotedPattern = /(['"`])([^'"`]+)\1/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(normalized)) !== null) {
    if (knownTestNames.has(quotedMatch[2])) {
      return true;
    }
  }

  const testFilePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=$|[\s),`])/g;
  while (testFilePattern.exec(normalized) !== null) {
    return true;
  }

  // Normalize escaped backticks (`` `` ``) so the inline-command regex does not
  // span across them. A markdown cell like `` `git diff --name-only` `` would
  // otherwise match from the first ` to the third, capturing a leading backtick
  // that breaks the `git` prefix check.
  const cellForCommands = cell.replace(/``/g, '  ');
  const inlineCommandPattern = /`([^`]+)`/g;
  let commandMatch: RegExpExecArray | null;
  while ((commandMatch = inlineCommandPattern.exec(cellForCommands)) !== null) {
    const command = commandMatch[1].trim();
    if (/^(npm|npx|node|git|px)\s+/i.test(command)) {
      return true;
    }
    // Common shell commands followed by a file argument (e.g. `bash hello.sh`,
    // `cat output.txt`). The file path is checked against rootDir.
    if (/^(bash|sh|cat|head|tail|diff|grep|sed|awk|xxd|od|wc|sort|uniq)\s+/i.test(command)) {
      const args = command.split(/\s+/).slice(1);
      for (const arg of args) {
        // Skip flags like -n, --context, etc.
        if (arg.startsWith('-')) { continue; }
        const candidatePath = arg.replace(/^\.\//, '');
        if (fileSystem.existsSync(path.join(rootDir, candidatePath))) {
          return true;
        }
      }
    }
    if (command.startsWith('./')) {
      const commandPath = command.split(/\s+/)[0];
      if (fileSystem.existsSync(path.join(rootDir, commandPath.replace(/^\.\//, '')))) {
        return true;
      }
    }
  }

  return false;
}

export function findUnverifiableGoalCheckRow(fileSystem, evidenceRows: string[], rootDir: string): string | null {
  const knownTestNames = collectRepoTestNames(fileSystem, rootDir);
  for (const row of evidenceRows) {
    const columns = row.split('|').slice(1, -1).map(part => part.trim()).filter(Boolean);
    if (columns.some(cell => evidenceCellHasVerifiableReference(fileSystem, cell, rootDir, knownTestNames))) {
      continue;
    }
    return row;
  }
  return null;
}

/**
 * Build the content for an auto-generated CP-1.md checkpoint.
 *
 * The generated file satisfies the minimum checkpoint integrity requirements
 * enforced in `performHandoff`: an `# CP-1:` h1 heading, a `## Goal Check`
 * section (matching the regex `^## Goal Check(?: Table)?\s*$`), and a 3-column
 * pipe table with at least one evidence row. It is explicitly marked as
 * auto-generated so a reviewer knows to replace it with real evidence.
 *
 * Evidence cells cite a file and a symbol name, never `file:line`: a line number
 * that another file asserts on goes stale the moment either file is edited,
 * turning an unrelated change into a random failure. The citation is still
 * existence-checked against the repository root by
 * `evidenceCellHasVerifiableReference`, so the row stays verifiable evidence.
 */
export function buildAutoCheckpointContent(slug: string): string {
  return [
    `# CP-1: Auto-generated checkpoint (handoff remediation for ${slug})`,
    '',
    '> **Auto-generated by `node parallix handoff`** because no checkpoint document',
    '> was present in the mission directory at handoff time. This file provides the',
    '> minimum required structure so the handoff can proceed. A reviewer should',
    '> replace it with real implementation evidence.',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Auto-generated checkpoint CP-1.md present | `cat src/application/handoff-command-use-case.ts` — buildAutoCheckpointContent writes CP-1.md when no checkpoint exists | PASS |',
    '| Mission contract exists for review | `cat src/application/handoff-command-use-case.ts` — verifyHandoff requires MISSION.md in the mission directory | PASS |',
    '',
    'Next action: Reviewer to replace this placeholder with real implementation evidence before approval.',
    ''
  ].join('\n');
}

/**
 * CLI-independent application entry point for the handoff workflow.
 *
 * Every collaborator arrives through the injected port bag; the composition
 * root is the only place that knows which concrete adapters implement them.
 */
export class HandoffCommandUseCase {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  /**
   * Verifies that the current environment is ready for handoff.
   */
  verifyHandoff(slug: string, options: { worktree?: string } = {}) {
    const { fileSystem, git, missionUtils } = this.ports;
    const launchRoot = process.cwd();
    const rootDir = options.worktree || missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
    const missionDir = missionUtils.findMissionDir(slug, rootDir);
    if (!missionDir) {
      return { ok: false, error: `Mission directory not found for slug: ${slug}` };
    }

    const area = missionUtils.findMissionArea(missionDir);
    const branch = missionUtils.missionBranchName(slug, rootDir);
    const current = git.getCurrentBranch(rootDir);

    if (current !== branch) {
      return { ok: false, error: `Not on mission branch. Current: ${current}, Expected: ${branch}` };
    }

    const missionMdPath = path.join(missionDir, 'MISSION.md');
    if (!fileSystem.existsSync(missionMdPath)) {
      return { ok: false, error: `MISSION.md not found at ${missionMdPath}. The mission contract must exist before handoff.` };
    }

    return { ok: true, missionDir, area, branch, rootDir };
  }

  resolveHandoffReviewAssignment(
    implementerName: string,
    options: {
      worktree?: string;
      eligibleAgentsForStepFn?: Function;
      selectAgentFn?: Function;
      preparedSelection?: { select(_step: string, _opts: Record<string, unknown>): string } | null;
      log?: (_msg: string) => void;
    } = {},
  ) {
    const implementer = agentFamily(implementerName);
    const eligibleFn = options.eligibleAgentsForStepFn || this.ports.agentSelection.eligibleAgentsForStep;
    const selectFn = options.selectAgentFn || this.ports.agentSelection.selectAgent;
    const log = options.log || fmt.log.plain;
    const configured = eligibleFn('review', { worktree: options.worktree });
    const configuredFamilies = configured.map((candidate: string) => agentFamily(candidate));

    try {
      const reviewer = agentFamily(options.preparedSelection
        ? options.preparedSelection.select('review', { excluded: new Set([implementer]) })
        : selectFn('review', {
          exclude: new Set([implementerName]),
          worktree: options.worktree,
        }));
      return {
        reviewer,
        implementer,
        reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
          eligible: configuredFamilies,
          strategy: 'random',
        }),
      };
    } catch (error) {
      if (!isReviewerPoolExhausted(error)) { throw error; }
      // The documented single-family escape hatch: this workstation has no other
      // runnable reviewer at this moment. Record the eligibility that actually
      // applied — the implementer's own family — so the round states plainly that
      // it was self-reviewed instead of claiming a reviewer pool it never had.
      log(fmt.status(
        'WARN',
        `No reviewer available besides ${fmt.agent(implementer)}; falling back to self-review for this handoff. `
        + `${(error as Error).message}`,
      ));
      return {
        reviewer: implementer,
        implementer,
        reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
          eligible: [implementer],
          strategy: 'random',
        }),
      };
    }
  }

  /**
   * Write a fallback summary (`## Fallback:` heading) into the backlog task file.
   */
  writeFallbackSummary(slug: string, summary: string, options: { rootDir?: string; log?: Function } = {}): boolean {
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

    const commitResult = git.git(['commit', '-m', `backlog(${slug}): set fallback summary`]);
    if (commitResult.status !== 0) {
      log(fmt.status('WARN', `Failed to commit fallback summary for ${fmt.slug(slug)}`));
      return false;
    }

    log(fmt.status('PASS', `Set fallback summary on ${fmt.slug(slug)}.`));
    return true;
  }

  /**
   * Validate declared gate commands for file existence and basic syntax before execution.
   */
  validateDeclaredGates(commands: string[], rootDir: string) {
    const { fileSystem } = this.ports;
    for (const cmd of commands) {
      // A Markdown code span followed by words is documentation, not an exact
      // command. Keep the original declaration intact so the operator can fix
      // the offending MISSION.md line instead of seeing a downstream Bash error.
      const markdownCommandWithSuffix = /^`[^`\r\n]+`\s+\S/.test(cmd);

      // Ignore quoted arguments while looking for outcome-language suffixes.
      // This preserves commands such as `echo "all checks pass"`, pipelines,
      // redirects, and compound commands while rejecting declarations such as
      // `./scripts/verify-local.sh all passes on the final tree`.
      let unquoted = '';
      let proseSingleQuote = false;
      let proseDoubleQuote = false;
      for (let ci = 0; ci < cmd.length; ci++) {
        const ch = cmd[ci];
        if (ch === '\\' && proseDoubleQuote) {
          unquoted += '  ';
          ci++;
          continue;
        }
        if (ch === '\'' && !proseDoubleQuote) {
          proseSingleQuote = !proseSingleQuote;
          unquoted += ' ';
          continue;
        }
        if (ch === '"' && !proseSingleQuote) {
          proseDoubleQuote = !proseDoubleQuote;
          unquoted += ' ';
          continue;
        }
        unquoted += proseSingleQuote || proseDoubleQuote ? ' ' : ch;
      }
      const hasDescriptionSeparator = /\s(?:—|–|-–)\s+\S/.test(unquoted);
      const hasOutcomeSuffix = /\s(?:passes?|passed|succeeds?|succeeded|completes?|completed)(?:\s+(?:on|in|with|without|after|before|for|the|a|an|successfully|cleanly)\b[^;&|]*)?[.!]?\s*$/i.test(unquoted);
      if (markdownCommandWithSuffix || hasDescriptionSeparator || hasOutcomeSuffix) {
        return {
          ok: false,
          reason: 'validation-failed',
          error: `Gate declaration must contain an exact runnable command only. Replace "${cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
          gate: cmd
        };
      }

      // Check for unclosed quotes — respect quote context so apostrophes
      // inside double-quoted strings (and vice-versa) are not flagged.
      // Only flag genuinely unmatched quotes (e.g. echo 'unclosed).
      let inSingleQuote = false;
      let inDoubleQuote = false;
      for (let ci = 0; ci < cmd.length; ci++) {
        const ch = cmd[ci];
        if (ch === '\\' && inDoubleQuote) {
          ci++; // skip escaped character inside double quotes
          continue;
        }
        if (ch === '\'' && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
          continue;
        }
        if (ch === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote;
          continue;
        }
      }
      if (inSingleQuote || inDoubleQuote) {
        const quoteType = inSingleQuote ? 'single' : 'double';
        return {
          ok: false,
          reason: 'validation-failed',
          error: `Gate command has unclosed ${quoteType} quotes: "${cmd}"`,
          gate: cmd
        };
      }

      // Check for unmatched parentheses
      const openParens = (cmd.match(/\(/g) || []).length;
      const closeParens = (cmd.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        return {
          ok: false,
          reason: 'validation-failed',
          error: `Gate command has unmatched parentheses: "${cmd}"`,
          gate: cmd
        };
      }

      // Check for unmatched braces
      const openBraces = (cmd.match(/\{/g) || []).length;
      const closeBraces = (cmd.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        return {
          ok: false,
          reason: 'validation-failed',
          error: `Gate command has unmatched braces: "${cmd}"`,
          gate: cmd
        };
      }

      // Check for unmatched brackets
      const openBrackets = (cmd.match(/\[/g) || []).length;
      const closeBrackets = (cmd.match(/\]/g) || []).length;
      if (openBrackets !== closeBrackets) {
        return {
          ok: false,
          reason: 'validation-failed',
          error: `Gate command has unmatched brackets: "${cmd}"`,
          gate: cmd
        };
      }

      // Extract file paths from the command and check their existence.
      // Split on whitespace first, then classify whole tokens — this avoids
      // the regex matching mid-token (e.g. turning "lib/agents/" into "/agents/").
      // Only check tokens that clearly look like file paths:
      //   - start with ./ or ../  (relative paths)
      //   - start with /           (absolute paths)
      //   - contain /              (paths with intermediate segments)
      // This avoids false positives on bare words, flags, URLs, and glob patterns.
      const tokens = cmd.split(/\s+/);
      for (const token of tokens) {
        // Skip if it looks like a URL
        if (/^https?:\/\//i.test(token) || token.includes('://')) {
          continue;
        }
        // Skip flags
        if (token.startsWith('-')) {
          continue;
        }
        // Strip leading/trailing quote characters (', ", `) before checking
        // so that 'lib/agents/' becomes lib/agents/ and `path` becomes path
        const cleaned = token.replace(/^['"`]|['"`]$/g, '');
        // Skip glob patterns (contain *, ?, [, ]) — not literal file paths
        if (/[?*[\]]/.test(cleaned)) {
          continue;
        }
        // Check if token looks like a file path
        const looksLikePath =
          cleaned.startsWith('./') ||
          cleaned.startsWith('../') ||
          cleaned.startsWith('/') ||
          cleaned.includes('/');
        if (!looksLikePath) {
          continue;
        }
        // Resolve the path relative to rootDir and check existence
        const absolutePath = path.resolve(rootDir, cleaned);
        if (!fileSystem.existsSync(absolutePath)) {
          return {
            ok: false,
            reason: 'validation-failed',
            error: `Gate command references non-existent file: "${token}" in command "${cmd}"`,
            gate: cmd
          };
        }
      }
    }

    return { ok: true, reason: 'all-gates-valid' };
  }

  /**
   * Parse and execute declared gates from a mission's MISSION.md `## Gates` section.
   * Each gate line is treated as a shell command executed through the process port.
   */
  runDeclaredGates(missionDir: string, rootDir: string, options: { log?: Function; error?: Function } = {}) {
    const { fileSystem, verification, process: processPort } = this.ports;
    const { log = fmt.log.plain } = options;
    const missionPath = path.join(missionDir, 'MISSION.md');
    if (!fileSystem.existsSync(missionPath)) {
      return { ok: true, skipped: true, reason: 'no-mission-file' };
    }

    const content = fileSystem.readText(missionPath);

    // Extract the ## Gates section
    const gatesSectionMatch = content.match(/^## Gates\s*\n([\s\S]*?)(?=\n## |\n$)/m);
    if (!gatesSectionMatch) {
      return { ok: true, skipped: true, reason: 'no-gates-section' };
    }

    const gatesBlock = gatesSectionMatch[1];
    const gateLines = gatesBlock.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- [ ]') || line.startsWith('- [x]') || line.startsWith('- '));

    // Strip the checkbox prefix to get the command
    const commands = gateLines.map(line => {
      // Remove "- [ ] ", "- [x] ", or "- " prefix
      let cmd = line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '');
      // Reject gate entries that contain an explanatory dash separator
      // (em-dash, en-dash, or hyphen+en-dash followed by prose) before any
      // further processing, so validateDeclaredGates never sees a silently
      // sanitized command.
      if (/\s+(—|–|-–)\s+\S/.test(cmd)) {
        return { _reject: true, cmd };
      }
      // Strip surrounding backticks (e.g., "`npm run typecheck`")
      cmd = cmd.replace(/^`(.+)`$/, '$1').trim();
      return cmd;
    }).filter(cmd => cmd && (!cmd._reject || cmd.cmd.length > 0));

    // Check for any rejected entries (dash-suffix gates)
    const rejected = commands.find(cmd => cmd && cmd._reject);
    if (rejected) {
      return {
        ok: false,
        reason: 'validation-failed',
        error: `Gate declaration must contain an exact runnable command only. Replace "${rejected.cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
        gate: rejected.cmd
      };
    }

    const cleanCommands = commands.map(cmd => cmd.cmd || cmd);

    if (cleanCommands.length === 0) {
      return { ok: true, skipped: true, reason: 'no-gates-declared' };
    }

    // Pre-validate all gate commands before execution
    const validationResult = this.validateDeclaredGates(cleanCommands, rootDir);
    if (!validationResult.ok) {
      return validationResult;
    }

    // Execute each gate command
    for (const cmd of cleanCommands) {
      const reusableProof = verification.readReusableVerificationProof(cmd, rootDir);
      if (reusableProof.ok) {
        log(`  Gate reused proof ${reusableProof.identity}: ${cmd}`);
        continue;
      }
      log(`  Gate: ${cmd}`);
      const result = processPort.spawnSync('bash', ['-c', cmd], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      if (result.status !== 0) {
        const stdout = (result.stdout || '').trim();
        const stderr = (result.stderr || '').trim();
        return {
          ok: false,
          gate: cmd,
          reason: 'gate-failed',
          error: stderr || `Gate exited with status ${result.status}`,
          stdout,
          stderr
        };
      }
      const proofResult = verification.writeReusableVerificationProof(cmd, rootDir);
      if (proofResult.ok) {
        log(`  Gate executed; stored proof ${proofResult.identity}: ${cmd}`);
      } else {
        log(`  Gate executed; proof unavailable (${proofResult.error}): ${cmd}`);
      }
    }

    return { ok: true, skipped: false, count: cleanCommands.length, reason: 'all-gates-passed' };
  }

  /**
   * Capture NEL (Net Engineering Lines) at handoff time.
   *
   * Computes actual NEL from the merge diff (primary..HEAD), reads the predicted
   * bucket from the mission's Refinement Signals, resolves review rounds from
   * the Mission store, and records the result through the checked Mission
   * boundary. NEL values remain observational; failure to durably persist a
   * computed value is fatal to handoff.
   */
  async captureNelAtHandoff(slug: string, options) {
    const { fileSystem, missionUtils, nel, documentWriter } = this.ports;
    const { rootDir, missionDir, error } = options;
    const documentWriterFn = options.documentWriterFn || documentWriter.write;

    // 1. Determine primary branch for diff range
    let primaryBranch;
    try {
      primaryBranch = missionUtils.getPrimaryBranch(rootDir);
    } catch (_) {
      return { ok: false, error: 'could not detect primary branch for NEL diff range' };
    }

    if (!primaryBranch) {
      return { ok: false, error: 'primary branch is empty' };
    }

    // 2. Compute actual NEL from primary..HEAD
    let nelRecord;
    try {
      nelRecord = nel.computeNELRecord(`${primaryBranch}..HEAD`, { cwd: rootDir });
    } catch (_) {
      return { ok: false, error: 'NEL computation failed' };
    }

    const actualNel = nelRecord.nel;
    const actualBucket = nelRecord.bucket.label;

    // 3. Read predicted bucket from MISSION.md Refinement Signals
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    let predictedBucket = 'Unknown';
    if (fileSystem.existsSync(missionMdPath)) {
      const content = fileSystem.readText(missionMdPath);
      const predictedMatch = content.match(/Predicted NEL bucket:\s*(Small|Medium|Large)/i);
      if (predictedMatch) {
        predictedBucket = predictedMatch[1];
      }
    }

    // 5. Record through the checked Mission boundary. The use case decides and the
    //    selected SQLite authority writes; this workflow supplies only
    //    domain values and the artifact *references* it observed.
    const missionServicesFn = options.missionServicesFn || this.ports.missionServices;
    if (typeof missionServicesFn !== 'function') { return { ok: false, error: 'mission services are not configured' }; }
    const missionServices = await missionServicesFn(rootDir, {
      missionDir,
      documentWriter: documentWriterFn,
    });

    // 4. Read review rounds from the Mission store (not review-state.json).
    // architecture invariant: the SQLite store is the sole authority for Mission domain state.
    let reviewRounds = 1;
    const missionLoad = await missionServices.store.load(slug);
    if (missionLoad.kind === 'found' && missionLoad.mission.review) {
      reviewRounds = missionLoad.mission.review.rounds.length;
    }
    const artifacts = [
      artifactReference('git-range', `${primaryBranch}..HEAD`),
    ];
    const outcome = await missionServices.handoff.recordNel({
      operationId: `handoff-nel-${slug}`,
      missionId: slug,
      capabilities: new Set(['handoff:record']),
      netEngineeringLines: actualNel,
      predictedBucket,
      reviewRounds,
      capturedAt: new Date().toISOString(),
      artifacts,
    });

    if (outcome.status !== 'completed') {
      const message = outcome.error?.message || 'NEL record was not persisted';
      error(`Failed to write NEL record: ${message}`);
      return { ok: false, persistenceFailed: true, error: `failed to write NEL record: ${message}` };
    }

    return { ok: true, nel: actualNel, bucket: actualBucket };
  }

  /**
   * Performs the handoff process for a mission:
   * 1. Runs the verification gate.
   * 2. Syncs primary branch and pushes the mission branch to Forgejo, creating or updating the PR.
   * 3. Transitions Backlog task to 'review'.
   * 4. Commits and pushes the Backlog state change to Forgejo.
   */
  async performHandoff(slug: string, options = {}): Promise<HandoffResult> {
    const ports = this.ports;
    const opts = options;
    const {
      skipGate = false,
      worktree = null,
      force = false,
      forceWithLease = true,
      log = fmt.log.info,
      error = fmt.log.fail,
      rebaseFn = ports.rebase.rebaseBeforeReviewRound,
      runVerificationGateFn = ports.verification.runVerificationGate,
      maxAttempts,
      attemptAgentRelaunchFn = ports.agentRelaunch.attemptAgentRelaunch,
      remainingRetries,
      runGatekeeperFn = ports.gatekeeper.runGatekeeper,
      captureNelFn,
      missionServicesFn = ports.missionServices,
      eligibleAgentsForStepFn = ports.agentSelection.eligibleAgentsForStep,
      selectAgentFn = ports.agentSelection.selectAgent
    } = opts;
    const captureNel = captureNelFn || ((nelSlug, nelOptions) => this.captureNelAtHandoff(nelSlug, nelOptions));

    // Recursion guard: prevent infinite retry loops when gatekeeper pushback
    // persists across relaunch attempts. Hard limit of 3 total handoff invocations.
    const currentAttempt = maxAttempts || 1;
    if (currentAttempt > 3) {
      const msg = `Handoff exceeded maximum attempts (3). Manual intervention required.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Global retry budget: controls total relaunch attempts across all recursive calls.
    // Default is 2 (one initial + one retry). Decremented with each relaunch.
    const retriesLeft = remainingRetries !== undefined ? remainingRetries : 2;

    const verification = this.verifyHandoff(slug, { worktree: worktree || undefined });
    if (!verification.ok) {
      error(verification.error);
      return { ok: false, error: verification.error };
    }

    const { area, branch, missionDir } = verification;
    const rootDir = verification.rootDir;
    const missionDirPath = missionDir;

    // Step 0: Resolve Backlog task for identity derivation
    const taskResolution = ports.backlog.resolveTaskFile(slug, rootDir);
    if (!taskResolution.ok) {
      const msg = `Backlog task file for ${fmt.slug(slug)} not found or ambiguous: ${taskResolution.reason}.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Pre-handoff Content Integrity Check
    const relativeMissionPath = path.relative(rootDir, path.join(missionDirPath, 'MISSION.md'));
    const dirtyFiles = ports.git.getWorktreeStatus(rootDir);
    let checkpoints = ports.missionUtils.findCheckpoints(missionDirPath);

    if (dirtyFiles.some(line => line.endsWith(relativeMissionPath))) {
      const msg = `${fmt.path('MISSION.md')} is modified but uncommitted at ${fmt.path(relativeMissionPath)}. Commit the mission contract before handoff.`;
      error(msg);
      return { ok: false, error: msg };
    }

    if (checkpoints.length === 0) {
      // Auto-remediation: rather than hard-failing when no checkpoint document
      // exists, generate a minimal default CP-1.md with a valid Goal Check
      // table so the handoff can proceed without manual intervention. The generated
      // file is clearly marked as auto-generated for reviewer awareness, then we
      // re-scan to confirm it is discoverable via findCheckpoints().
      const autoCheckpointPath = path.join(missionDirPath, 'CP-1.md');
      ports.fileSystem.writeText(autoCheckpointPath, buildAutoCheckpointContent(slug));
      log(fmt.status('WARN', `No checkpoint documents found — auto-generated ${fmt.path('CP-1.md')} in ${fmt.path(missionDirPath)}.`));

      checkpoints = ports.missionUtils.findCheckpoints(missionDirPath);
      if (checkpoints.length === 0) {
        const msg = `No checkpoint documents found in ${fmt.path(missionDirPath)} even after auto-remediation. Implementation evidence is mandatory for review.`;
        error(msg);
        return { ok: false, error: msg };
      }

      // Commit the auto-generated checkpoint so it is included in the handoff push
      // and does not trip the uncommitted-checkpoint check below.
      ports.git.git(['-C', rootDir, 'add', autoCheckpointPath]);
      const commitRes = ports.git.git(['-C', rootDir, 'commit', '-m', `docs(${slug}): auto-generate CP-1.md checkpoint (handoff remediation)`]);
      if (commitRes.status !== 0) {
        log(fmt.status('WARN', `Could not commit auto-generated CP-1.md for ${fmt.slug(slug)}; continuing handoff.`));
      }
    }

    const finalCheckpoint = checkpoints[checkpoints.length - 1];
    const relativeCheckpointPath = path.relative(rootDir, finalCheckpoint);
    if (dirtyFiles.some(line => line.endsWith(relativeCheckpointPath))) {
      const msg = `The latest checkpoint document is modified but uncommitted at ${fmt.path(relativeCheckpointPath)}. Commit the implementation evidence before handoff.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Pre-handoff Content Integrity Check: final checkpoint must contain a Goal Check table
    // with real evidence. Per review.md step 5, a missing or empty goal-check table
    // means the checkpoint has not satisfied the mission's evidence requirement.
    // Accept both `## Goal Check` and `## Goal Check Table` heading variants used across repo artifacts.
    const checkpointContent = ports.fileSystem.readText(finalCheckpoint);
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
      const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Verify the goal-check table has at least one row of evidence (table row after header).
    // Must exclude table separator rows (|---|---|---|) and the header row itself —
    // only real evidence rows (with pipe-separated content that is not all dashes) count.
    const goalCheckMatchIndex = goalCheckMatch.index ?? 0;
    const afterHeader = checkpointContent.slice(goalCheckMatchIndex + goalCheckMatch[0].length);
    const evidenceRows = collectGoalCheckEvidenceRows(afterHeader);
    if (evidenceRows.length === 0) {
      const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.`;
      error(msg);
      return { ok: false, error: msg };
    }
    const unverifiableRow = findUnverifiableGoalCheckRow(ports.fileSystem, evidenceRows, rootDir);
    if (unverifiableRow) {
      const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command/path. A goal-check table with real evidence is required before handoff. Offending row: ${unverifiableRow}`;
      error(msg);
      return { ok: false, error: msg };
    }

    const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || ports.productConfig.isForgejoReviewEnabled;
    const forgejoEnabled = isForgejoReviewEnabledFn(rootDir);

    const { forgejoUser: reviewStateUser } = await ports.reviewIdentity.resolveReviewIdentity(slug, rootDir, {});
    const forgejoUser = reviewStateUser || ports.backlog.getTaskImplementer(taskResolution.taskFile);

    if (!forgejoUser) {
      error('forgejoUser is required for performHandoff. Ensure the mission Review or the Backlog task has an agent family assigned.');
      return { ok: false, error: 'forgejoUser is required' };
    }

    log(`Starting handoff for mission ${fmt.slug(slug)}...`);

    // Step 1: Final Gate Run
    if (skipGate) {
      fmt.log.warn('Step 1: Skipping final verification gate (--no-gate)');
    } else {
      const verificationCommand = ports.verification.formatVerificationCommand(area || 'docs', rootDir);
      // Bind a reusable proof to the inputs that existed before execution. A
      // successful process exit alone must not certify a tree changed mid-gate.
      const beforeGateProof = ports.verification.createVerificationProofIdentity(verificationCommand, rootDir);
      log(`Step 1: Running final verification gate for area: ${fmt.bold(area || 'docs')}...`);
      const verifyResult = runVerificationGateFn(area || 'docs', {
        rootDir,
        stdio: 'pipe',
        runFn: ports.git.run
      });
      if (verifyResult.status !== 0) {
        const stdout = (verifyResult.stdout || '').trim();
        const stderr = (verifyResult.stderr || '').trim();
        const msg = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
        error(msg);
        return { ok: false, error: msg, gateOutput: { stdout, stderr } };
      }
      const proofResult = beforeGateProof.ok
        ? ports.verification.writeReusableVerificationProof(verificationCommand, rootDir, { expectedIdentity: beforeGateProof.identity })
        : beforeGateProof;
      if (proofResult.ok) {
        log(`Step 1: Gate executed; stored proof ${proofResult.identity}.`);
      } else {
        log(`Step 1: Gate executed; proof unavailable (${proofResult.error}). Later boundaries will execute independently.`);
      }
    }

    // Step 1.5: Rebase mission branch onto latest primary before PR creation
    log('Step 1.5: Rebasing onto primary branch before handoff...');
    const rebaseResult = await rebaseFn(slug, {
      worktree: worktree || undefined,
      log,
      error,
      isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
    });
    if (!rebaseResult.ok) {
      if (rebaseResult.sharedFileConflicts) {
        const msg = 'Rebase encountered shared-file conflicts. Resolve the conflicts in the worktree, then re-run handoff.';
        error(msg);
        return { ok: false, error: msg };
      } else {
        const msg = 'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.';
        error(msg);
        return { ok: false, error: msg };
      }
    }

    // Step 1.7: NEL capture — compute actual NEL from merge diff and persist record.
    // architecture invariant: NEL is persisted through SqliteMissionStore.recordNel() via the Mission
    // use case; nel-record.json is no longer staged or committed because the SQLite
    // database is the sole durable authority for Mission state.
    log('Step 1.7: Capturing Net Engineering Lines (NEL) at handoff...');
    const nelResult = await captureNel(slug, { rootDir, missionDir: missionDirPath, log, error, missionServicesFn });
    if (nelResult.ok) {
      log(fmt.status('PASS', `NEL captured: ${nelResult.nel} NEL (${nelResult.bucket.label} bucket)`));
    } else if (nelResult.persistenceFailed) {
      const msg = `NEL persistence failed; handoff stopped before review state advanced: ${nelResult.error}`;
      error(msg);
      return { ok: false, error: msg };
    } else {
      log(fmt.status('WARN', `NEL capture skipped: ${nelResult.error}`));
    }

    // Step 2: Forgejo PR Update/Create (optional mirror when Forgejo is enabled)
    let token = null;
    let fallbackUser = null;
    let bootstrapFailureReason = null;
    if (forgejoEnabled) {
      log(`Step 2: Updating/Creating Forgejo PR as user ${fmt.agent(forgejoUser)}...`);
      token = ports.forgejo.readToken(forgejoUser);
      if (!token) {
        // Token missing for the agent user — attempt non-interactive bootstrap
        error(`Token not found for ${fmt.agent(forgejoUser)}. Attempting non-interactive bootstrap...`);

        const reviewSettings = ports.forgejo.resolveForgejoSettings(rootDir);
        const bootstrapSetup = {
          baseUrl: reviewSettings.url,
          repo: reviewSettings.repo,
          ownerLogin: 'human',
          ownerPassword: '',
          agentPasswords: [{ user: forgejoUser, password: '' }],
        };
        const bootstrapResult = await ports.setupReview.bootstrapReviewSurface(rootDir, bootstrapSetup, {
          interactive: false,
          requestFn: ports.setupReview.apiRequest,
          log,
        });

        if (bootstrapResult.ok) {
          log(fmt.status('PASS', `Bootstrap succeeded for ${fmt.agent(forgejoUser)}.`));
          token = ports.forgejo.readToken(forgejoUser);
          if (!token) {
            bootstrapFailureReason = 'bootstrap completed but token file for the agent user was not found';
            error('Bootstrap completed but token file for the agent user was not found. Falling back to default user.');
          }
        } else {
          bootstrapFailureReason = bootstrapResult.error || 'unknown';
          error(`Bootstrap for ${fmt.agent(forgejoUser)} failed: ${bootstrapFailureReason}. Falling back to default user.`);
        }

        // Handle bootstrap result that may not have error property
        const br = bootstrapResult;

        // Owner fallback if bootstrap didn't produce a token
        if (!token) {
          token = ports.forgejo.readToken('human');
          if (token) {
            fallbackUser = 'human';
            log(`Token not found for ${fmt.agent(forgejoUser)} and bootstrap did not succeed. Falling back to PR creation as ${fmt.agent(fallbackUser)}.`);
          } else {
            const msg = `No Forgejo token found for user "${fmt.agent(forgejoUser)}", bootstrap failed (${br.error || 'unknown'}), and no fallback token available for "${fmt.agent('human')}". Manual action required: create a token manually or run \`node parallix setup-review\` first.`;
            error(msg);
            return { ok: false, error: msg };
          }
        }
      }

      // Persist durable fallback summary when we fell back to the default user
      if (fallbackUser === 'human') {
        const reason = bootstrapFailureReason || 'agent token was missing and bootstrap did not provide a replacement token';
        const fallbackSummary = `## Fallback: PR submitted as ${fmt.agent(fallbackUser)}\n\nOriginal user: ${fmt.agent(forgejoUser)}\nBootstrap failure reason: ${reason}`;
        if (!this.writeFallbackSummary(slug, fallbackSummary, { rootDir, log })) {
          log(fmt.status('WARN', `Could not persist fallback summary for ${fmt.slug(slug)}`));
        }
      }

      const prResult = ports.forgejo.createPr(branch || '', String(fallbackUser || forgejoUser || 'default'), String(token || ''), {
        rootDir,
        log,
        forceWithLease
      });
      if (!prResult.ok) {
        const msg = `Forgejo PR creation/update failed: ${prResult.error}`;
        error(msg);
        return { ok: false, error: msg };
      }
    } else {
      log('Step 2: Skipping Forgejo PR (review provider is not forgejo).');
    }

    // Step 2.5: Gatekeeper pre-review validation
    // Run before transitioning Backlog to 'review' so missing artifacts are
    // flagged as a request-changes review instead of consuming a reviewer cycle.
    log('Step 2.5: Running gatekeeper pre-review validation...');
    const gatekeeperResult = runGatekeeperFn(slug, { rootDir, log });
    let gatekeeperPushedBack = false;
    if (!gatekeeperResult.ok && gatekeeperResult.posted) {
      fmt.log.warn(`Gatekeeper posted pushback for ${fmt.slug(slug)}: missing ${gatekeeperResult.missing.join(', ')}.`);
      gatekeeperPushedBack = true;
      log(`Keeping task ${fmt.slug(slug)} in active — not transitioning to review while artifacts are missing.`);
    } else if (!gatekeeperResult.ok && (gatekeeperResult.skipped || !gatekeeperResult.posted)) {
      fmt.log.fail(`Gatekeeper detected missing artifacts for ${fmt.slug(slug)} but could not post pushback: skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}. Blocking handoff — task remains in active until artifacts are present.`);
      error(`Missing mandatory artifacts: ${gatekeeperResult.missing.join(', ')}.`);
      return { ok: false, error: `Gatekeeper detected missing artifacts but could not post pushback (skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}). Fix missing artifacts before handoff: ${gatekeeperResult.missing.join(', ')}.` };
    } else {
      log('Gatekeeper: all mandatory artifacts present.');
    }

    if (gatekeeperPushedBack) {
      return await this.remediateGatekeeperPushback(slug, {
        gatekeeperResult,
        rootDir,
        forgejoUser,
        retriesLeft,
        currentAttempt,
        log,
        error,
        attemptAgentRelaunchFn,
        worktree,
        skipGate,
        forceWithLease,
        isForgejoReviewEnabledFn,
        rebaseFn,
        runVerificationGateFn,
        runGatekeeperFn,
        missionServicesFn,
      });
    }

    // Step 2.6: Generic ## Gates runner — execute any gates declared in MISSION.md
    log('Step 2.6: Running declared gates from MISSION.md...');
    const gatesResult = this.runDeclaredGates(verification.missionDir || '', rootDir, { log, error });
    if (!gatesResult.ok) {
      const msg = `Declared gate "${gatesResult.gate}" failed for ${fmt.slug(slug)}: ${gatesResult.error || gatesResult.reason}. Blocking handoff — task remains in active.`;
      error(msg);
      return {
        ok: false,
        error: msg,
        reason: gatesResult.reason,
        gateOutput: { stdout: (gatesResult.stdout || ''), stderr: (gatesResult.stderr || '') }
      };
    }
    if (gatesResult.skipped) {
      log(`No declared gates for ${fmt.slug(slug)} (${gatesResult.reason}).`);
    } else {
      log(`All ${gatesResult.count} declared gate(s) passed for ${fmt.slug(slug)}.`);
    }

    // architecture invariant: Transition Mission state through SqliteMissionStore FIRST.
    // The durable Mission state must commit before any external Backlog effect.
    // Database unavailability fails the operation (architecture invariant: fail-closed).
    const missionServices = await missionServicesFn(rootDir, { missionDir: missionDirPath });

    // architecture invariant: the checkpoint this handoff verified becomes durable Mission evidence
    // in SQLite. CP-N.md stays an operator-authored input; it is never the
    // authority the review transition reads.
    const checkpointName = path.basename(finalCheckpoint).replace(/\.md$/, '');
    const nextActionMatch = checkpointContent.match(/^\s*(?:\*\*)?Next action(?:\*\*)?:\s*(.+)$/mi);
    const checkpointOutcome = await missionServices.checkpoints.record({
      operationId: `handoff-checkpoint-${slug}`,
      missionId: slug,
      capabilities: new Set(['checkpoint:record']),
      checkpoint: {
        missionId: slug,
        name: checkpointName,
        rawFilename: path.basename(finalCheckpoint),
        firstLine: (checkpointContent.split('\n')[0] || '').replace(/^#+\s*/, ''),
        goalCheck: evidenceRows.map((row) => {
          const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
          return { criterion: cells[0] || '', evidence: cells[1] || '' };
        }),
        nextActionText: nextActionMatch ? nextActionMatch[1].trim() : 'Review the handed-off change.',
      },
    });
    if (checkpointOutcome.status !== 'completed') {
      const msg = `Recording checkpoint ${checkpointName} failed: ${checkpointOutcome.error?.message || 'unknown'}.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // The review subject records where the branch is headed. A repository without
    // a detectable primary branch still hands off; the target is nominal here.
    let targetBranch = 'main';
    try {
      targetBranch = ports.missionUtils.getPrimaryBranch(rootDir) || 'main';
    } catch {
      targetBranch = 'main';
    }
    const { reviewer, implementer, reviewerEligibility } = this.resolveHandoffReviewAssignment(forgejoUser, {
      worktree: rootDir,
      eligibleAgentsForStepFn,
      selectAgentFn,
      log,
    });
    const review = startReview({
      change: {
        kind: 'local-branch' as const,
        sourceBranch: branch,
        targetBranch,
      },
      revision: changeRevision(`handoff-${Date.now()}`),
    }, reviewer, implementer, new Date().toISOString(), reviewerEligibility);
    const transitionResult = await missionServices.lifecycle.transition({
      operationId: `handoff-transition-${slug}`,
      missionId: slug,
      capabilities: new Set(['mission:transition']),
      command: {
        type: 'submit-for-review',
        gatesPassed: true,
        review,
        reviewerEligibility,
      },
      actor: reviewer,
      occurredAt: new Date().toISOString(),
      // Stable across relaunches so the lane-event UNIQUE constraint deduplicates
      // a retried handoff instead of recording a second entry per attempt.
      idempotencyKey: `handoff-${slug}`,
    });
    if (transitionResult.status !== 'completed') {
      const msg = `Mission state transition failed: ${transitionResult.error?.message || 'unknown'}.`;
      error(msg);
      return { ok: false, error: msg };
    }
    log(fmt.status('PASS', `Mission state transitioned to review (v${transitionResult.value.version})`));

    // Step 3 & 4: Backlog Transition and Commit (external boundary effect after durable state committed).
    log('Step 3 & 4: Transitioning and committing Backlog task to review...');

    const taskImplementer = forgejoUser;
    if (!await ports.backlog.transitionTask(slug, 'review', { implementer: taskImplementer, rootDir, log })) {
      const msg = `Could not transition task ${fmt.slug(slug)} to review.`;
      error(msg);
      return { ok: false, error: msg };
    }

    if (forgejoEnabled && token) {
      const pushOutcome = this.pushBacklogTransition(slug, {
        rootDir,
        branch,
        token,
        fallbackUser,
        forgejoUser,
        force,
        log,
        error,
        gatekeeperPushedBack,
      });
      if (pushOutcome) { return pushOutcome; }
    }

    fmt.log.pass(`Mission ${fmt.slug(slug)} handed off successfully.`);
    return { ok: true, gatekeeperPushedBack };
  }

  /**
   * Push the Backlog transition commit to Forgejo under a lease.
   *
   * Returns a terminal `HandoffResult` when the caller must stop (failure, or the
   * plain-force success path that historically returned early), or `null` when the
   * push succeeded and the caller should continue to the success message.
   */
  private pushBacklogTransition(slug: string, context): HandoffResult | null {
    const ports = this.ports;
    const { rootDir, branch, token, fallbackUser, forgejoUser, force, log, error, gatekeeperPushedBack } = context;
    log('Pushing state change to Forgejo...');
    const reviewSettings = ports.forgejo.resolveForgejoSettings(rootDir);
    const repoOwner = (reviewSettings.repo && reviewSettings.repo.split('/')[0]) || null;
    const ownerToken = repoOwner ? ports.forgejo.readToken(repoOwner) : null;
    const pushUser = ownerToken && repoOwner ? repoOwner : (fallbackUser || forgejoUser);
    const pushToken = ownerToken || token;
    const remoteUrl = ports.forgejo.authenticatedReviewUrl(pushUser, pushToken, rootDir);
    // transitionTask commits the Backlog state on its integration branch, then
    // rebases this mission branch onto that new commit. Step 2 has already
    // published the pre-transition tip to create/update the PR, so this push
    // is necessarily non-fast-forward even during an ordinary handoff. Use a
    // lease to update that known PR tip without overwriting a concurrent push.
    let pushLeaseArg = null;
    {
      const fetchArgs = ['-C', rootDir, 'fetch', remoteUrl, `+refs/heads/${branch}:refs/remotes/review/${branch}`];
      const fetchResult = ports.git.git(fetchArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (fetchResult.status !== 0) {
        const fetchError = (fetchResult.stderr || fetchResult.stdout || '').trim();
        const msg = `Failed to refresh Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
        error(`${msg}${fetchError ? ` ${fetchError}` : ''}`);
        return { ok: false, error: msg };
      }
      const tracking = ports.forgejo.resolveTrackingBranchSha(branch || '', rootDir);
      if (!tracking.ok) {
        const msg = `Failed to resolve Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
        error(msg);
        return { ok: false, error: `${msg} ${tracking.error || ''}`.trim() };
      }
      pushLeaseArg = `--force-with-lease=refs/heads/${branch}:${String(tracking.sha || '')}`;
    }
    const pushArgs = ['-C', rootDir, 'push'];
    if (pushLeaseArg) {
      pushArgs.push(pushLeaseArg);
    }
    pushArgs.push(String(remoteUrl || ''), branch || '');
    const pushBacklogForgejo = ports.git.git(pushArgs);
    if (pushBacklogForgejo.status !== 0) {
      const pushError = [pushBacklogForgejo.stderr, pushBacklogForgejo.stdout].filter(Boolean).join('\n');
      if (force && /non-fast-forward|stale info|fetch first/i.test(pushError || '')) {
        const forceArgs = ['-C', rootDir, 'push', '--force', String(remoteUrl || ''), branch || ''];
        const forceResult = ports.git.git(forceArgs);
        if (forceResult.status === 0) {
          fmt.log.info(`Backlog transition for ${fmt.slug(slug)} required plain force after stale lease.`);
        } else {
          const forceError = (forceResult.stderr || forceResult.stdout || '').trim();
          const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
          error(msg);
          return { ok: false, error: forceError ? `${msg} ${forceError}` : msg };
        }
        return { ok: true, gatekeeperPushedBack };
      }
      const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
      error(msg);
      return { ok: false, error: pushError.trim() ? `${msg} ${pushError.trim()}` : msg };
    }
    return null;
  }

  /**
   * Bounded agent relaunch after gatekeeper pushback. Re-enters `performHandoff`
   * with a decremented retry budget and an incremented attempt counter, so the
   * recursion guard (3 attempts) and the global retry budget both hold.
   */
  private async remediateGatekeeperPushback(slug: string, context): Promise<HandoffResult> {
    const {
      gatekeeperResult, rootDir, forgejoUser, currentAttempt, log, error,
      attemptAgentRelaunchFn, worktree, skipGate, forceWithLease,
      isForgejoReviewEnabledFn, rebaseFn, runVerificationGateFn, runGatekeeperFn, missionServicesFn,
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
        .map(() => '- **create** at least one checkpoint document (e.g. `CP-1.md`) with a `## Goal Check` table containing real evidence (file:line, test names).'),
      ...missingItems
        .filter(item => item.includes('backlog/tasks') || item.includes('backlog/task'))
        .map(() => '- **create** a backlog task file at `backlog/tasks/<slug> - <title>.md` with YAML frontmatter (id, title, status, labels) and a description section.'),
      '',
      'After creating the missing artifacts, re-run the handoff (`px handoff ${slug}`).',
    ].join('\n');

    // Bounded retry: attempt agent relaunch using global retry budget
    const initialBudget = retriesLeft;
    while (retriesLeft > 0) {
      log(`Attempting agent relaunch (${initialBudget - retriesLeft + 1}/${initialBudget}) to create missing artifacts...`);
      const { relaunched, error: relaunchErr } = await attemptAgentRelaunchFn(
        slug, rootDir, `Gatekeeper pushback: missing artifacts for ${slug}: ${missingItems.join(', ')}`, forgejoUser,
        { log, error, promptOverride: relaunchPrompt }
      );
      if (relaunched) {
        log('Agent relaunched successfully. Waiting for artifact creation...');
        // Re-run handoff with decremented retry budget
        const retryResult = await this.performHandoff(slug, {
          worktree,
          skipGate,
          force: true,
          forceWithLease,
          isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
          rebaseFn: rebaseFn,
          runVerificationGateFn: runVerificationGateFn,
          runGatekeeperFn: runGatekeeperFn,
          attemptAgentRelaunchFn: attemptAgentRelaunchFn,
          missionServicesFn: missionServicesFn,
          log,
          error,
          maxAttempts: currentAttempt + 1,
          remainingRetries: retriesLeft - 1,
        });
        if (retryResult.ok) {
          log('Handoff succeeded after agent relaunch.');
          return { ...retryResult, gatekeeperPushedBack: true };
        }
        // Handoff still failed after relaunch — the recursive call already consumed
        // one retry attempt (via remainingRetries), so we break here rather than
        // continuing the parent's while loop.
        log(`Handoff still failed after relaunch: ${retryResult.error || 'unknown'}`);
        break;
      } else {
        log(`Agent relaunch failed: ${relaunchErr || 'unknown error'}`);
        break;
      }
    }

    // Retry budget exhausted
    const msg = `Gatekeeper pushback persisted after ${initialBudget} relaunch attempts. Manual intervention required to create: ${missingItems.join(', ')}.`;
    error(msg);
    return { ok: false, gatekeeperPushedBack: true, error: msg };
  }

  /**
   * Application entry point for an already translated CLI request. Argument
   * parsing, exit-code mapping, and usage rendering belong to the CLI interface.
   */
  async execute(request: { slug?: string; skipGate: boolean; force: boolean }, options: Record<string, unknown> = {}): Promise<HandoffResult> {
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
