import fs from 'node:fs';
import path from 'node:path';

import type { Mission, MissionId, MissionLabel, MissionStatus } from '../../domain/mission.js';
import { missionId, missionLabels, recordNetEngineeringLines } from '../../domain/mission.js';
import type { CheckpointData, GoalCheckRow } from '../../domain/checkpoint.js';
import { isCheckpointName } from '../../domain/checkpoint.js';
import type { Review, ReviewerDecision } from '../../domain/review.js';
import {
  changeRevision,
  parseReviewDisposition,
  parseReviewPhase,
  stageLaunchWindowsFrom,
} from '../../domain/review.js';
import type { AgentFamily } from '../../domain/agents.js';
import { agentFamily } from '../../domain/agents.js';
import type { RepositoryId } from '../../domain/repository.js';
import { missionStatusFromBacklog } from '../backlog/mission-materialization.js';

// ---------------------------------------------------------------------------
// Candidate type
// ---------------------------------------------------------------------------

/** A single legacy task file mapped to a candidate Mission domain value. */
export interface MissionImportCandidate {
  /** Absolute path to the source task Markdown file. */
  readonly sourcePath: string;
  /** Validated MissionId extracted from the source file. */
  readonly missionId: MissionId;
  /** Repository identifier assigned to this Mission. */
  readonly repositoryId: RepositoryId;
  /** Title extracted from frontmatter or filename. */
  readonly title: string;
  /** Labels extracted from frontmatter. */
  readonly labels: readonly MissionLabel[];
  /** Assignee family or null. */
  readonly assignee: AgentFamily | null;
  /** Mapped domain status (from missionStatusFromBacklog). */
  readonly status: MissionStatus;
  /** Original raw status string from the backlog file. */
  readonly rawStatus: string;
  /** Checkpoint artifacts discovered in the mission directory. */
  readonly checkpoints: readonly CheckpointData[];
  /** Review object from review-state artifact, or null. */
  readonly review: Review | null;
  /** Captured net-engineering-lines measurement, or null. */
  readonly netEngineeringLines: number | null;
  /** Validation errors that prevent this candidate from being imported. */
  readonly validationErrors: readonly string[];
}

/** Frontmatter fields the importer reads from a legacy task file. */
export interface MissionFrontmatter {
  id?: string;
  title?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  netEngineeringLines?: string;
  [key: string]: string | string[] | undefined;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Read an untrusted retry counter, treating anything unusable as zero. */
export function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Parse an assignee value from frontmatter. Handles scalar strings ("codex")
 * and inline YAML list syntax ("[codex]" or "[codex, claude]").
 * Returns the first family when multiple assignees are present, or null.
 */
export function parseAssigneeValue(raw: string | string[]): string | null {
  if (Array.isArray(raw)) {
    return raw.length > 0 ? normalizeAssignee(raw[0]) : null;
  }
  const trimmed = raw.trim();
  // Inline YAML list: [codex] or [codex, claude]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return null;
    }
    // Take first item from comma-separated list
    return normalizeAssignee(inner.split(',')[0]);
  }
  return normalizeAssignee(trimmed);
}

/**
 * Strip surrounding YAML quotes (single or double) and a leading @ mention
 * prefix from a raw assignee token so it matches agentFamily()'s
 * /^[a-z][a-z0-9-]*$/ requirement.
 */
export function normalizeAssignee(value: string): string | null {
  let token = value.trim();
  // Strip surrounding YAML quotes
  if (
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith('"') && token.endsWith('"'))
  ) {
    token = token.slice(1, -1);
  }
  // Strip leading @ mention prefix
  if (token.startsWith('@')) {
    token = token.slice(1);
  }
  return token || null;
}

/**
 * Serialize a value with object keys in a stable order so two aggregate fields
 * can be compared for deep equality by string identity. Array order is
 * preserved — element position is meaningful in the persisted aggregate.
 * `undefined` and an absent key are treated alike (both serialize to `null`).
 */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === undefined) {
      return null;
    }
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input !== null && typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([key, entryValue]) => [key, normalize(entryValue)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

/** Shorten a serialized value so conflict details stay readable in a report. */
export function truncate(value: string, limit = 120): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

// ---------------------------------------------------------------------------
// Frontmatter and task identity
// ---------------------------------------------------------------------------

/** Parse YAML-like frontmatter from a Markdown file. */
export function parseFrontmatter(content: string): MissionFrontmatter {
  const result: Record<string, string | string[] | undefined> = {};
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return result;
  }

  const block = frontmatterMatch[1];
  const lines = block.split('\n');
  let currentKey: string | null = null;
  let currentList: string[] = [];

  const flushList = () => {
    if (currentKey && currentList.length > 0) {
      // Merge with any inline value (e.g. "labels: first_item" followed by list items)
      const existing = result[currentKey];
      if (typeof existing === 'string') {
        result[currentKey] = [existing, ...currentList];
      } else {
        result[currentKey] = currentList;
      }
    }
    currentKey = null;
    currentList = [];
  };

  for (const line of lines) {
    // List item
    const listMatch = line.match(/^\s*-\s+(.+)/);
    if (listMatch && currentKey) {
      currentList.push(listMatch[1].trim());
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w[\w]*):\s*(.*)/);
    if (kvMatch) {
      flushList();
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value) {
        result[currentKey] = value;
      }
      continue;
    }

    flushList();
  }
  flushList();

  return result;
}

/** Extract task id from frontmatter, falling back to filename prefix. */
export function extractTaskId(taskFile: string): string | null {
  // Try frontmatter first
  const content = fs.readFileSync(taskFile, 'utf8');
  const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
  if (idMatch) {
    return idMatch[1].trim();
  }

  // Fallback: filename prefix (task-NNN or task-NNN.suffix)
  const basename = path.basename(taskFile, '.md');
  const match = basename.match(/^(task-\d+(?:\.\d+)?)/i);
  return match ? match[1].toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// Filesystem discovery
// ---------------------------------------------------------------------------

/** Read all .md files from a directory. Returns empty array if dir missing. */
export function readMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => path.join(dir, f));
}

/**
 * Find the mission directory for a given slug.
 *
 * The directory name must equal the mission id exactly. A prefix match is
 * not identity-safe — `missions/architecture migration-10` starts with `architecture migration-1`
 * without belonging to it — so directories that merely start with the slug
 * are reported as an ambiguous source identity rather than guessed at.
 */
export function findMissionDir(
  rootDir: string,
  slug: MissionId,
): { dir: string | null; errors: string[] } {
  const missionsBase = path.join(rootDir, 'missions');
  if (!fs.existsSync(missionsBase)) {
    return { dir: null, errors: [] };
  }

  const directories = fs.readdirSync(missionsBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const exact = directories.find((name) => name === slug);
  if (exact) {
    return { dir: path.join(missionsBase, exact), errors: [] };
  }

  const prefixed = directories.filter((name) => name.startsWith(slug)).sort();
  if (prefixed.length > 0) {
    return {
      dir: null,
      errors: [
        `ambiguous-mission-directory: no "missions/${slug}" directory exists, but ${prefixed.length} `
        + `directory name(s) start with the mission id (${prefixed.join(', ')}); `
        + 'rename the source directory to match the mission id exactly',
      ],
    };
  }

  return { dir: null, errors: [] };
}

/** Extract numeric checkpoint order from filename. */
export function checkpointOrder(filename: string): number {
  const match = filename.match(/(?:CP-|CHECKPOINT_)(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// Checkpoint parsing
// ---------------------------------------------------------------------------

/**
 * Read checkpoint files from a mission directory into CheckpointData.
 * Validates each artifact name via isCheckpointName() and reports parse
 * failures as validation errors (not silently skipped).
 */
export function readCheckpointFiles(missionDir: string, id: MissionId): {
  checkpoints: readonly CheckpointData[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!fs.existsSync(missionDir)) {
    return { checkpoints: [], errors };
  }

  const files = fs.readdirSync(missionDir);
  const checkpointFiles = files
    .filter((f: string) => /^(CHECKPOINT_|CP-\d+).*\.md$/i.test(f))
    .sort((a, b) => checkpointOrder(a) - checkpointOrder(b));

  const checkpoints: CheckpointData[] = [];

  for (const filename of checkpointFiles) {
    const filepath = path.join(missionDir, filename);
    const name = path.basename(filename, '.md');

    // Validate checkpoint name (must match ^CP-\d+$)
    if (!isCheckpointName(name)) {
      errors.push(`invalid-checkpoint-name: "${name}" is not a valid checkpoint name`);
      continue;
    }

    let firstLine = '';
    let goalCheck: readonly GoalCheckRow[] = [];
    let nextActionText = '';

    try {
      const content = fs.readFileSync(filepath, 'utf8');
      firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
      goalCheck = parseGoalCheckTable(content);
      nextActionText = extractNextAction(content);
    } catch {
      errors.push(`unreadable-checkpoint: "${filename}" could not be parsed`);
      continue;
    }

    checkpoints.push({
      missionId: id,
      name,
      rawFilename: filename,
      firstLine,
      goalCheck,
      nextActionText,
    } satisfies CheckpointData);
  }

  return { checkpoints, errors };
}

/**
 * Parse the Goal Check markdown table from a checkpoint file.
 * Extracts rows from a pipe-delimited table with columns:
 * | Criterion | Evidence | Status |
 */
export function parseGoalCheckTable(content: string): readonly GoalCheckRow[] {
  const rows: GoalCheckRow[] = [];
  const lines = content.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table header
    if (trimmed.startsWith('| Criterion') && trimmed.includes('| Evidence') && trimmed.includes('| Status')) {
      inTable = true;
      continue;
    }

    // Detect separator row
    if (inTable && /^\|[-|\s]+\|$/.test(trimmed)) {
      continue;
    }

    // Parse data rows
    if (inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Check if this is a data row (not empty)
      const cells = trimmed.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 2) {
        rows.push({
          criterion: cells[0],
          evidence: cells[1],
        });
      } else if (cells.length === 0) {
        // Empty row — end of table
        inTable = false;
      }
    } else if (inTable && trimmed.length === 0) {
      // Empty line after table
      inTable = false;
    }
  }

  return rows;
}

/**
 * Extract the next action text from a checkpoint file.
 * Looks for `## Next action:` or `Next action:` section.
 */
export function extractNextAction(content: string): string {
  const match = content.match(/##\s*Next action[\s:]*\n([\s\S]*?)(?=\n##|$)/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Review parsing
// ---------------------------------------------------------------------------

/**
 * Read review-state.json from a mission directory and construct a Review
 * domain object.
 *
 * An absent artifact is an optional omission (no review, no error). A
 * *present* artifact that cannot be read, parsed, or validated is a source
 * defect: it is reported as a validation error so apply() refuses the whole
 * import rather than persisting the Mission as if it had never been
 * reviewed.
 */
export function readMissionReview(missionDir: string | null, id: MissionId): {
  review: Review | null;
  errors: string[];
} {
  if (!missionDir) {
    return { review: null, errors: [] };
  }

  const reviewStatePath = path.join(missionDir, 'review-state.json');
  if (!fs.existsSync(reviewStatePath)) {
    return { review: null, errors: [] };
  }

  let content: string;
  try {
    content = fs.readFileSync(reviewStatePath, 'utf8');
  } catch (error) {
    return {
      review: null,
      errors: [`unreadable-review-state: "${reviewStatePath}" could not be read (${(error as Error).message})`],
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    return {
      review: null,
      errors: [`invalid-review-state: "${reviewStatePath}" is not valid JSON (${(error as Error).message})`],
    };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      review: null,
      errors: [`invalid-review-state: "${reviewStatePath}" is not a JSON object`],
    };
  }

  return reviewFromState(data as Record<string, unknown>, id, reviewStatePath);
}

/**
 * Construct a Review domain object from review-state.json data.
 *
 * Required values (reviewer, implementer, round, startedAt) are validated
 * through the domain constructors; they are never fabricated from defaults,
 * because a substituted value would silently misrepresent the source.
 */
export function reviewFromState(
  data: Record<string, unknown>,
  id: MissionId,
  sourcePath: string,
): { review: Review | null; errors: string[] } {
  const errors: string[] = [];
  const invalid = (field: string, value: unknown, expected: string): void => {
    errors.push(
      `invalid-review-state: "${sourcePath}" has an invalid "${field}" value `
      + `(${JSON.stringify(value) ?? 'undefined'}); expected ${expected}`,
    );
  };

  const reviewer = requiredAgentFamily(data.reviewer, 'reviewer', sourcePath, errors);
  const implementer = requiredAgentFamily(data.implementer, 'implementer', sourcePath, errors);

  let round = 0;
  if (typeof data.round !== 'number' || !Number.isInteger(data.round) || data.round < 1) {
    invalid('round', data.round, 'a positive integer');
  } else {
    round = data.round;
  }

  let startedAt = '';
  if (typeof data.startedAt !== 'string' || !data.startedAt.trim()
    || Number.isNaN(Date.parse(data.startedAt))) {
    invalid('startedAt', data.startedAt, 'an ISO-8601 timestamp');
  } else {
    startedAt = data.startedAt.trim();
  }

  if (data.phase !== undefined && typeof data.phase !== 'string') {
    invalid('phase', data.phase, 'a string');
  }
  const phase = typeof data.phase === 'string' ? data.phase : '';

  if (data.disposition !== undefined && data.disposition !== null
    && typeof data.disposition !== 'string') {
    invalid('disposition', data.disposition, 'a string');
  }
  const disposition = typeof data.disposition === 'string' ? data.disposition : null;

  if (!reviewer || !implementer || errors.length > 0) {
    return { review: null, errors };
  }

  // Build ReviewedRevision from review state data
  let revision: string & { readonly __brand: 'ChangeRevision' };
  try {
    revision = changeRevision(startedAt);
  } catch (error) {
    errors.push(
      `invalid-review-state: "${sourcePath}" "startedAt" is not a usable revision `
      + `(${(error as Error).message})`,
    );
    return { review: null, errors };
  }

  const subject = {
    change: {
      kind: 'local-branch' as const,
      sourceBranch: `mission/${id}`,
      targetBranch: 'main',
    },
    revision,
  };

  // Build decision from phase
  const decision = decisionFromPhase(phase, disposition, startedAt);

  const roundObj = {
    number: round,
    subject,
    reviewer,
    implementer,
    startedAt,
    decision,
    response: null,
    phase: parseReviewPhase(phase) ?? 'reviewing',
    disposition: parseReviewDisposition(disposition),
    reviewerRetryCount: nonNegativeCount(data.reviewerRetryCount),
    implementerRetryCount: nonNegativeCount(data.implementerRetryCount),
  };

  return {
    review: {
      rounds: [roundObj],
      intervention: null,
      stageLaunches: stageLaunchWindowsFrom(
        (data.metadata as Record<string, unknown> | undefined)?.recordedStageLaunches,
      ),
      gateFailureRetryCount: nonNegativeCount(
        (data.metadata as Record<string, unknown> | undefined)?.gateFailureRetryCount,
      ),
      hookFailureRetryCount: nonNegativeCount(
        (data.metadata as Record<string, unknown> | undefined)?.hookFailureRetryCount,
      ),
      reviewEvents: [],
    },
    errors,
  };
}

/** Build ReviewerDecision from review phase. */
export function decisionFromPhase(
  phase: string,
  disposition: string | null,
  startedAt: string,
): ReviewerDecision | null {
  if (phase === 'approved') {
    return {
      kind: 'approved',
      decidedAt: startedAt,
      comment: disposition || null,
      source: { kind: 'local' },
    };
  }
  if (phase === 'fixing' && disposition) {
    return {
      kind: 'changes-requested',
      decidedAt: startedAt,
      comment: disposition,
      findings: [],
    };
  }
  return null;
}

/**
 * Construct a required AgentFamily from a review-state field, recording a
 * validation error instead of substituting a fallback family.
 */
export function requiredAgentFamily(
  value: unknown,
  field: string,
  sourcePath: string,
  errors: string[],
): AgentFamily | null {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(
      `invalid-review-state: "${sourcePath}" is missing the required "${field}" agent family`,
    );
    return null;
  }
  try {
    return agentFamily(value.trim());
  } catch (error) {
    errors.push(
      `invalid-review-state: "${sourcePath}" has an invalid "${field}" agent family `
      + `("${value}": ${(error as Error).message})`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Candidate construction
// ---------------------------------------------------------------------------

/** Build a MissionImportCandidate from a task file. Returns null on parse failure. */
export function buildCandidate(
  taskFile: string,
  context: { rootDir: string; repositoryId: RepositoryId },
): MissionImportCandidate | null {
  const content = fs.readFileSync(taskFile, 'utf8');
  const rawTaskId = extractTaskId(taskFile);
  if (!rawTaskId) {
    return null;
  }

  // Validate missionId using domain constructor (architecture invariant)
  let missionIdValue: MissionId;
  const validationErrors: string[] = [];
  try {
    missionIdValue = missionId(rawTaskId.toLowerCase());
  } catch (error) {
    validationErrors.push(`invalid-mission-id: ${(error as Error).message}`);
    // Use the raw value for reporting even if invalid
    missionIdValue = rawTaskId.toLowerCase() as MissionId;
  }

  // Extract frontmatter fields
  const frontmatter = parseFrontmatter(content);
  const rawStatus = frontmatter.status || '';
  const title = frontmatter.title || path.basename(taskFile, '.md');

  // Map status using missionStatusFromBacklog (architecture invariant)
  const mappedStatus = missionStatusFromBacklog(rawStatus);
  if (!mappedStatus) {
    validationErrors.push(`unmappable-status: "${rawStatus}" does not map to a valid MissionStatus`);
  }
  const status = mappedStatus || 'backlog';

  // Labels: frontmatter.labels can be a string (single inline value) or string[]
  const rawLabels: string[] = Array.isArray(frontmatter.labels)
    ? frontmatter.labels
    : typeof frontmatter.labels === 'string'
      ? [frontmatter.labels]
      : [];
  const labels = missionLabels(rawLabels);

  // Assignee: handle scalar and inline YAML list shapes (e.g. "codex" or "[codex]")
  const assignee: AgentFamily | null = (() => {
    const raw = frontmatter.assignee;
    if (!raw) {
      return null;
    }
    const family = parseAssigneeValue(raw);
    if (!family) {
      return null;
    }
    try {
      return agentFamily(family);
    } catch (error) {
      validationErrors.push(
        `invalid-assignee: "${family}" is not a valid agent family (${(error as Error).message})`,
      );
      return null;
    }
  })();

  // Checkpoints and review from mission directory
  const missionDirResult = findMissionDir(context.rootDir, missionIdValue);
  const missionDir = missionDirResult.dir;
  validationErrors.push(...missionDirResult.errors);
  const checkpointResult = missionDir
    ? readCheckpointFiles(missionDir, missionIdValue)
    : { checkpoints: [], errors: [] };
  const checkpoints: readonly CheckpointData[] = checkpointResult.checkpoints;
  validationErrors.push(...checkpointResult.errors);
  const reviewResult = readMissionReview(missionDir, missionIdValue);
  const review = reviewResult.review;
  validationErrors.push(...reviewResult.errors);

  // NEL: validate supplied values through recordNetEngineeringLines (architecture invariant)
  const netEngineeringLinesRaw = frontmatter.netEngineeringLines;
  let netEngineeringLines: number | null = null;
  if (netEngineeringLinesRaw !== undefined && netEngineeringLinesRaw !== '') {
    const numeric = Number(netEngineeringLinesRaw);
    if (Number.isNaN(numeric)) {
      validationErrors.push(
        `invalid-net-engineering-lines: "${netEngineeringLinesRaw}" is not a number`,
      );
    } else {
      // Use recordNetEngineeringLines to validate (non-negative integer)
      // Build a minimal Mission just for validation — the NEL value is the
      // only field checked by recordNetEngineeringLines.
      const dummyMission: Mission = {
        id: missionIdValue,
        repositoryId: context.repositoryId,
        title: title,
        labels: labels,
        assignee: assignee,
        status: status,
        rawStatus: rawStatus,
        checkpoints: [],
        review: null,
        netEngineeringLines: null,
        closedAt: null,
      };
      try {
        recordNetEngineeringLines(dummyMission, numeric);
        netEngineeringLines = numeric;
      } catch (error) {
        validationErrors.push(
          `invalid-net-engineering-lines: "${netEngineeringLinesRaw}" (${(error as Error).message})`,
        );
      }
    }
  }

  return {
    sourcePath: taskFile,
    missionId: missionIdValue,
    repositoryId: context.repositoryId,
    title,
    labels,
    assignee,
    status,
    rawStatus,
    checkpoints,
    review,
    netEngineeringLines,
    validationErrors,
  };
}
