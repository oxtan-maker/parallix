import { checkKeys, checkString, checkStringArray, isPlainObject } from './transport-validation-primitives.js';
import type { MissionPlanningFields } from '../../application/mission-edit-service.js';
export type WebEditMissionRequest = { readonly kind: 'mission:edit-read'; readonly missionId: string }
  | ({ readonly kind: 'mission:edit'; readonly missionId: string; readonly expectedVersion: number } & MissionPlanningFields);
export function isEditMissionBody(body: unknown): boolean {
  return isPlainObject(body) && (body.kind === 'mission:edit' || body.kind === 'mission:edit-read');
}
export function validateWebEditMissionRequest(body: unknown): { ok: true; value: WebEditMissionRequest } | { ok: false; problems: string[] } {
  if (!isPlainObject(body)) { return { ok: false, problems: ['request must be an object'] }; }
  const problems: string[] = [];
  const keys = body.kind === 'mission:edit-read' ? ['kind', 'missionId'] : ['kind', 'missionId', 'expectedVersion', 'title', 'description', 'context', 'labels', 'successCriteria', 'dependencies'];
  checkKeys(body, keys, keys, 'request', problems);
  if (!isEditMissionBody(body)) { problems.push('invalid editing kind'); }
  const id = checkString(body, 'missionId', 'request', problems);
  if (!id?.trim()) { problems.push('missionId is required'); }
  if (body.kind === 'mission:edit') {
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) { problems.push('expectedVersion must be a positive integer'); }
    for (const key of ['title', 'description', 'context']) { checkString(body, key, 'request', problems); }
    for (const key of ['labels', 'successCriteria', 'dependencies']) { checkStringArray(body, key, 'request', problems); }
  }
  return problems.length ? { ok: false, problems } : { ok: true, value: body as unknown as WebEditMissionRequest };
}
