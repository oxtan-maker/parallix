// TASK-2622.15: Stable discovery entrypoint for hermetic board projections and controls.
// Case modules retain the original regression names as provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import './board-projection-builder-cp3.cases.js';
import './board-controller.cases.js';
import './board-no-bypass.cases.js';
import './board-progress-events.cases.js';
import './board-projections.cases.js';
import './board-readers.cases.js';
import './board-refresh-scheduling.cases.js';
import './board-attention-rail-presentation.cases.js';
import './board-draft-dispatch.cases.js';
import './board-review-capability-safety.cases.js';
import './board-integration-dispatch.cases.js';
import './board-handoff-resume.cases.js';
import './board-countdown-refresh.cases.js';
import './board-review-wire-facts.cases.js';
import './board-wip-presentation.cases.js';
import './board-live-work-presentation.cases.js';
import './board-action-vocabulary.cases.js';
import './board-imported-mission-lifecycle.cases.js';
import './web-mission-summary.cases.js';

test('presentation board contract entrypoint registers its behavior cases', () => {
  assert.ok(true, 'the static case-module imports above are evaluated before this entrypoint test');
});
