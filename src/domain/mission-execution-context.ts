import type { CheckpointData } from './checkpoint.js';

export type PredictedNelBucket = 'small' | 'medium' | 'large';
export type RefinementConfidence = 'low' | 'medium' | 'high';

export interface MissionDependency {
  readonly reference: string;
  /** A bounded predecessor outcome; detailed evidence stays at this reference. */
  readonly outcome: string | null;
}

export interface MissionExecutionContext {
  readonly goal: string;
  readonly why: string;
  readonly scope: string;
  readonly constraints: readonly string[];
  readonly predictedNelBucket: PredictedNelBucket;
  readonly confidence: RefinementConfidence;
  readonly selectionNote: string;
  readonly mainDrivers: readonly string[];
  readonly declaredGates: readonly string[];
  readonly dependencies: readonly MissionDependency[];
}

const TEXT_LIMIT = 4_000;
const ITEM_LIMIT = 512;
// ADR 0053: the Mission aggregate carries bounded SQLite state, not the full
// predecessor/evidence list. Predecessor *references* stay bounded here; detailed
// evidence stays at each reference. ponytail: 256 is a ceiling, not a tuned
// throughput bound — raise it only if a live consumer proves it is hit.
const DEPENDENCY_LIMIT = 256;

function text(value: string, name: string, limit = TEXT_LIMIT): string {
  if (!value || value !== value.trim() || value.length > limit) {throw new Error(`${name} must be trimmed, non-empty and at most ${limit} characters`);}
  return value;
}

function items(values: readonly string[], name: string, min = 0, max = 16): readonly string[] {
  if (values.length < min || values.length > max) {throw new Error(`${name} must contain ${min}-${max} items`);}
  return values.map((value) => text(value, name, ITEM_LIMIT));
}

/** Validated bounded state used to start or resume a Mission without a document parse. */
export function missionExecutionContext(value: MissionExecutionContext): MissionExecutionContext {
  if (!['small', 'medium', 'large'].includes(value.predictedNelBucket)) {throw new Error('predicted NEL bucket is invalid');}
  if (!['low', 'medium', 'high'].includes(value.confidence)) {throw new Error('refinement confidence is invalid');}
  if (value.dependencies.length > DEPENDENCY_LIMIT) {throw new Error(`dependencies must contain at most ${DEPENDENCY_LIMIT} entries`);}
  return {
    goal: text(value.goal, 'goal'), why: text(value.why, 'why'), scope: text(value.scope, 'scope'),
    constraints: items(value.constraints, 'constraints'),
    predictedNelBucket: value.predictedNelBucket, confidence: value.confidence,
    selectionNote: text(value.selectionNote, 'selection note'),
    mainDrivers: items(value.mainDrivers, 'main drivers', 2, 4),
    declaredGates: items(value.declaredGates, 'declared gates'),
    dependencies: value.dependencies.map(({ reference, outcome }) => ({
      reference: text(reference, 'dependency reference', ITEM_LIMIT),
      outcome: outcome === null ? null : text(outcome, 'dependency outcome', ITEM_LIMIT),
    })),
  };
}

/**
 * Render the bounded execution context into the launch prompt slot. The live
 * execute path prefers this over the file-backed checkpoint context so a resume
 * can start from persisted facts without reading MISSION.md/CP-N.md. Large or
 * unbounded evidence stays at each dependency reference, never inline here.
 */
export function renderExecutionContextForLaunch(
  context: MissionExecutionContext,
  latestCheckpoint?: CheckpointData | null,
): string {
  const lines: string[] = [
    `Mission goal: ${context.goal}`,
    `Why: ${context.why}`,
    `Scope: ${context.scope}`,
  ];
  if (context.constraints.length > 0) {lines.push(`Constraints: ${context.constraints.join('; ')}`);}
  if (context.declaredGates.length > 0) {lines.push(`Declared gates: ${context.declaredGates.join('; ')}`);}
  if (context.dependencies.length > 0) {
    lines.push(`Dependencies: ${context.dependencies
      .map((dependency) => `${dependency.reference}${dependency.outcome ? ` (${dependency.outcome})` : ''}`)
      .join('; ')}`);
  }
  // These four are persisted as execution/refinement facts and must survive the
  // launch render so a resumed agent keeps the full read contract.
  if (context.predictedNelBucket) {lines.push(`Predicted NEL bucket: ${context.predictedNelBucket}`);}
  if (context.confidence) {lines.push(`Refinement confidence: ${context.confidence}`);}
  if (context.mainDrivers.length > 0) {lines.push(`Main drivers: ${context.mainDrivers.join('; ')}`);}
  if (context.selectionNote) {lines.push(`Selection note: ${context.selectionNote}`);}
  if (latestCheckpoint) {
    const name = latestCheckpoint.rawFilename ?? `${latestCheckpoint.name}.md`;
    const firstLine = (latestCheckpoint.firstLine ?? '').trim();
    lines.push(
      `Most recent checkpoint: ${name}${firstLine ? ` — ${firstLine}` : ''}`,
      `Resume from there, or start the next checkpoint if that one is complete.`,
    );
  }
  return `Persisted execution context (authoritative; do not re-read MISSION.md for these facts):\n${lines.join('\n')}`;
}

/**
 * Launch read contract: the persisted execution context plus the latest
 * checkpoint. A resumed agent that starts from persisted facts must keep the
 * file-backed resume signal (latest checkpoint + next action), which a bare
 * execution context read drops.
 */
export interface MissionLaunchContext {
  readonly context: MissionExecutionContext;
  readonly latestCheckpoint: CheckpointData | null;
}
