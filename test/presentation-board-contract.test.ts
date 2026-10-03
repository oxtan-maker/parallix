// TASK-2622.15: Stable discovery entrypoint for hermetic board projections and controls.
// Case modules retain the original regression names as provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import './adapters/board-projection-builder-cp3.cases.js';
import './board-controller.cases.js';
import './board-no-bypass.cases.js';
import './board-progress-events.cases.js';
import './board-projections.cases.js';
import './board-readers.cases.js';
import './task-2373-refresh-performance.cases.js';
import './task-2408-board-hallucinated-content-repro.cases.js';
import './task-2427-board-draft.cases.js';
import './task-2428-review-board-safety.cases.js';
import './task-2429-board-integrate.cases.js';
import './task-2436-board-handoff-resume.cases.js';
import './task-2442-repro.cases.js';
import './task-2447-repro.cases.js';
import './task-2452-repro.cases.js';
import './task-2453-repro.cases.js';
import './task-2518-board-action-vocabulary-repro.cases.js';
import './task-2521.04-imported-mission-board-path.cases.js';
import './task-2526-web-summary-repro.cases.js';

test('presentation board contract entrypoint registers its behavior cases', () => {
  assert.ok(true, 'the static case-module imports above are evaluated before this entrypoint test');
});
