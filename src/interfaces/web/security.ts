/**
 * security.ts — fail-closed security policy for the loopback-only web host.
 *
 * ADR 0054: one origin, per-launch capability, strict Origin validation,
 * loopback-only binding. Every decision here is a pure function: host.ts
 * applies them on the transport, unit tests exercise the policy without a
 * socket, and the integration suite proves the wiring on a real loopback
 * listener. No state lives in this module.
 */

/** The only literals this host will ever bind. `localhost` is not explicit. */
export const LOOPBACK_LITERALS = ['127.0.0.1', '::1'] as const;
export type LoopbackLiteral = (typeof LOOPBACK_LITERALS)[number];

export interface LoopbackBinding {
  host: LoopbackLiteral;
  /** Actual bound port (0 until the listener reports the OS-selected one). */
  port: number;
}

export function isLoopbackHost(host: string): host is LoopbackLiteral {
  return (LOOPBACK_LITERALS as readonly string[]).includes(host);
}

/**
 * The single Host header this launch accepts. Loopback literals have no
 * case-sensitive characters, so exact equality (header lowercased) is the
 * strict check. Requiring the actual bound port means a replayed Host from
 * another port, or a DNS-rebinding name, never matches.
 */
export function expectedHostHeader(binding: LoopbackBinding): string {
  return binding.host === '::1' ? `[::1]:${binding.port}` : `127.0.0.1:${binding.port}`;
}

export function evaluateHostHeader(headerHost: string | undefined, binding: LoopbackBinding): 'ok' | 'reject' {
  if (typeof headerHost !== 'string' || headerHost.length === 0) { return 'reject'; }
  return headerHost.toLowerCase() === expectedHostHeader(binding) ? 'ok' : 'reject';
}

/** The one origin this launch serves, e.g. `http://127.0.0.1:41723`. */
export function actualOrigin(binding: LoopbackBinding): string {
  return binding.host === '::1' ? `http://[::1]:${binding.port}` : `http://127.0.0.1:${binding.port}`;
}

/**
 * Extract one cookie value from a raw Cookie header (first occurrence
 * wins). Parsing is deliberately explicit instead of delegating to a
 * framework hook, so the policy and its tests own the exact behavior.
 */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (typeof header !== 'string' || header.length === 0) { return undefined; }
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) { continue; }
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      if (value !== '') { return value; }
    }
  }
  return undefined;
}

const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

export function isReadOnlyMethod(method: string): boolean {
  return READ_ONLY_METHODS.has(method.toUpperCase());
}

export interface MutationCredentials {
  origin: string | undefined;
  sessionCookie: string | undefined;
  csrfHeader: string | undefined;
}

export type MutationDecision =
  | { result: 'ok' }
  | { result: 'reject'; reason: 'absent-origin' | 'wrong-origin' | 'absent-session' | 'wrong-session' | 'absent-csrf' | 'wrong-csrf' };

/**
 * Per-launch double-submit capability. One unguessable value is issued per
 * launch as an HttpOnly SameSite=Strict cookie and as the non-executable
 * `px-csrf` meta tag in the served shell. A state-changing request must
 * carry all three: the actual Origin, the session cookie, and the CSRF
 * header. The first absent/wrong check wins, keeping failure reporting
 * stable. GET never needs any of this.
 */
export function evaluateMutationAuthorization(
  credentials: MutationCredentials,
  origin: string,
  launchValue: string,
): MutationDecision {
  if (credentials.origin === undefined || credentials.origin === '') { return { result: 'reject', reason: 'absent-origin' }; }
  if (credentials.origin.toLowerCase() !== origin.toLowerCase()) { return { result: 'reject', reason: 'wrong-origin' }; }
  if (credentials.sessionCookie === undefined || credentials.sessionCookie === '') { return { result: 'reject', reason: 'absent-session' }; }
  if (credentials.sessionCookie !== launchValue) { return { result: 'reject', reason: 'wrong-session' }; }
  if (credentials.csrfHeader === undefined || credentials.csrfHeader === '') { return { result: 'reject', reason: 'absent-csrf' }; }
  if (credentials.csrfHeader !== launchValue) { return { result: 'reject', reason: 'wrong-csrf' }; }
  return { result: 'ok' };
}

/**
 * Bounded bodies: a numeric content-length within the limit. Absent length
 * (chunked) is 411, malformed is 400, over the limit is 413. host.ts
 * applies this to state-changing methods only; read-only requests carry
 * no body in this design, and Fastify's `bodyLimit` bounds the transport.
 */
export function evaluateContentLength(
  rawLength: string | string[] | undefined,
  limitBytes: number,
): { result: 'ok' } | { result: 'reject'; status: 400 | 411 | 413 } {
  if (rawLength === undefined) { return { result: 'reject', status: 411 }; }
  const single = Array.isArray(rawLength) ? rawLength[0] : rawLength;
  const length = Number(single);
  if (!Number.isInteger(length) || length < 0) { return { result: 'reject', status: 400 }; }
  if (length > limitBytes) { return { result: 'reject', status: 413 }; }
  return { result: 'ok' };
}

/**
 * Only JSON mutations will ever exist on this host, so any state-changing
 * request must declare exactly `application/json` (an explicit charset
 * parameter is tolerated). Absent or foreign types are 415 before routing.
 */
export function evaluateContentType(
  method: string,
  contentType: string | undefined,
): { result: 'ok' } | { result: 'reject'; status: 415 } {
  if (isReadOnlyMethod(method)) { return { result: 'ok' }; }
  if (typeof contentType !== 'string' || contentType.length === 0) { return { result: 'reject', status: 415 }; }
  const baseType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return baseType === 'application/json' ? { result: 'ok' } : { result: 'reject', status: 415 };
}

export interface AssetManifestEntry {
  size: number;
  contentType: string;
}

/**
 * Relative path under the asset root → entry. The allowlist is the
 * authority: a path is servable only if it appears here verbatim. (Asset
 * sha256/size integrity is verified at load time by the adapter; serving
 * only needs the content type and size.)
 */
export type AssetManifest = Record<string, AssetManifestEntry>;

export type AssetResolution =
  | { result: 'ok'; relativePath: string; contentType: string; size: number }
  | { result: 'reject'; status: 400 | 404 };

/**
 * Map a request URL path to exactly one manifest entry. One percent-decode,
 * then structural rejection: backslash, NUL, control characters, and any
 * `.`/`..`/empty segment. Decoding exactly once means double-encoded
 * traversal (e.g. `%252e%252e`) survives as a literal segment that the
 * segment check or the manifest lookup rejects — there is no second decode
 * pass. A path only exists if the manifest names it verbatim, so traversal
 * and unlisted files 400/404 by construction.
 */
export function resolveAssetPath(rawUrlPath: string, manifest: AssetManifest): AssetResolution {
  if (typeof rawUrlPath !== 'string' || !rawUrlPath.startsWith('/')) { return { result: 'reject', status: 400 }; }
  let decoded: string;
  try { decoded = decodeURIComponent(rawUrlPath); } catch { return { result: 'reject', status: 400 }; }
  if (decoded.includes('\\') || decoded.includes('\0') || /[\x00-\x1f]/.test(decoded)) { return { result: 'reject', status: 400 }; }
  const segments = decoded.split('/');
  if (segments[0] !== '') { return { result: 'reject', status: 400 }; }
  const parts = segments.slice(1);
  // One trailing slash is tolerated ("/assets/" names no file, so it 404s);
  // an interior empty segment ("//") is malformed.
  if (parts.length > 0 && parts[parts.length - 1] === '') { parts.pop(); }
  if (parts.length === 0) { return { result: 'reject', status: 404 }; }
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') { return { result: 'reject', status: 400 }; }
  }
  const relativePath = parts.join('/');
  const entry = manifest[relativePath];
  if (entry === undefined) { return { result: 'reject', status: 404 }; }
  return { result: 'ok', relativePath, contentType: entry.contentType, size: entry.size };
}
