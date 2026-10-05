/**
 * Bind the production filesystem for the recovery store in every test process.
 *
 * The application layer cannot import `node:fs` (ADR 0051); the test runtime
 * can, so this preload binds the `filesystem` adapter as the default for the
 * capture/lookup/list functions exercised through the free entry points
 * (TASK-2642 boundary decision). Imported by the bootstrap preloads rather
 * than passed as its own `--import`, so a checkout that supplies only the
 * bootstrap still gets the binding. Idempotent, so the integration tier (which
 * also binds via composition) is unaffected.
 */

import { setRecoveryEvidenceFileSystem } from '../../src/application/recovery-evidence.js';
import { recoveryEvidenceFileSystem } from '../../src/adapters/filesystem/recovery-evidence-fs.js';

setRecoveryEvidenceFileSystem(recoveryEvidenceFileSystem);
