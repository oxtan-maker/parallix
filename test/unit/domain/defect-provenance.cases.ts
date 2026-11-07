import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  defectProvenance,
  DefectProvenanceViolation,
  type DefectProvenance,
} from '../../../src/domain/defect-provenance.js';
import { missionId } from '../../../src/domain/mission.js';

export function defectProvenanceCases(): void {
  describe('Defect provenance value', () => {
    test('accepts each exclusive attribution disposition and normalizes required evidence', () => {
      const dispositions: DefectProvenance['attribution'][] = [
        { kind: 'originating-mission', missionId: missionId('px-0001') },
        { kind: 'external' },
        { kind: 'pre-mission' },
        { kind: 'unresolved' },
      ];
      for (const attribution of dispositions) {
        assert.deepEqual(defectProvenance({
          rootCauseSummary: '  Incorrect retry ownership  ',
          investigationEvidence: '  Reproduction and git diff identify the boundary  ',
          attribution,
        }, missionId('px-0002')), {
          rootCauseSummary: 'Incorrect retry ownership',
          investigationEvidence: 'Reproduction and git diff identify the boundary',
          attribution,
        });
      }
    });

    test('rejects incomplete, mixed, self-attributed, and unknown provenance', () => {
      const valid = { rootCauseSummary: 'Cause', investigationEvidence: 'Evidence', attribution: { kind: 'unresolved' as const } };
      const invalid: unknown[] = [
        { ...valid, rootCauseSummary: ' ' },
        { ...valid, investigationEvidence: '' },
        { ...valid, attribution: null },
        { ...valid, attribution: { kind: 'external', missionId: missionId('px-0001') } },
        { ...valid, attribution: { kind: 'invented' } },
        { ...valid, attribution: { kind: 'originating-mission', missionId: missionId('px-0002') } },
      ];
      for (const value of invalid) {
        assert.throws(
          () => defectProvenance(value as DefectProvenance, missionId('px-0002')),
          DefectProvenanceViolation,
        );
      }
    });
  });
}
