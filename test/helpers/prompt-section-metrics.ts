export interface PromptSections {
  contract: string;
  diff: string;
  priorRoundHistory: string;
  incidentOrRecoveryDossier: string;
  verificationOutput: string;
  framing: string;
}

/** Measure delivered UTF-8 bytes, including references and section framing. */
export function promptSectionBytes(sections: PromptSections): Record<keyof PromptSections | 'total', number> {
  const bytes = Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Buffer.byteLength(value)])) as Record<keyof PromptSections, number>;
  return { ...bytes, total: Object.values(bytes).reduce((sum, value) => sum + value, 0) };
}
