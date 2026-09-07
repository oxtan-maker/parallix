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
