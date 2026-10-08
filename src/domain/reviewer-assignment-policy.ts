import { AgentPoolExhaustedError } from './agents.js';

export function isReviewerPoolExhausted(error: unknown): boolean {
  return error instanceof AgentPoolExhaustedError && error.step === 'review';
}
