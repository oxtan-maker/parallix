import type { DecisionAvailability } from '../../application/ports/decision.js';
import type { DECISION_CREDENTIAL_ENV } from '../../domain/decision-credentials.js';
import type { DecisionConfiguration } from '../../application/ports/configuration.js';

const PROVIDERS = {
  typesafe: { key: 'TYPESAFE_API_KEY', base: 'https://api.typesafe.ai', model: 'jev-latest' },
  openrouter: { key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api', model: 'jev-latest' },
  vercel: { key: 'AI_GATEWAY_API_KEY', base: 'https://ai-gateway.vercel.sh/typesafe', model: 'typesafe-ai/jev' },
} as const satisfies Record<string, { key: typeof DECISION_CREDENTIAL_ENV[number]; base: string; model: string }>;
type Provider = keyof typeof PROVIDERS;
export interface DecisionRoute {
  readonly provider: Provider;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}
export type DecisionResolution = { readonly route: DecisionRoute; readonly availability: DecisionAvailability }
  | { readonly route?: undefined; readonly availability: DecisionAvailability };

/** Only operator configuration is an authority; never accepts repository configuration. */
export function resolveDecisionProvider(settings: DecisionConfiguration): DecisionResolution {
  const unavailable = (reason: string): DecisionResolution => ({ availability: { status: 'setup-required', reason } });
  const explicit = settings.provider;
  if (explicit && !Object.hasOwn(PROVIDERS, explicit)) {
    return unavailable('JEV_CODE_PROVIDER must select typesafe, openrouter, or vercel for this adapter.');
  }
  const base = settings.baseUrl;
  let url: URL | undefined;
  if (base) {
    try { url = new URL(base); } catch { return unavailable('TYPESAFE_BASE_URL must be an absolute HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return unavailable('TYPESAFE_BASE_URL must be HTTPS without credentials, query, or fragment.');
    }
  }
  const names = Object.keys(PROVIDERS) as Provider[];
  const urlProvider = url && names.find(name => new URL(PROVIDERS[name].base).origin === url.origin);
  if (explicit && urlProvider && explicit !== urlProvider) {
    return unavailable('JEV_CODE_PROVIDER conflicts with TYPESAFE_BASE_URL.');
  }
  const configured = names.filter(name => settings.apiKeys[PROVIDERS[name].key]);
  const target = (explicit as Provider | undefined) || urlProvider;
  if (!target && configured.length !== 1) {
    return unavailable(configured.length ? 'Multiple decision providers configured; select JEV_CODE_PROVIDER.'
      : 'Export TYPESAFE_API_KEY, OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY to enable decisions.');
  }
  const provider = target || configured[0];
  const config = PROVIDERS[provider];
  const ownKey = settings.apiKeys[config.key];
  const apiKey = ownKey || settings.apiKeys.TYPESAFE_API_KEY;
  if (!apiKey) { return unavailable('The selected decision provider has no compatible API key.'); }
  if (url && !urlProvider && ownKey && config.key !== 'TYPESAFE_API_KEY' && !explicit) {
    return unavailable('A host-specific key requires JEV_CODE_PROVIDER before following a custom proxy.');
  }
  const timeoutMs = settings.timeoutMs ? Number(settings.timeoutMs) : 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    return unavailable('JEV_CODE_TIMEOUT_MS must be an integer between 1 and 120000.');
  }
  const model = settings.model || config.model;
  return {
    route: { provider, apiKey, model, endpoint: `${(url?.href || config.base).replace(/\/+$/, '')}/v1/systemone`, timeoutMs },
    availability: { status: 'available', provider, model },
  };
}
