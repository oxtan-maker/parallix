/** Application-owned ports for CLI workflow execution. Concrete implementations
 * are supplied only by the composition root. */
export interface IntegrateWorkflowPort {
  execute(_args: string[], _options?: Record<string, unknown>): Promise<unknown> | unknown;
}

/** Adapter operations required by the stats reporting workflow. The application
 * owns the sequence; CLI and infrastructure provide these operations. */
export interface StatsWorkflowPort<Row = unknown> {
  loadMeasurements(_options: Record<string, unknown>): readonly Row[];
  resolveClassification(_slug: string, _options: Record<string, unknown>): unknown;
  deriveImplementerAndFixRounds(_slug: string, _options: Record<string, unknown>): unknown;
  resolveRepositoryName(_options: Record<string, unknown>): string;
  lookupForgejo?(_slug: string, _options: Record<string, unknown>): unknown;
  backfill?(_options: Record<string, unknown>): unknown;
}

/** Context passed between draft workflow steps.
 * Carries state from preflight through commit safety. */
export interface DraftWorkflowContext {
  /** True if the workflow should stop (exitFn was called). */
  readonly exited: boolean;
  /** Normalized mission slug. */
  readonly slug: string;
  /** Primary checkout path. */
  readonly mainRepo: string;
  /** Mission worktree path. */
  readonly targetWorktree: string;
  /** Path to MISSION.md. */
  readonly missionFile: string;
  /** Recorded base branch (null if primary/detached HEAD). */
  readonly recordedBase: string | null;
  /** Synthetic task info (for adhoc missions). */
  readonly syntheticTask: unknown;
  /** Selected agent family. */
  readonly agent: string;
  /** Actual agent family (may differ from selected). */
  readonly actualAgent: string | null;
  /** Agent launch result. */
  readonly agentResult: unknown;
  /** Exit function. */
  readonly exitFn: (_code?: number) => never;
  /** Log function. */
  readonly logFn: (_msg: string) => void;
  /** Error function. */
  readonly errorFn: (_msg: string) => void;
  /** Mission services factory. */
  readonly missionServicesFn: Function;
  /** Additional options passed through. */
  readonly options: Record<string, unknown>;
}

export interface DraftWorkflowPort {
  /** Resolve slug, validate repo, baseline, config, task resolution, classification. */
  preflight(_args: string[], _options?: Record<string, unknown>): DraftWorkflowContext;
  /** Create branch, worktree, graphify workspace, gitignore. */
  setup(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Scaffold MISSION.md, record base branch, bootstrap backlog task. */
  scaffold(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Materialize mission in SQLite via intake service. */
  intake(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Transition backlog task to target status. */
  transition(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Read agent config, select agent, launch draft agent, record implementer and stats. */
  launchAgent(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Normalize classification (restart agent if needed), label sync, re-assert base branch. */
  postProcess(_context: DraftWorkflowContext): Promise<DraftWorkflowContext> | DraftWorkflowContext;
  /** Enforce draft commit safety — capture uncommitted changes. */
  commitSafety(_context: DraftWorkflowContext): DraftWorkflowContext;
  /** Final transition to 'ready' status. */
  finalTransition(_context: DraftWorkflowContext): Promise<void> | void;
}
