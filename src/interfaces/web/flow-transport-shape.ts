import type { FlowGraph, FlowGraphEdge, FlowGraphNode, FlowVerificationSummary } from '../../application/projections/flow-graph.js';
import { REBASE_OBSERVATION_STAGES } from '../../application/ports/rebase-workflow.js';
import { checkEnum, checkFiniteNumber, checkKeys, checkNullableFiniteNumber, checkNullableString,
  checkString, checkStringArray, isPlainObject } from './transport-validation-primitives.js';

const FLOW_LANES = ['refine-agent', 'implement-agent', 'parallix', 'review-agent', 'lead', 'human', 'external', 'main'];
const FLOW_NODES = ['refine', 'implement', 'rebase', 'rebase-resolve', 'declared-gates', 'integration-tests',
  'agent-review', 'human-review', 'automated-join', 'human-verdict', 'landed', 'lead'];
const FLOW_EDGE_KINDS = ['flow', 'clean', 'gate-failed', 'agent-findings', 'human-changes', 'rebase-conflict',
  'rebase-repeat', 'rebase-failed', 'workflow-return', 'lead-escalation', 'concurrent-request', 'automated-verdict',
  'automated-pass', 'gate-repair', 'agent-repair', 'joint-repair', 'human-ready', 'human-wait', 'human-pending',
  'human-withdrawn', 'timing-unavailable', 'tests-passed', 'landing-rebase', 'operator-land'];

type KeyInventory<T> = { readonly [K in keyof T]-?: unknown };
function checkKeysOf<T>(object: Record<string, unknown>, path: string, problems: string[], inventory: KeyInventory<T>): void {
  const keys = Object.keys(inventory);
  checkKeys(object, keys, keys, path, problems);
}

function checkObjects(value: unknown, path: string, problems: string[],
  check: (item: Record<string, unknown>, itemPath: string) => void): void {
  if (!Array.isArray(value)) { problems.push(`${path} must be an array`); return; }
  value.forEach((item, index) => {
    if (!isPlainObject(item)) { problems.push(`${path}[${index}] must be an object`); }
    else { check(item, `${path}[${index}]`); }
  });
}

function checkCountRecord(value: unknown, keys: readonly string[], path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeys(value, keys, keys, path, problems);
  for (const key of keys) { checkFiniteNumber(value, key, path, problems); }
}

function checkFlowVerification(value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeysOf<FlowVerificationSummary>(value, path, problems, { configured: null, executions: null, observedRounds: null,
    concurrentRounds: null, joinedRounds: null, pilotApprovedMissions: null, human: null, repairs: null, exceptions: null,
    sameRevisionTestReruns: null, population: null });
  for (const key of ['observedRounds', 'concurrentRounds', 'joinedRounds', 'pilotApprovedMissions', 'sameRevisionTestReruns', 'population']) {
    checkFiniteNumber(value, key, path, problems);
  }
  checkCountRecord(value.executions, ['pilot', 'fallback', 'shadow', 'unobserved', 'historical'], `${path}.executions`, problems);
  checkCountRecord(value.human, ['ready', 'later', 'pending', 'withdrawn', 'timing-unavailable'], `${path}.human`, problems);
  checkCountRecord(value.repairs, ['gate', 'agent', 'joint'], `${path}.repairs`, problems);
  checkCountRecord(value.exceptions, ['interrupted', 'revisionDrift', 'handoff', 'humanCorrection'], `${path}.exceptions`, problems);
  if (value.configured === null) { return; }
  if (!isPlainObject(value.configured)) { problems.push(`${path}.configured must be an object or null`); return; }
  checkKeys(value.configured, ['kind', 'artifactSha256', 'roundPlan', 'fallbackReason'],
    ['kind', 'artifactSha256', 'roundPlan', 'fallbackReason'], `${path}.configured`, problems);
  checkEnum(value.configured, 'kind', ['artifact', 'fixed'], `${path}.configured`, problems);
  checkNullableString(value.configured, 'artifactSha256', `${path}.configured`, problems);
  checkNullableString(value.configured, 'fallbackReason', `${path}.configured`, problems);
  if (value.configured.kind === 'artifact'
    && (typeof value.configured.artifactSha256 !== 'string' || value.configured.fallbackReason !== null)) {
    problems.push(`${path}.configured artifact must carry an identity and no fallback reason`);
  }
  if (value.configured.kind === 'fixed'
    && (value.configured.artifactSha256 !== null || value.configured.roundPlan !== null
      || !['missing', 'invalid', 'unreadable', 'hash-mismatch', 'unavailable'].includes(String(value.configured.fallbackReason)))) {
    problems.push(`${path}.configured fixed fallback must carry only its recognized reason`);
  }
  if (value.configured.roundPlan === null) { return; }
  if (!isPlainObject(value.configured.roundPlan)) { problems.push(`${path}.configured.roundPlan must be an object or null`); return; }
  const plan = value.configured.roundPlan;
  checkKeys(plan, ['rule', 'repairMode', 'stages'], ['rule', 'repairMode', 'stages'], `${path}.configured.roundPlan`, problems);
  checkEnum(plan, 'rule', ['all-then-last'], `${path}.configured.roundPlan`, problems);
  checkEnum(plan, 'repairMode', ['joint'], `${path}.configured.roundPlan`, problems);
  checkObjects(plan.stages, `${path}.configured.roundPlan.stages`, problems, (stage, stagePath) => {
    checkKeys(stage, ['request', 'waitFor', 'repair', 'withdrawOnFailure'], ['request', 'waitFor', 'repair', 'withdrawOnFailure'], stagePath, problems);
    for (const key of ['request', 'waitFor', 'repair', 'withdrawOnFailure']) {
      checkStringArray(stage, key, stagePath, problems);
      if (Array.isArray(stage[key]) && stage[key].some(action => !['tests', 'agent', 'human'].includes(action))) {
        problems.push(`${stagePath}.${key} must contain only verification actions`);
      }
    }
  });
}

export function checkFlowGraph(value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeysOf<FlowGraph>(value, path, problems, { nodes: null, edges: null, verification: null });
  checkObjects(value.nodes, `${path}.nodes`, problems, (node, nodePath) => {
    checkKeysOf<FlowGraphNode>(node, nodePath, problems, { id: null, lane: null, count: null, parts: null,
      rework: null, observedMissions: null, population: null });
    checkEnum(node, 'id', FLOW_NODES, nodePath, problems); checkEnum(node, 'lane', FLOW_LANES, nodePath, problems);
    for (const key of ['count', 'observedMissions', 'population']) { checkFiniteNumber(node, key, nodePath, problems); }
    checkNullableFiniteNumber(node, 'rework', nodePath, problems);
    checkObjects(node.parts, `${nodePath}.parts`, problems, (part, partPath) => {
      checkKeysOf<FlowGraphNode['parts'][number]>(part, partPath, problems, { label: null, count: null });
      checkString(part, 'label', partPath, problems);
      checkFiniteNumber(part, 'count', partPath, problems);
    });
  });
  checkObjects(value.edges, `${path}.edges`, problems, (edge, edgePath) => {
    checkKeysOf<FlowGraphEdge>(edge, edgePath, problems, { id: null, from: null, to: null, kind: null, stage: null,
      count: null, share: null, percentage: null, observedMissions: null, population: null });
    checkString(edge, 'id', edgePath, problems);
    if (edge.from !== null) { checkEnum(edge, 'from', FLOW_NODES, edgePath, problems); }
    checkEnum(edge, 'to', FLOW_NODES, edgePath, problems); checkEnum(edge, 'kind', FLOW_EDGE_KINDS, edgePath, problems);
    if (edge.stage !== null) { checkEnum(edge, 'stage', REBASE_OBSERVATION_STAGES, edgePath, problems); }
    checkFiniteNumber(edge, 'count', edgePath, problems); checkNullableFiniteNumber(edge, 'share', edgePath, problems);
    checkNullableFiniteNumber(edge, 'percentage', edgePath, problems);
    checkFiniteNumber(edge, 'observedMissions', edgePath, problems); checkFiniteNumber(edge, 'population', edgePath, problems);
  });
  checkFlowVerification(value.verification, `${path}.verification`, problems);
}
