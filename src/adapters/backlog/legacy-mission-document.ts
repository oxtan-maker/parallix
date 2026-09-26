import { missionBrief, type MissionBrief } from '../../domain/mission-brief.js';
import { successCriteria } from '../../domain/mission-success-criteria.js';
import { declaredGates } from '../../domain/mission-gates.js';
import type { NelBucketLabel } from '../../domain/net-engineering-lines.js';

function containsPlaceholder(value: string): boolean {
  let opening = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '>') {
      if (opening >= 0 && index > opening + 1) { return true; }
      opening = -1;
    } else if (value[index] === '<' && opening < 0) { opening = index; }
  }
  return false;
}

/** Old draft scaffolds contain no contract, even if a stock gate is listed. */
export function isLegacyMissionTemplate(content: string): boolean {
  return /^## Goal\r?\n<Goal>\r?$/m.test(content)
    || /^## Why Now\r?\n<Why Now>\r?$/m.test(content);
}

/** Parse only unambiguous, bounded current fields; the full source stays archived. */
export function parseLegacyMissionDocument(content: string): {
  brief?: MissionBrief;
  successCriteria?: readonly string[];
  declaredGates?: readonly string[];
  predictedNelBucket?: NelBucketLabel;
  reproductionTest?: string;
  checkpoints: readonly { name: string; description: string }[];
} {
  if (isLegacyMissionTemplate(content)) { return { checkpoints: [] }; }
  const sections = new Map<string, string>();
  let heading = '';
  for (const line of content.split(/\r?\n/)) {
    const match = /^## (.+)$/.exec(line);
    if (match) { heading = match[1].trim(); sections.set(heading, ''); }
    else if (heading) { sections.set(heading, `${sections.get(heading)}${line}\n`); }
  }
  const section = (name: string) => sections.get(name)?.trim() ?? '';
  const placeholder = containsPlaceholder;
  const bullets = (value: string, allowPreamble = false): string[] | null => {
    const entries: string[] = [];
    for (const line of value.split('\n')) {
      if (!line.trim() || (allowPreamble && !entries.length && line.startsWith('>'))) { continue; }
      if (line.startsWith('- ')) { entries.push(line.slice(2).trim()); continue; }
      if (/^\s{2,}\S/.test(line) && entries.length) {
        entries[entries.length - 1] += ` ${line.trim()}`;
        continue;
      }
      return null;
    }
    return entries;
  };
  const parsed: {
    brief?: MissionBrief; successCriteria?: readonly string[]; declaredGates?: readonly string[];
    predictedNelBucket?: NelBucketLabel; reproductionTest?: string;
    checkpoints: { name: string; description: string }[];
  } = { checkpoints: [] };
  const goal = section('Goal');
  const why = section('Why Now');
  const scope = section('Scope');
  const outOfScope = bullets(section('Out of Scope'));
  if (goal && why && outOfScope && !placeholder([goal, why, scope, ...outOfScope].join('\n'))) {
    try { parsed.brief = missionBrief({ goal, why, scope: scope || null, outOfScope }); } catch { /* full text remains queryable */ }
  }
  const criteria = bullets(section('Success Criteria'), true);
  if (criteria?.length && !placeholder(criteria.join('\n'))) {
    try { parsed.successCriteria = successCriteria(criteria); } catch { /* historical prose remains archived */ }
  }
  const gateLines = section('Gates').split('\n').filter(line => line.trim());
  const gates = gateLines.map(line => line.replace(/^- \[[ xX]\] /, '').trim());
  if (gateLines.length && gateLines.every(line => /^- \[[ xX]\] /.test(line)) && !placeholder(gates.join('\n'))) {
    try { parsed.declaredGates = declaredGates(gates); } catch { /* historical prose remains archived */ }
  }
  const prediction = /^- Predicted NEL bucket: (Small|Medium|Large) \(/m.exec(section('Refinement Signals'));
  if (prediction) { parsed.predictedNelBucket = prediction[1] as NelBucketLabel; }
  const reproduction = /^Reproduction-Test: ([^\s<>]+)$/m.exec(content);
  if (reproduction && !reproduction[1].includes('..')) { parsed.reproductionTest = reproduction[1]; }
  for (const line of section('Checkpoints').split('\n')) {
    const match = /^- CP[ -](\d+): (.+)$/.exec(line);
    if (match && match[2].length <= 512 && !placeholder(match[2])) {
      parsed.checkpoints.push({ name: `CP-${Number(match[1])}`, description: match[2].trim() });
    }
  }
  return parsed;
}
