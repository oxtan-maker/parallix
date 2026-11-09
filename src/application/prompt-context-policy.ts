/** Policy actions for Parallix-owned boundaries; runtime safety and session identity are independent. */
export function renderPromptContextPolicy(template: string, enabled = true): string {
  return template
    .replaceAll('{{checkpointContextAction}}', enabled ? 'compact your working context: reload' : 'reload')
    .replaceAll('{{gateContextAction}}', enabled
      ? "compact your working context before starting the next gate, checkpoint work, or review preparation work. Reload"
      : "before starting the next gate, checkpoint work, or review preparation work, reload")
    // Every reviewer invocation is a fresh native conversation. Both policy
    // modes therefore reload authority instead of referring to prior context.
    .replaceAll('{{reviewContextAction}}', 'reload')
    .replaceAll('{{actOnReviewContextAction}}', enabled ? 'compact the implementation context and reload' : 'reload');
}
