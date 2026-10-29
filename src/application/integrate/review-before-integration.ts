import * as fmt from '../presentation/cli-format.js';
import { abortWith } from './support.js';
import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import type { IntegrateSeams } from './gates.js';

/** A clean human stop after immediate repair or restarted integration review. */
export class IntegrationStopsForHuman extends Error {
  constructor(readonly message: string) {
    super(message);
    this.name = 'IntegrationStopsForHuman';
  }
}

/** Immediate repair and restart use the same review entry and always stop before landing. */
export async function reviewBeforeIntegration(
  slug: string,
  checkout: string,
  landing: IntegrateWorkflowPorts['landing'],
  review: IntegrateSeams['reReviewFn'],
  approvedMessage = `Mission ${slug} was reviewed and approved; it now sits in the integration lane. Read the fresh PR and run px integrate ${slug} to land.`,
  repairedRevision?: string,
): Promise<never> {
  if (!review) {
    throw abortWith(landing, `Mission ${slug} requires review. Run px review ${slug}.`);
  }
  fmt.log.info(`Sending ${slug} back through review${repairedRevision ? ` for the repaired revision ${repairedRevision}` : ''}.`);
  let approved: boolean;
  try {
    approved = await review(slug, checkout);
  } catch (error) {
    throw abortWith(landing, `Review of ${slug} could not run: ${String(error instanceof Error ? error.message : error)}`,
      `Run px review ${slug} to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
  }
  if (!approved) {
    throw abortWith(landing, `Mission ${slug} was not approved in review. Run px review ${slug} to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
  }
  fmt.log.pass(`Mission ${slug} was re-reviewed and approved; stopping before integration.`);
  throw new IntegrationStopsForHuman(approvedMessage);
}

