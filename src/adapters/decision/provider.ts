import type { DecisionAvailability } from '../../application/ports/decision.js';
import type { DECISION_CREDENTIAL_ENV } from '../../domain/decision-credentials.js';
import type { DecisionConfiguration } from '../../application/ports/configuration.js';

export const DECISION_MODEL = 'typesafe/jev-1.13-20260917';
// AI Gateway exposes only a moving alias; the returned build can differ.
const GATEWAY_MODELS = { [DECISION_MODEL]: 'typesafe-ai/jev' } as const;

const PROVIDERS = {
  typesafe: { key: 'TYPESAFE_API_KEY', base: 'https://api.typesafe.ai', model: DECISION_MODEL },
  openrouter: { key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api', model: DECISION_MODEL },
  vercel: { key: 'AI_GATEWAY_API_KEY', base: 'https://ai-gateway.vercel.sh/typesafe', model: GATEWAY_MODELS[DECISION_MODEL] },
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

const unavailable = (reason: string, cause?: 'credentials-missing'): DecisionResolution =>
  ({ availability: { status: 'setup-required', reason, ...(cause ? { cause } : {}) } });

function parseDecisionUrl(base: DecisionConfiguration['baseUrl']): { ok: true; url: URL | undefined } | { ok: false; resolution: DecisionResolution } {
  let url: URL | undefined;
  if (base) {
    try { url = new URL(base); } catch { return { ok: false, resolution: unavailable('TYPESAFE_BASE_URL must be an absolute HTTPS URL.') }; }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return { ok: false, resolution: unavailable('TYPESAFE_BASE_URL must be HTTPS without credentials, query, or fragment.') };
    }
  }
  return { ok: true, url };
}

function selectDecisionProvider(settings: DecisionConfiguration, explicit: DecisionConfiguration['provider'], url: URL | undefined): { ok: true; provider: Provider; urlProvider: Provider | undefined } | { ok: false; resolution: DecisionResolution } {
  const names = Object.keys(PROVIDERS) as Provider[];
  const urlProvider = url && names.find(name => new URL(PROVIDERS[name].base).origin === url.origin);
  if (explicit && urlProvider && explicit !== urlProvider) {
    return { ok: false, resolution: unavailable('JEV_CODE_PROVIDER conflicts with TYPESAFE_BASE_URL.') };
  }
  const configured = names.filter(name => settings.apiKeys[PROVIDERS[name].key]);
  const target = (explicit as Provider | undefined) || urlProvider;
  if (!target && configured.length !== 1) {
    return {
      ok: false, resolution: unavailable(configured.length ? 'Multiple decision providers configured; select JEV_CODE_PROVIDER.'
        : 'Export TYPESAFE_API_KEY, OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY to enable decisions.',
        configured.length ? undefined : 'credentials-missing')
    };
  }
  const provider = target || configured[0];
  return { ok: true, provider, urlProvider };
}

function resolveDecisionCredentials(settings: DecisionConfiguration, provider: Provider, url: URL | undefined, urlProvider: Provider | undefined): { ok: true; apiKey: string } | { ok: false; resolution: DecisionResolution } {
  const config = PROVIDERS[provider];
  const explicit = settings.provider;
  const ownKey = settings.apiKeys[config.key];
  const apiKey = ownKey || settings.apiKeys.TYPESAFE_API_KEY;
  if (!apiKey) { return { ok: false, resolution: unavailable('The selected decision provider has no compatible API key.', 'credentials-missing') }; }
  if (url && !urlProvider && ownKey && config.key !== 'TYPESAFE_API_KEY' && !explicit) {
    return { ok: false, resolution: unavailable('A host-specific key requires JEV_CODE_PROVIDER before following a custom proxy.') };
  }
  return { ok: true, apiKey };
}

/** Only operator configuration is an authority; never accepts repository configuration. */
export function resolveDecisionProvider(settings: DecisionConfiguration): DecisionResolution {
  const explicit = settings.provider;
  if (explicit && !Object.hasOwn(PROVIDERS, explicit)) {
    return unavailable('JEV_CODE_PROVIDER must select typesafe, openrouter, or vercel for this adapter.');
  }
  const parsedUrl = parseDecisionUrl(settings.baseUrl);
  if (!parsedUrl.ok) { return parsedUrl.resolution; }
  const url = parsedUrl.url;
  const selection = selectDecisionProvider(settings, explicit, url);
  if (!selection.ok) { return selection.resolution; }
  const { provider, urlProvider } = selection;
  const config = PROVIDERS[provider];
  const credentials = resolveDecisionCredentials(settings, provider, url, urlProvider);
  if (!credentials.ok) { return credentials.resolution; }
  const apiKey = credentials.apiKey;
  const timeoutMs = settings.timeoutMs ? Number(settings.timeoutMs) : 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    return unavailable('JEV_CODE_TIMEOUT_MS must be an integer between 1 and 120000.');
  }
  const model = settings.model || config.model;
  const base = url?.href || config.base;
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') { end -= 1; }
  return {
    route: { provider, apiKey, model, endpoint: `${base.slice(0, end)}/v1/systemone`, timeoutMs },
    availability: { status: 'available', provider, model },
  };
}
