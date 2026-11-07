import * as fmt from '../../application/presentation/cli-format.js';
import { missionVersion } from '../../application/domain-ports.js';
import type { MissionBriefService } from '../../application/mission-brief-service.js';
import { missionId } from '../../domain/mission.js';
import type { DefectAttribution } from '../../domain/defect-provenance.js';
import type { DefectProvenanceBackfillService } from '../../application/defect-provenance-backfill-service.js';
import type { DefectProvenanceBackfillEntry } from '../../application/ports/defect-provenance-backfill.js';

export const PROVENANCE_HELP = `
Usage: px provenance set [--slug <slug>] --root-cause <text> --evidence <text>
  (--originating-mission <slug> | --external | --pre-mission | --unresolved)
       px provenance backfill <preview|apply> --input <json-file> [--replace]

Record or replace a bug Mission's causal investigation. Choose exactly one
attribution disposition. An originating Mission must exist in the same
repository; use a non-Mission disposition when retained evidence supports it.
`.trimStart();

interface ProvenanceWriteServices {
  readonly brief: Pick<MissionBriefService, 'setDefectProvenance'>;
  readonly defectProvenanceBackfill: Pick<DefectProvenanceBackfillService, 'preview' | 'apply'>;
  readonly readBackfillEntries: (_file: string) => readonly DefectProvenanceBackfillEntry[];
  readonly resolveSlug: (_explicit?: string) => string | null;
}

function flag(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

function required(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === null || value.startsWith('--')) { throw new Error(`${name} <value> is required`); }
  return value;
}

function attribution(args: readonly string[]): DefectAttribution {
  const choices: DefectAttribution[] = [];
  if (args.includes('--originating-mission')) {
    choices.push({ kind: 'originating-mission', missionId: missionId(required(args, '--originating-mission')) });
  }
  if (args.includes('--external')) { choices.push({ kind: 'external' }); }
  if (args.includes('--pre-mission')) { choices.push({ kind: 'pre-mission' }); }
  if (args.includes('--unresolved')) { choices.push({ kind: 'unresolved' }); }
  if (choices.length !== 1) {
    throw new Error('choose exactly one of --originating-mission, --external, --pre-mission, or --unresolved');
  }
  return choices[0]!;
}

/** Public `px provenance set` write. */
export function createDefectProvenanceCommand(services: ProvenanceWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (args.includes('--help') || args.includes('-h')) { fmt.log.plain(PROVENANCE_HELP); return; }
    if (args[0] === 'backfill') { await runBackfill(services, args); return; }
    await runSet(services, args);
  };
}

async function runBackfill(services: ProvenanceWriteServices, args: readonly string[]): Promise<void> {
  const action = args[1];
  if (action !== 'preview' && action !== 'apply') { throw new Error(PROVENANCE_HELP); }
  const entries = services.readBackfillEntries(required(args, '--input'));
  const report = await services.defectProvenanceBackfill[action](entries, args.includes('--replace'));
  fmt.log.plain(JSON.stringify(report, null, 2));
}

async function runSet(services: ProvenanceWriteServices, args: readonly string[]): Promise<void> {
  if (args[0] !== 'set') { throw new Error(PROVENANCE_HELP); }
  const slug = services.resolveSlug(flag(args, '--slug') ?? undefined);
  if (!slug) { throw new Error('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
  const expectedVersion = args.includes('--expected-version')
    ? missionVersion(Number(required(args, '--expected-version')))
    : undefined;
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw new Error('--expected-version must be a positive integer');
  }
  const outcome = await services.brief.setDefectProvenance({
    operationId: `px-provenance-set-${slug}`, missionId: missionId(slug), expectedVersion,
    capabilities: new Set(['mission:context']),
    provenance: { rootCauseSummary: required(args, '--root-cause'),
      investigationEvidence: required(args, '--evidence'), attribution: attribution(args) },
  });
  if (outcome.status !== 'completed') { throw new Error(outcome.error?.message ?? 'provenance set failed'); }
  fmt.log.plain(JSON.stringify(outcome.value, null, 2));
}
