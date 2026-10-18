import { isPlainObject, checkKeys, checkString, checkBoolean, checkStringArray, checkNullableString } from './transport-validation-primitives.js';

export function checkExecution(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['observedAt', 'complete', 'invocations', 'limitations', 'recordedOperationIds'], ['observedAt', 'complete', 'invocations', 'limitations'], path, problems);
  checkString(object, 'observedAt', path, problems);
  checkBoolean(object, 'complete', path, problems);
  checkStringArray(object, 'limitations', path, problems);
  if (object.recordedOperationIds !== undefined) { checkStringArray(object, 'recordedOperationIds', path, problems); }
  if (!Array.isArray(object.invocations)) { problems.push(`${path}.invocations must be an array`); return; }
  object.invocations.forEach((run, index) => {
    const at = `${path}.invocations[${index}]`;
    if (!isPlainObject(run)) { problems.push(`${at} must be an object`); return; }
    checkKeys(run, ['runId', 'operationId', 'family'], ['runId', 'operationId', 'family'], at, problems);
    checkString(run, 'runId', at, problems); checkNullableString(run, 'operationId', at, problems); checkString(run, 'family', at, problems);
  });
}
