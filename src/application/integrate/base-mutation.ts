import type { IntegrateProcessPort } from '../ports/integrate-workflow.js';

/** Only landing owns the base checkout; agent preparation and gates do not. */
export async function withBaseMutation<T>(process: IntegrateProcessPort, base: string, branch: string, work: () => Promise<T>): Promise<T> {
  if (!process.claimBaseMutation) { return work(); }
  const release = await process.claimBaseMutation(base, branch);
  if (!release) { throw new Error('Another integration is mutating this base checkout; retry after it settles'); }
  try { return await work(); } finally { await release(); }
}
