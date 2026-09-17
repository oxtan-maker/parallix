export type MachineWrittenPathClass =
  | 'durable-state'
  | 'user-authored-content'
  | 'generated-output'
  | 'cache-scratch-data'
  | 'secrets-configuration';

/** ADR 0053 classification for a durable-state boundary. */
export type ADR0053Classification =
  | 'database-owned-domain-state'
  | 'explicit-one-way-legacy-input'
  | 'external-fact-or-intake'
  | 'configuration-or-secret'
  | 'generated-artifact'
  | 'forbidden-persistence';

export interface MachineWrittenPathInventoryEntry {
  id: string;
  pathPattern: string;
  writer: string;
  classification: MachineWrittenPathClass;
  persistencePolicy: string;
}

/**
 * One production reader or writer entry for an ADR 0053 durable-state concept.
 *
 * Every entry names:
 * - the ADR 0053 concept it belongs to
 * - whether it is the default or compatibility (legacy) path
 * - the file location of the reader or writer
 * - the operation it performs
 * - its ADR 0053 classification
 * - the later cutover task for temporary exceptions
 */
export interface ADR0053BoundaryEntry {
  /** Stable identifier for this boundary. */
  readonly id: string;
  /** ADR 0053 concept this boundary belongs to. */
  readonly concept: ADR0053ConceptName;
  /** Default path or compatibility (legacy) path. */
  readonly pathType: 'default' | 'compatibility';
  /** File location of the reader or writer (relative to repo root). */
  readonly fileLocation: string;
  /** 'read' or 'write'. */
  readonly operation: 'read' | 'write';
  /** ADR 0053 classification. */
  readonly classification: ADR0053Classification;
  /** Later cutover task that removes this temporary exception, or null if permanent. */
  readonly cutoverTask: string | null;
}

/** The 15 ADR 0053 durable-state concepts listed in the persistence ADR. */
export type ADR0053ConceptName =
  | 'Mission'
  | 'CheckpointData'
  | 'Review'
  | 'MissionOutcome'
  | 'AgentRunMeasurement'
  | 'KnownRepository'
  | 'SessionMarker'
  | 'LaneTransitionEvent'
  | 'AgentBlock'
  | 'UIPreferences'
  | 'TaskIntake'
  | 'GitObservations'
  | 'Configuration'
  | 'Secrets'
  | 'LargeArtifacts';

/**
 * Exhaustive executable inventory of production readers and writers for all
 * 15 ADR 0053 durable-state concepts.
 *
 * Every current default and compatibility reader/writer is listed. Each
 * boundary is classified as exactly one of the ADR 0053 categories. Temporary
 * exceptions (compatibility paths that will be removed by a later cutover)
 * name the specific task that owns their removal.
 *
 * This inventory is the contract that the architecture test in CP 3 enforces:
 * any new durable file read or write must be registered here or the build fails.
 */
export const ADR0053_PERSISTENCE_INVENTORY: readonly ADR0053BoundaryEntry[] = [
  // -----------------------------------------------------------------------
  // Mission — authoritative domain state (target-repository, file-backed)
  // -----------------------------------------------------------------------
  {
    id: 'mission-read-backlog',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/concrete-mission-read-adapter.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-write-handoff',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/handoff.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-write-draft',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/draft-setup.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-read-draft-stats',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/draft-stats.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-read-integrate',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/integrate.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    // TASK-2369.06: extracted from integrate.ts — persistLandedIntegrationOrAbort
    // reads Mission via store.load and writes via decideIntegration/close
    id: 'mission-read-integrate-post',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/integrate-post.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-write-integrate-post',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/integrate-post.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    // TASK-2369.06: extracted from integrate.ts — reads mission task files
    // (rewriteWorktreePaths) and noise patches (prepareNoisePatchForSquash)
    id: 'mission-read-integrate-conflict',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/integrate-conflict.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    // TASK-2369.06: extracted from integrate.ts — writes mission task files
    // (rewriteWorktreePaths, line 191) and noise patches (prepareNoisePatchForSquash,
    // line 44) and removes temp patch dir (fs.rmSync, line 43)
    id: 'mission-write-integrate-conflict',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/integrate-conflict.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    // TASK-2322.07 cutover complete: SqliteMissionStore is the sole production
    // authority. Reads the checked Mission aggregate (including CheckpointData,
    // Review, NEL, external task ref) from normalized relational rows.
    id: 'mission-read-sqlite-store',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-write-sqlite-store',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-state-map-read',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/config/state-map.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-gate-adapter-read',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/concrete-gate-read-adapter.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // persistent-data-migration: still used for data migration (not subsumed by SQLite).
  {
    id: 'mission-migration-read',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/storage/persistent-data-migration.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'mission-migration-write',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/storage/persistent-data-migration.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // CheckpointData — nested Mission data (SQLite after TASK-2322.07 cutover)
  // -----------------------------------------------------------------------
  {
    id: 'checkpoint-read-sqlite-store',
    concept: 'CheckpointData',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'checkpoint-write-sqlite-store',
    concept: 'CheckpointData',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'checkpoint-write-gate-result',
    concept: 'CheckpointData',
    pathType: 'default',
    fileLocation: 'src/adapters/verification/verification.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  {
    id: 'checkpoint-read-gate-result-prompt',
    concept: 'CheckpointData',
    pathType: 'default',
    fileLocation: 'src/adapters/review/review-prompts.ts',
    operation: 'read',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // Review — nested Mission data (SQLite after TASK-2322.07 cutover)
  // -----------------------------------------------------------------------
  {
    id: 'review-read-sqlite-store',
    concept: 'Review',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'review-write-sqlite-store',
    concept: 'Review',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/mission-store.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // TASK-2322.12 cutover complete. The review loop's round, phase, disposition,
  // retry counters and stage-launch windows are served by the Review aggregate
  // through SqliteMissionStore; review events are rows in mission_review_events
  // and implementer response details (pushed_back_items, fixed_items, ...) are
  // columns on mission_review_rounds. No review module reads or writes a file
  // for any of it: review-state.json is gone, the review-event Markdown is a
  // one-way export (below), and the /tmp artifacts review-artifacts.ts consumes
  // are scratch transport from the agent process — read once, deleted, never a
  // source of truth. A mission handed off before the cutover is migrated once
  // with `px review <slug> --backfill-review`.
  {
    // `px review <slug> --backfill-review` reads a surviving review-state.json
    // once, to seed the Review of a mission handed off before the cutover. It
    // is operator-invoked, never part of a loop read, and writes nothing back
    // to the file — the one-way door ADR 0053 allows for legacy input.
    id: 'review-import-legacy-review-state',
    concept: 'Review',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/review/review-state.ts',
    operation: 'read',
    classification: 'explicit-one-way-legacy-input',
    cutoverTask: null,
  },
  {
    // The Markdown files under missions/<slug>/review-events/ are rendered from
    // the stored event so a mission directory reads as its own review history.
    // Write-only: nothing in production reads them back, and deleting them
    // loses no state.
    id: 'review-export-review-events',
    concept: 'Review',
    pathType: 'default',
    fileLocation: 'src/adapters/review/review-events.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // MissionOutcome — derived from Mission + AgentRunMeasurement
  // -----------------------------------------------------------------------
  {
    id: 'outcome-derive-completed',
    concept: 'MissionOutcome',
    pathType: 'default',
    fileLocation: 'src/domain/usage.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: 'TASK-2322.03',
  },
  {
    // TASK-2322.08: the completed-mission row is written to the measurement
    // database through `MeasurementStorePort`. The former `stats.csv` writer
    // is deleted.
    id: 'outcome-measurement-store-write',
    concept: 'MissionOutcome',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/measurement-store.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // AgentRunMeasurement — operator-local measurement data
  // -----------------------------------------------------------------------
  {
    // TASK-2322.08: `px stats` and every stage recorder read the measurement
    // database. No default path resolves or reads `stats.csv`.
    id: 'measurement-store-read',
    concept: 'AgentRunMeasurement',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/measurement-store.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'measurement-store-write',
    concept: 'AgentRunMeasurement',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/measurement-store.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'measurement-sqlite-usage-repo',
    concept: 'AgentRunMeasurement',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/usage-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'measurement-sqlite-usage-write',
    concept: 'AgentRunMeasurement',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/usage-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'measurement-stats-backfill-read',
    concept: 'AgentRunMeasurement',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/stats-backfill.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'measurement-codex-telemetry-read',
    concept: 'AgentRunMeasurement',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/codex-telemetry.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: 'TASK-2322.03',
  },
  {
    id: 'measurement-vibe-telemetry-read',
    concept: 'AgentRunMeasurement',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/vibe-telemetry.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: 'TASK-2322.03',
  },
  // -----------------------------------------------------------------------
  // KnownRepository — operator-local cache
  // -----------------------------------------------------------------------
  {
    id: 'known-repo-sqlite-read',
    concept: 'KnownRepository',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/repository-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'known-repo-sqlite-write',
    concept: 'KnownRepository',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/repository-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // SessionMarker — SQLite-backed resume marker (TASK-2322.09 cutover complete)
  // -----------------------------------------------------------------------
  {
    id: 'session-read-sessions',
    concept: 'SessionMarker',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/session-marker-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'session-write-sessions',
    concept: 'SessionMarker',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/session-marker-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'session-import-legacy-files',
    concept: 'SessionMarker',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/session-marker-import.ts',
    operation: 'read',
    classification: 'explicit-one-way-legacy-input',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // LaneTransitionEvent — operator-local telemetry
  // -----------------------------------------------------------------------
  {
    id: 'lane-event-sqlite-write',
    concept: 'LaneTransitionEvent',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/board-lane-event-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'lane-event-sqlite-read',
    concept: 'LaneTransitionEvent',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/board-lane-event-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'lane-event-recorder',
    concept: 'LaneTransitionEvent',
    pathType: 'default',
    fileLocation: 'src/application/recording/board-event-recorder.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // AgentBlock — operator-local durable choice
  // -----------------------------------------------------------------------
  {
    id: 'agent-block-file-read',
    concept: 'AgentBlock',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/agent-config.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: 'TASK-2322.03',
  },
  {
    id: 'agent-block-file-write',
    concept: 'AgentBlock',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/agent-config.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: 'TASK-2322.03',
  },
  {
    id: 'agent-block-sqlite-read',
    concept: 'AgentBlock',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/blocklist-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'agent-block-sqlite-write',
    concept: 'AgentBlock',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/blocklist-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // UI Preferences — operator-local settings
  // -----------------------------------------------------------------------
  {
    id: 'ui-prefs-sqlite-read',
    concept: 'UIPreferences',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/ui-preferences-repository.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'ui-prefs-sqlite-write',
    concept: 'UIPreferences',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/ui-preferences-repository.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // Task Intake — external fact / one-way legacy input
  // -----------------------------------------------------------------------
  {
    id: 'task-intake-read-file-io',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-file-io.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-write-file-io',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-file-io.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-read-metadata',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-metadata.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-write-metadata',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-metadata.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-read-transitions',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-transitions.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-write-transitions',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/task-transitions.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-write-draft',
    concept: 'TaskIntake',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/cli/commands/draft-setup.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: 'TASK-2322.02',
  },
  {
    id: 'task-intake-read-draft-prompts',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/draft-prompts.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-read-mission-adapter',
    concept: 'TaskIntake',
    pathType: 'default',
    fileLocation: 'src/adapters/backlog/concrete-mission-read-adapter.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'task-intake-write-handoff',
    concept: 'TaskIntake',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/cli/commands/handoff.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: 'TASK-2322.02',
  },
  // -----------------------------------------------------------------------
  // Git Observations — external fact (Git/OS authority)
  // -----------------------------------------------------------------------
  {
    id: 'git-obs-read-git-core',
    concept: 'GitObservations',
    pathType: 'default',
    fileLocation: 'src/adapters/git/git.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: null,
  },
  {
    id: 'git-obs-read-git-adapter',
    concept: 'GitObservations',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/backlog/concrete-git-read-adapter.ts',
    operation: 'read',
    classification: 'external-fact-or-intake',
    cutoverTask: 'TASK-2322.02',
  },
  {
    id: 'git-obs-write-handoff',
    concept: 'GitObservations',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/cli/commands/handoff.ts',
    operation: 'write',
    classification: 'external-fact-or-intake',
    cutoverTask: 'TASK-2322.02',
  },
  // -----------------------------------------------------------------------
  // Configuration — operator-authored policy
  // -----------------------------------------------------------------------
  {
    id: 'config-read-product-config',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/config/product-config.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-read-agents-json',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/agent-config.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-read-first-run-bundled',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/first-run-config.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-write-first-run',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/agents/first-run-config.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-write-setup-review',
    concept: 'Configuration',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/review/setup-review.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: 'TASK-2322.02',
  },
  {
    id: 'config-write-setup-review-config',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/review/setup-review-config.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-read-setup-review-config',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/review/setup-review-config.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-read-ui-command',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/interfaces/tui/ui-command.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-read-agent-config-resolver',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/interfaces/tui/agent-config-resolver.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-gitignore-read',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/filesystem/gitignore.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'config-gitignore-write',
    concept: 'Configuration',
    pathType: 'default',
    fileLocation: 'src/adapters/filesystem/gitignore.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // Secrets — credentials / tokens
  // -----------------------------------------------------------------------
  {
    id: 'secrets-forgejo-token',
    concept: 'Secrets',
    pathType: 'default',
    fileLocation: 'src/adapters/review/setup-review.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'secrets-write-setup-review-auth',
    concept: 'Secrets',
    pathType: 'default',
    fileLocation: 'src/adapters/review/setup-review-auth.ts',
    operation: 'write',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  {
    id: 'secrets-forgejo-home',
    concept: 'Secrets',
    pathType: 'default',
    fileLocation: 'src/adapters/forgejo/forgejo-auth.ts',
    operation: 'read',
    classification: 'configuration-or-secret',
    cutoverTask: null,
  },
  // -----------------------------------------------------------------------
  // Large Artifacts — reference-only in database
  // -----------------------------------------------------------------------
  {
    id: 'artifacts-review-verdicts',
    concept: 'LargeArtifacts',
    pathType: 'default',
    fileLocation: 'src/adapters/review/review-events.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  {
    id: 'artifacts-review-reading',
    concept: 'LargeArtifacts',
    pathType: 'default',
    fileLocation: 'src/adapters/review/review-artifacts.ts',
    operation: 'read',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  {
    // `px stats --output <file>` writes a rendered REPORT, not persistence.
    id: 'artifacts-stats-output',
    concept: 'LargeArtifacts',
    pathType: 'default',
    fileLocation: 'src/adapters/cli/commands/stats.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  {
    id: 'artifacts-handoff-nel',
    concept: 'LargeArtifacts',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/cli/commands/handoff.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: 'TASK-2322.02',
  },
  {
    id: 'artifacts-asset-store-read',
    concept: 'LargeArtifacts',
    pathType: 'default',
    fileLocation: 'src/adapters/assets/asset-store.ts',
    operation: 'read',
    classification: 'generated-artifact',
    cutoverTask: null,
  },
  {
    id: 'artifacts-coverage-gate-write',
    concept: 'LargeArtifacts',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/verification/coverage-gate.ts',
    operation: 'write',
    classification: 'generated-artifact',
    cutoverTask: 'TASK-2322.02',
  },
  {
    id: 'artifacts-sqlite-importer-read',
    concept: 'LargeArtifacts',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/importer.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'artifacts-sqlite-migration-read',
    concept: 'LargeArtifacts',
    pathType: 'compatibility',
    fileLocation: 'src/adapters/sqlite/migration-runner.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: null,
  },
  {
    id: 'adhoc-counter-read',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/adhoc-counter.ts',
    operation: 'read',
    classification: 'database-owned-domain-state',
    cutoverTask: 'task-2468',
  },
  {
    id: 'adhoc-counter-write',
    concept: 'Mission',
    pathType: 'default',
    fileLocation: 'src/adapters/sqlite/adhoc-counter.ts',
    operation: 'write',
    classification: 'database-owned-domain-state',
    cutoverTask: 'task-2468',
  },
] as const;

// ---------------------------------------------------------------------------
// ADR 0053 cutover guardrails (task-2521.01)
//
// Two allowlists back the executable anti-regression guards in
// test/retired-workflow-path-write-guard.test.ts (guard 1) and
// test/mission-persistence-authority-guard.test.ts (guard 2). Each entry names
// a call site that legitimately touches a retired workflow path so the guards
// consult this inventory instead of a hand-maintained pattern list. Any new
// normal-runtime write to a retired workflow path, or any new application/
// interface code that resolves or persists through missions/** or repo Backlog
// task files as Mission persistence, must be registered here or the guard fails.
// ---------------------------------------------------------------------------

/** Classification for a legitimate writer of a retired workflow path. */
export type RetiredWorkflowPathWriterClass =
  | 'external-task-provider'
  | 'mission-contract-document'
  | 'explicit-one-way-export'
  | 'product-configuration-file'
  | 'mission-document-evidence'
  | 'closeout-representation'
  | 'operator-local-observation';

/** One legitimate production writer of a retired workflow-metadata path. */
export interface RetiredWorkflowPathWriterEntry {
  /** Stable identifier for this writer. */
  readonly id: string;
  /** File location of the writer (relative to repo root). */
  readonly fileLocation: string;
  /** Retired workflow-path pattern(s) this writer targets. */
  readonly pathPatterns: readonly string[];
  /** Why this write is permitted under the landed ADRs. */
  readonly classification: RetiredWorkflowPathWriterClass;
  /** The ADR authority that permits this write. */
  readonly authority: string;
}

/**
 * Every production writer that still targets a retired workflow path after the
 * ADR 0053 cutover. ADR 0053 permits operator-invoked legacy input, one-way
 * generated exports, rebuildable projections, and mission-contract scaffolding;
 * it forbids a normal-runtime writer of Mission lifecycle state to any of these
 * paths. Each entry below is one of those permitted categories, so guard 1
 * (retired-workflow-path-write-guard) never false-positives on them.
 */
export const RETIRED_WORKFLOW_PATH_WRITERS: readonly RetiredWorkflowPathWriterEntry[] = [
  {
    id: 'retired-writer-backlog-transitions',
    fileLocation: 'src/adapters/backlog/task-transitions.ts',
    pathPatterns: ['taskFilePath'],
    classification: 'external-task-provider',
    authority: 'ADR 0037 — Backlog material is an external task source; task-file writes are catalog maintenance, not Mission persistence.',
  },
  {
    id: 'retired-writer-backlog-task-file-io',
    fileLocation: 'src/adapters/backlog/task-file-io.ts',
    pathPatterns: ['backlog/(?:tasks|completed|archive)/'],
    classification: 'external-task-provider',
    authority: 'ADR 0037 — removal of duplicate Backlog catalog entries maintains the external task source, not Mission persistence.',
  },
  {
    id: 'retired-writer-backlog-task-metadata',
    fileLocation: 'src/adapters/backlog/task-metadata.ts',
    pathPatterns: ['taskFilePath'],
    classification: 'external-task-provider',
    authority: 'ADR 0037 — task assignment and labels are Backlog catalog metadata, not Mission persistence.',
  },
  {
    id: 'retired-writer-draft-setup-mission',
    fileLocation: 'src/adapters/cli/commands/draft-setup.ts',
    // Scaffolds the operator-named MISSION.md contract: creates the mission
    // directory (mkdirSync(missionDir)) then writes the contract. Both are
    // mission-contract scaffolding, not operational persistence.
    pathPatterns: ['MISSION.md', 'missionDir'],
    classification: 'mission-contract-document',
    authority: 'ADR 0053 — px draft scaffolds the operator-named MISSION.md contract; a user-facing artifact, not operational persistence.',
  },
  {
    id: 'retired-writer-integrate-conflict',
    fileLocation: 'src/adapters/cli/commands/integrate-conflict.ts',
    pathPatterns: ['taskFilePath'],
    classification: 'external-task-provider',
    authority: 'ADR 0037 — integrate rewrites the external Backlog catalog under backlog/{tasks,completed}; intake/closeout, not Mission state.',
  },
  {
    id: 'retired-writer-review-events',
    fileLocation: 'src/adapters/review/review-events.ts',
    pathPatterns: ['missions/<slug>/review-events/'],
    classification: 'explicit-one-way-export',
    authority: 'ADR 0053 transaction rule 4 — rendered review-event Markdown is a rebuildable one-way export of stored rows.',
  },
  {
    id: 'retired-writer-setup-review-config',
    fileLocation: 'src/adapters/review/setup-review-config.ts',
    pathPatterns: ['workflow.config.json'],
    classification: 'product-configuration-file',
    authority: 'ADR 0051/configuration — workflow.config.json is operator configuration; the backlog/ layout string is documentation, not persistence.',
  },
  {
    id: 'retired-writer-redgreen',
    fileLocation: 'src/adapters/verification/redgreen.ts',
    pathPatterns: ['MISSION.md'],
    classification: 'mission-document-evidence',
    authority: 'ADR 0053 — red-green reads MISSION.md as reproduction-test evidence, not as Mission state authority.',
  },
  {
    id: 'retired-writer-handoff-checkpoint',
    fileLocation: 'src/application/handoff-command-use-case.ts',
    pathPatterns: ['CP-1.md', 'MISSION.md', 'backlog/tasks/'],
    classification: 'closeout-representation',
    authority: 'ADR 0053 transaction rule 4 + ADR 0037 — auto checkpoint and the backlog task fallback summary are closeout representation and external-task closeout.',
  },
  {
    id: 'retired-writer-handoff-command-adapter',
    fileLocation: 'src/adapters/cli/commands/handoff.ts',
    pathPatterns: ['findMissionDir', 'writeText\\('],
    classification: 'closeout-representation',
    authority: 'ADR 0053 transaction rule 4 — this adapter binds the handoff closeout writer; it does not own Mission state.',
  },
  {
    id: 'retired-writer-verification-gate-result',
    fileLocation: 'src/adapters/verification/verification.ts',
    pathPatterns: ['GATE_RESULT_RELATIVE_PATH', 'writeJson\\('],
    classification: 'operator-local-observation',
    authority: 'ADR 0048 — .workflow/gate-result.json is ignored operator-local verification observation, not committed Mission persistence.',
  },
] as const;

/** Classification for a legitimate application/interface mission-document call site. */
export type MissionDocumentCallSiteClass =
  | 'port-declaration'
  | 'external-task-intake'
  | 'mission-document-evidence'
  | 'git-topology-observation';

/** One legitimate application/interface call site that resolves mission documents. */
export interface MissionDocumentCallSiteEntry {
  /** Stable identifier for this call site. */
  readonly id: string;
  /** File location of the call site (relative to repo root). */
  readonly fileLocation: string;
  /** What this call site does with the mission document / task file. */
  readonly purpose: string;
  /**
   * Mission-document / Backlog-task path patterns that legitimately appear in
   * this call site's own source. Guard 2 exempts a flagged line only when it
   * matches one of this entry's patterns, so a new reference outside them is a
   * regression. Enumerated from the call site's real lines; broad resolver
   * helpers (findMissionDir, missionDirForSlug, missionPathForSlug) are included
   * because they are used for legitimate reads here — a rogue write through one
   * of them is a guard-1 concern and is caught by guard 1's call-site patterns.
   */
  readonly pathPatterns: readonly string[];
  /** Why this reference is permitted and is not Mission persistence. */
  readonly classification: MissionDocumentCallSiteClass;
}

/**
 * Every application/interface call site that resolves or references missions/**,
 * MISSION.md, or repo Backlog task files in real (non-comment) code. Each is one
 * of: a port declaration, an external task intake, a mission-document evidence
 * read, or a Git-topology observation. None treats these files as Mission
 * persistence authority (that authority is the operator database, ADR 0053), so
 * guard 2 (mission-persistence-authority-guard) never false-positives on them.
 * A new application/interface file that resolves or persists through these paths
 * as Mission persistence must be registered here or guard 2 fails.
 */
export const MISSION_DOCUMENT_CALL_SITES: readonly MissionDocumentCallSiteEntry[] = [
  {
    id: 'mission-doc-call-handoff',
    fileLocation: 'src/application/handoff-command-use-case.ts',
    purpose: 'verify MISSION.md exists and read Refinement Signals / Gates as the mission contract evidence before handoff',
    pathPatterns: ['MISSION.md', 'findMissionDir', 'backlog/tasks'],
    classification: 'mission-document-evidence',
  },
  {
    id: 'mission-doc-call-integrate-preflight',
    fileLocation: 'src/application/integrate/preflight.ts',
    purpose: 'report the resolved mission document path during integrate preflight',
    pathPatterns: ['MISSION.md', 'missionDirForSlug'],
    classification: 'mission-document-evidence',
  },
  {
    id: 'mission-doc-call-integrate-preflight-checkout',
    fileLocation: 'src/application/integrate/preflight-checkout.ts',
    purpose: 'compute Git overlap paths (missions/<slug>, backlog/completed) for worktree checkout',
    pathPatterns: ['backlog/completed', 'missions/'],
    classification: 'git-topology-observation',
  },
  {
    id: 'mission-doc-call-integrate-context',
    fileLocation: 'src/application/integrate/context.ts',
    purpose: 'locate the mission document for area selection and read Backlog task metadata as external intake',
    pathPatterns: ['findMissionDir'],
    classification: 'external-task-intake',
  },
  {
    id: 'mission-doc-call-handoff-port',
    fileLocation: 'src/application/ports/handoff-workflow.ts',
    purpose: 'declare the injected mission-directory resolver port',
    pathPatterns: ['findMissionDir'],
    classification: 'port-declaration',
  },
  {
    id: 'mission-doc-call-integrate-port',
    fileLocation: 'src/application/ports/integrate-workflow.ts',
    purpose: 'declare injected mission path resolver ports',
    pathPatterns: ['findMissionDir', 'missionDirForSlug'],
    classification: 'port-declaration',
  },
  {
    id: 'mission-doc-call-rebase-port',
    fileLocation: 'src/application/ports/rebase-workflow.ts',
    purpose: 'declare the injected mission-directory resolver port',
    pathPatterns: ['findMissionDir'],
    classification: 'port-declaration',
  },
  {
    id: 'mission-doc-call-rebase-workflow',
    fileLocation: 'src/application/rebase-workflow.ts',
    purpose: 'locate the mission directory to derive the verification area and Git conflict scope',
    pathPatterns: ['findMissionDir'],
    classification: 'git-topology-observation',
  },
] as const;

/**
 * Bounded persistence inventory for TASK-2222; every row has exactly one class.
 *
 * This inventory uses a different taxonomy (MachineWrittenPathClass) than the
 * ADR 0053 inventory above. Both describe overlapping boundaries. The ADR 0053
 * inventory (ADR0053_PERSISTENCE_INVENTORY) is the authoritative source for the
 * six-class ADR 0053 classification; this MACHINE_WRITTEN_PATH_INVENTORY remains
 * the TASK-2222 migration plan. Cross-references for shared boundaries:
 * - `session-metadata` ↔ `session-read-sessions` / `session-write-sessions`
 * - `nel-record` ↔ `artifacts-handoff-nel`
 * - `review-state` ↔ retired by the TASK-2322.12 cutover (Review aggregate)
 * - `agent-blocklist` ↔ `agent-block-file-read` / `agent-block-file-write`
 * - `forgejo-token` ↔ `secrets-forgejo-token`
 * - `workflow-config` ↔ `config-write-setup-review`
 * - `backlog-task` ↔ `task-intake-read-backlog`
 */
export const MACHINE_WRITTEN_PATH_INVENTORY: readonly MachineWrittenPathInventoryEntry[] = [
  {
    id: 'session-metadata',
    pathPattern: '<PARALLIX_HOME>/parallix.db:session_markers',
    writer: 'src/adapters/sqlite/session-marker-repository.ts#save',
    classification: 'durable-state',
    persistencePolicy: 'SQLite-backed application port is authoritative; legacy worktree files are explicit one-way import input only.',
  },
  {
    id: 'nel-record',
    pathPattern: 'missions/<slug>/nel-record.json',
    writer: 'lib/commands/handoff.ts#captureNelAtHandoff',
    classification: 'durable-state',
    persistencePolicy: 'Migrate to writeJson; handoff must report persistence failure.',
  },
  {
    id: 'review-state',
    pathPattern: 'missions/<slug>/review-state.json',
    writer: 'lib/review/review-state.ts#ReviewState.save',
    classification: 'durable-state',
    persistencePolicy: 'TASK-2220 exception: writeFileAtomic plus Git checkpoint outcome; do not migrate here.',
  },
  {
    id: 'agent-blocklist',
    pathPattern: '<PARALLIX_HOME>/agents.local.json',
    writer: 'lib/agents/agent-config.ts#updateAgentBlock',
    classification: 'durable-state',
    persistencePolicy: 'Already uses writeJson; outside the bounded caller tranche.',
  },
  {
    id: 'backlog-task',
    pathPattern: 'backlog/tasks/<task>.md',
    writer: 'lib/tools/backlog.ts',
    classification: 'user-authored-content',
    persistencePolicy: 'Document workflow; direct text edits remain outside the JSON API.',
  },
  {
    id: 'coverage-manifest',
    pathPattern: '<tmp>/parallix-temp-root-manifests/<pid>.json',
    writer: 'lib/commands/coverage-gate.ts#flushCoverageManifest',
    classification: 'cache-scratch-data',
    persistencePolicy: 'PID-scoped scratch manifest for SIGKILL orphan recovery; documented direct-write exception.',
  },
  {
    id: 'forgejo-token',
    pathPattern: '<FORGEJO_HOME>/tokens/<user>',
    writer: 'lib/tools/setup-review.ts#writeToken',
    classification: 'secrets-configuration',
    persistencePolicy: 'Remain on the dedicated 0o600 writer; mode guarantees must not weaken.',
  },
  {
    id: 'workflow-config',
    pathPattern: 'workflow.config.json',
    writer: 'lib/tools/setup-review.ts#writeWorkflowConfig',
    classification: 'secrets-configuration',
    persistencePolicy: 'Operator-local configuration; documented direct-write exception outside this tranche.',
  },
  {
    id: 'qwen-settings',
    pathPattern: '<QWEN_HOME>/settings.json',
    writer: 'src/adapters/agents/qwen.ts#qwenSettingsPath',
    classification: 'cache-scratch-data',
    persistencePolicy: 'Agent-local settings file; documented direct-write exception.',
  },
] as const;
