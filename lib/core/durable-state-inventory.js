"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MACHINE_WRITTEN_PATH_INVENTORY = void 0;
/** Bounded persistence inventory for TASK-2222; every row has exactly one class. */
exports.MACHINE_WRITTEN_PATH_INVENTORY = [
    {
        id: 'session-metadata',
        pathPattern: '.workflow/sessions/<slug>-<role>.json',
        writer: 'lib/tools/sessions.ts#writeSession',
        classification: 'durable-state',
        persistencePolicy: 'Migrate to writeJson; a valid marker controls resume behavior after restart.',
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
        id: 'mutation-baseline',
        pathPattern: 'config/mutation-baseline.json',
        writer: 'lib/commands/mutation-gate.ts#saveBaseline',
        classification: 'generated-output',
        persistencePolicy: 'Generated ratchet output; documented direct-write exception, not migrated.',
    },
    {
        id: 'mutation-run-config',
        pathPattern: '<tmp>/mutation-gate-*/stryker.conf.json',
        writer: 'lib/commands/mutation-gate.ts#run',
        classification: 'cache-scratch-data',
        persistencePolicy: 'Ephemeral generated mutation configuration; documented direct-write exception.',
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
];
