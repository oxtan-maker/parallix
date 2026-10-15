/** Public boundary for the deliberate JavaScript web-manifest build glue. */
export const WEB_CONTENT_TYPES: readonly (readonly [RegExp, string])[];
export function writeWebManifest(webDir: string): void;
