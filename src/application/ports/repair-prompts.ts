/** Markdown sections owned by the shared automatic-repair prompt. */
export type RepairPromptSection = 'repair' | 'authority' | 'checkpoint' | 'report'
  | 'report-without-checkpoint' | 'repair-authority' | 'mission-outcome' | 'integration-cause'
  | 'gate' | 'hook' | 'rebase' | 'review-preparation' | 'declaration' | 'artifacts'
  | 'timeout' | 'history' | 'evidence-read' | 'reviewer-output';

export type RepairPromptReader = (_section: RepairPromptSection) => string;
let reader: RepairPromptReader | undefined;

/** Composition supplies the runtime asset boundary; application code has no filesystem access. */
export function configureRepairPrompts(value: RepairPromptReader): void { reader = value; }

export function renderRepairPrompt(section: RepairPromptSection, values: Readonly<Record<string, string | number>> = {}): string {
  if (!reader) { throw new Error('Repair prompt assets are not bound by composition'); }
  return reader(section).replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) { throw new Error(`Missing repair prompt value: ${section}.${key}`); }
    return String(values[key]);
  });
}
