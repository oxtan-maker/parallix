/**
 * Operator-environment credentials of the decision provider (classifier). Only the
 * Parallix process may hold them: general agent launches must never inherit
 * them, or the key reaches model providers and their tool shells.
 */
export const DECISION_CREDENTIAL_ENV = ['TYPESAFE_API_KEY', 'OPENROUTER_API_KEY', 'AI_GATEWAY_API_KEY'] as const;
