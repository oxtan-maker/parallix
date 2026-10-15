/** Policy actions for Parallix-owned boundaries; runtime safety and session identity are independent. */
export function renderPromptContextPolicy(template: string, enabled = true): string {
  return template
    .replaceAll('{{checkpointContextAction}}', enabled ? 'compact your working context: reload' : 'reload')
    .replaceAll('{{gateContextAction}}', enabled
      ? 'compact your working context before starting the next gate, checkpoint work, or handoff work. Reload'
      : 'before starting the next gate, checkpoint work, or handoff work, reload')
    .replaceAll('{{reviewContextAction}}', enabled ? 'compact the prior-round working context. Reload' : 'reload')
    .replaceAll('{{actOnReviewContextAction}}', enabled ? 'compact the implementation context and reload' : 'reload');
}
