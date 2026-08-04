/**
 * Application port for the checked `AgentRunMeasurement` / `MissionOutcome`
 * persistence boundary (ADR 0053, architecture migration).
 *
 * The database is the sole authority for runtime statistics. There is no file
 * fallback: an unavailable store raises `MeasurementStoreUnavailableError`
 * rather than resolving, reading, or writing a CSV.
 *
 * Identity: architecture migration excluded `Attempt`, so measurements carry no per-run
 * identity. `MeasurementIdentity` is the grouping the domain already models —
 * `(repo, mission, stage, actorKey)`. The caller that owns the attribution
 * rule supplies `actorKey`; no adapter derives or invents one.
 *
 * The port is synchronous because every producer call site is synchronous and
 * the SQLite substrate (`node:sqlite` `DatabaseSync`) is natively synchronous.
 */

/** The identity of a stored measurement. No per-run/`Attempt` component. */
export interface MeasurementIdentity {
  /** Repository the mission belongs to. */
  readonly repo: string;
  /** Mission slug, lowercased. */
  readonly mission: string;
  /** Workflow stage (`draft`, `active`, `review`, `default`, …). */
  readonly stage: string;
  /** Normalized agent family the row is attributed to; supplied by the caller. */
  readonly actorKey: string;
}

/**
 * One stored measurement.
 *
 * Numeric fields use `undefined` for "unavailable" so the domain's
 * `Measurement.unavailable` kind stays distinct from a measured `0`; the
 * adapter maps `undefined` to SQL NULL.
 */
export interface MeasurementRecord extends MeasurementIdentity {
  readonly date?: string;
  readonly classification?: string;
  readonly implementer?: string;
  readonly pr_fix_rounds?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly implementer_agent?: string;
  readonly reviewer_agent?: string;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cached_tokens?: number;
  readonly context_tokens?: number;
  readonly tool_calls?: number;
  readonly openai_usage_before?: number;
  readonly openai_usage_after?: number;
  readonly openai_usage_delta?: number;
  readonly duration_minutes?: number;
  readonly cost_usd?: number;
  /** `'yes'` once the mission closed (a `MissionOutcome` row); `''` while open. */
  readonly closed?: string;
}

/** Result of a single upsert. */
export interface MeasurementUpsertResult {
  /** `true` when the stored row was inserted or any field changed. */
  readonly changed: boolean;
}

/**
 * The measurement persistence port.
 *
 * Implementations must be atomic per call and safe for concurrent writers:
 * two processes recording different measurements must both survive.
 */
export interface MeasurementStorePort {
  /**
   * Every stored measurement, ordered by `date, repo, mission, stage` — the
   * order the statistics reports have always consumed.
   */
  listMeasurements(): readonly MeasurementRecord[];

  /** Measurements for one mission slug across all repos and stages. */
  findByMission(_mission: string): readonly MeasurementRecord[];

  /** Insert or update one measurement, keyed by `MeasurementIdentity`. */
  upsertMeasurement(_record: MeasurementRecord): MeasurementUpsertResult;

  /**
   * Insert or update many measurements in ONE transaction. Either every record
   * is applied or none is — no partial batch is committed.
   */
  upsertAll(_records: readonly MeasurementRecord[]): MeasurementUpsertResult[];

  /** Release the underlying handle. */
  close(): void;
}

/**
 * Raised when the measurement database cannot be opened, migrated, or written.
 *
 * Callers must surface this failure. Falling back to a CSV file is forbidden
 * by ADR 0053 and by this mission's architecture invariant.
 */
export class MeasurementStoreUnavailableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MeasurementStoreUnavailableError';
    this.cause = cause;
  }
}
