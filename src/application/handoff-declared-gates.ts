/**
 * Declared gate validation and execution: reject prose, unbalanced, or
 * missing-file gate commands, then run recorded or document gates.
 */

import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import type { HandoffLog, HandoffWorkflowPorts } from './ports/handoff-workflow.js';

/**
 * Result of validating a declared gate command. The success variant carries
 * optional `error`/`gate` markers (typed `undefined`) so callers can read
 * `result.error`/`result.gate` across both variants.
 */
type GateValidationFailure = { ok: false; reason: 'validation-failed'; error: string; gate: string };
type GateValidationResult =
  | GateValidationFailure
  | { ok: true; reason: 'all-gates-valid'; error?: undefined; gate?: undefined };

/** Outcome of running a mission's declared gates, from either gate source. */
type DeclaredGatesResult =
  | { ok: true; skipped: true; reason: 'no-mission-file' | 'no-gates-section' | 'no-gates-declared' }
  | { ok: true; skipped: false; count: number; reason: 'all-gates-passed' }
  | GateValidationFailure
  | { ok: false; reason: 'gate-failed'; gate: string; error: string; stdout: string; stderr: string; exitCode: number | null };

/** Validates and executes the gates a Mission declares. */
export class DeclaredGateRunner {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  /** Reject gate commands that are prose, unbalanced, or reference missing files. */
  validateDeclaredGates(commands: string[], rootDir: string, options: { checkFiles?: boolean } = {}): GateValidationResult {
    const { fileSystem } = this.ports;
    for (const cmd of commands) {
      // Each guard isolates one failure mode. Splitting the original inline
      // scan into these helpers keeps per-function cognitive complexity bounded
      // and makes each branch independently testable. Order, messages, and
      // return shape are unchanged from the original implementation.
      if (this.gateCommandHasProse(cmd)) {
        return this.proseError(cmd);
      }
      const quoteType = this.gateUnclosedQuoteType(cmd);
      if (quoteType) {
        return this.quoteError(cmd, quoteType);
      }
      const imbalance = this.firstUnbalancedDelimiter(cmd);
      if (imbalance) {
        return this.delimiterError(cmd, imbalance);
      }
      // A gate recorded at draft may run a script the mission itself adds, so
      // only handoff, on the finished tree, requires its files to exist.
      const missingToken = options.checkFiles === false ? null : this.gateCommandMissingFile(cmd, rootDir, fileSystem);
      if (missingToken !== null) {
        return this.missingFileError(cmd, missingToken);
      }
    }

    return { ok: true, reason: 'all-gates-valid' };
  }

  /** Shared error payload for the "prose attached to a gate command" failure. */
  private proseError(cmd: string): GateValidationFailure {
    return {
      ok: false,
      reason: 'validation-failed',
      error: `Gate declaration must contain an exact runnable command only. Replace "${cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
      gate: cmd
    };
  }

  /**
   * Collapse a gate command to its unquoted form for prose inspection: quoted
   * runs become a single space, backslash escapes inside double quotes are
   * preserved as space padding, and the rest passes through unchanged. The
   * original inline scan did this before running the prose regexes.
   */
  private unquoteForProseScan(cmd: string): string {
    let unquoted = '';
    let inSingle = false;
    let inDouble = false;
    for (let ci = 0; ci < cmd.length; ci++) {
      const ch = cmd[ci];
      if (ch === '\\' && inDouble) {
        unquoted += '  ';
        ci++;
        continue;
      }
      if (ch === '\'' && !inDouble) {
        inSingle = !inSingle;
        unquoted += ' ';
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        unquoted += ' ';
        continue;
      }
      unquoted += inSingle || inDouble ? ' ' : ch;
    }
    return unquoted;
  }

  /**
   * A gate declaration carries prose when, after unquoting, it embeds an
   * en/em-dash description separator, an outcome-language suffix, or a trailing
   * parenthesised description. Markdown code spans are detected on the raw
   * command before unquoting.
   */
  private gateCommandHasProse(cmd: string): boolean {
    const unquoted = this.unquoteForProseScan(cmd);
    return (
      /^`[^`\r\n]+`\s+\S/.test(cmd) ||
      /\s(?:—|–|-–)\s+\S/.test(unquoted) ||
      /\s(?:passes?|passed|succeeds?|succeeded|completes?|completed)(?:\s+(?:on|in|with|without|after|before|for|the|a|an|successfully|cleanly)\b[^;&|]*)?[.!]?\s*$/i.test(unquoted) ||
      /(?<![&|;])\s+\([^()]*\)\s*$/.test(unquoted) ||
      // An unquoted shell comment is prose too: bash ignores it, so it states
      // an expectation that nothing checks.
      /(?:^|\s)#/.test(unquoted)
    );
  }

  /**
   * Return the quote type left open by a command, or null when balanced.
   * Respects quote context so apostrophes inside double quotes (and vice-versa)
   * are not flagged; only genuinely unmatched quotes are reported.
   */
  private gateUnclosedQuoteType(cmd: string): 'single' | 'double' | null {
    let inSingle = false;
    let inDouble = false;
    for (let ci = 0; ci < cmd.length; ci++) {
      const ch = cmd[ci];
      if (ch === '\\' && inDouble) {
        ci++;
        continue;
      }
      if (ch === '\'' && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
    }
    return inSingle ? 'single' : inDouble ? 'double' : null;
  }

  /**
   * Report the first delimiter type whose parentheses, braces, or brackets do
   * not balance, or null when all three balance. Collapses the three original
   * independent balance checks into a single shared counter helper.
   */
  private firstUnbalancedDelimiter(cmd: string): 'parentheses' | 'braces' | 'brackets' | null {
    const balanced = (open: string, close: string) => cmd.split(open).length === cmd.split(close).length;
    if (!balanced('(', ')')) {return 'parentheses';}
    if (!balanced('{', '}')) {return 'braces';}
    if (!balanced('[', ']')) {return 'brackets';}
    return null;
  }

  /**
   * Return the first literal file-path token that does not exist under rootDir,
   * or null when every path token resolves. URLs, flags, globs, and quoted
   * tokens are skipped exactly as in the original inline scan.
   */
  private gateCommandMissingFile(
    cmd: string,
    rootDir: string,
    fileSystem: HandoffWorkflowPorts['fileSystem']
  ): string | null {
    for (const token of cmd.split(/\s+/)) {
      if (/^https?:\/\//i.test(token) || token.includes('://')) {continue;}
      if (token.startsWith('-')) {continue;}
      const cleaned = token.replace(/^['"`]|['"`]$/g, '');
      if (/[?*[\]]/.test(cleaned)) {continue;}
      const looksLikePath =
        cleaned.startsWith('./') ||
        cleaned.startsWith('../') ||
        cleaned.startsWith('/') ||
        cleaned.includes('/');
      if (!looksLikePath) {continue;}
      if (!fileSystem.existsSync(path.resolve(rootDir, cleaned))) {return token;}
    }
    return null;
  }

  /** Shared error payload for an unclosed-quote failure. */
  private quoteError(cmd: string, quoteType: 'single' | 'double'): GateValidationFailure {
    return {
      ok: false,
      reason: 'validation-failed',
      error: `Gate command has unclosed ${quoteType} quotes: "${cmd}"`,
      gate: cmd
    };
  }

  /** Shared error payload for an unmatched-delimiter failure. */
  private delimiterError(cmd: string, imbalance: 'parentheses' | 'braces' | 'brackets'): GateValidationFailure {
    return {
      ok: false,
      reason: 'validation-failed',
      error: `Gate command has unmatched ${imbalance}: "${cmd}"`,
      gate: cmd
    };
  }

  /** Shared error payload for a missing file-reference failure. */
  private missingFileError(cmd: string, missingToken: string): GateValidationFailure {
    return {
      ok: false,
      reason: 'validation-failed',
      error: `Gate command references non-existent file: "${missingToken}" in command "${cmd}"`,
      gate: cmd
    };
  }

  /**
   * Parse and execute declared gates from a mission's MISSION.md `## Gates` section.
   * Each gate line is treated as a shell command executed through the process port.
   */
  runDeclaredGates(
    missionDir: string,
    rootDir: string,
    options: { log?: HandoffLog; error?: HandoffLog; recordedGates?: readonly string[] } = {},
  ): DeclaredGatesResult {
    const { fileSystem } = this.ports;
    const { log = fmt.log.plain } = options;

    // Gates recorded through `px gate add` are Mission state and are the
    // authority. Parsing the mission document's `## Gates` section is the
    // fallback for missions drafted before the gates were recorded.
    const recorded = options.recordedGates ?? [];
    if (recorded.length > 0) {
      return this.executeGateCommands([...recorded], rootDir, { log, source: 'recorded' });
    }

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
    const commands = gateLines.map((line): { cmd: string; reject: boolean } => {
      // Remove "- [ ] ", "- [x] ", or "- " prefix
      const cmd = line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '');
      // Reject gate entries that contain an explanatory dash separator
      // (em-dash, en-dash, or hyphen+en-dash followed by prose) before any
      // further processing, so validateDeclaredGates never sees a silently
      // sanitized command.
      if (/\s+(—|–|-–)\s+\S/.test(cmd)) {
        return { cmd, reject: true };
      }
      // Strip surrounding backticks (e.g., "`npm run typecheck`")
      return { cmd: cmd.replace(/^`(.+)`$/, '$1').trim(), reject: false };
    }).filter(entry => entry.cmd.length > 0);

    // Check for any rejected entries (dash-suffix gates)
    const rejected = commands.find(entry => entry.reject);
    if (rejected) {
      return {
        ok: false,
        reason: 'validation-failed',
        error: `Gate declaration must contain an exact runnable command only. Replace "${rejected.cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
        gate: rejected.cmd
      };
    }

    return this.executeGateCommands(commands.map(entry => entry.cmd), rootDir, { log, source: 'document' });
  }

  /**
   * Validate and run a list of gate commands.
   *
   * Shared by both gate sources so a gate recorded through `px gate add` is
   * validated, proof-reused and executed exactly like one parsed from a
   * mission document.
   */
  executeGateCommands(
    cleanCommands: string[],
    rootDir: string,
    options: { log?: HandoffLog; source?: string } = {},
  ): DeclaredGatesResult {
    const { verification, process: processPort } = this.ports;
    const { log = fmt.log.plain } = options;

    if (cleanCommands.length === 0) {
      return { ok: true, skipped: true, reason: 'no-gates-declared' };
    }

    // Pre-validate all gate commands before execution
    const validationResult = this.validateDeclaredGates(cleanCommands, rootDir);
    if (validationResult.ok === false) {
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
          stderr,
          exitCode: result.status,
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

}
