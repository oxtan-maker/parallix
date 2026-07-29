/**
 * Intake traceability for material that originates in another system.
 *
 * ADR 0053 excludes external task catalogs as aggregates: Parallix stores only
 * a reference to the material it accepted, never a second lifecycle authority.
 * `ExternalTaskRef` is therefore a value object carried on `Mission` — it has
 * no lifecycle, no status, and no transitions of its own.
 */

export type ExternalTaskSource = string & { readonly __brand: 'ExternalTaskSource' };
export type ExternalTaskId = string & { readonly __brand: 'ExternalTaskId' };

/** One trace back to the accepted external material. */
export interface ExternalTaskRef {
  /** Owning system, e.g. `backlog`. Never a Parallix lifecycle state. */
  readonly source: ExternalTaskSource;
  /** Identifier inside the owning system. */
  readonly id: ExternalTaskId;
  /** Optional locator for the material; never its content. */
  readonly url: string | null;
}

export class ExternalTaskRefViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalTaskRefViolation';
  }
}

/** A reference is a short single-line locator; copied task content is rejected. */
const MAX_REFERENCE_LENGTH = 512;

function reference(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ExternalTaskRefViolation(`External task ${field} must not be empty`);
  }
  if (/[\r\n]/.test(normalized)) {
    throw new ExternalTaskRefViolation(
      `External task ${field} must be a reference, not embedded task content`,
    );
  }
  if (normalized.length > MAX_REFERENCE_LENGTH) {
    throw new ExternalTaskRefViolation(
      `External task ${field} exceeds ${MAX_REFERENCE_LENGTH} characters; store a reference, not the material`,
    );
  }
  return normalized;
}

export function externalTaskRef(
  source: string,
  id: string,
  url: string | null = null,
): ExternalTaskRef {
  return {
    source: reference('source', source).toLowerCase() as ExternalTaskSource,
    id: reference('id', id) as ExternalTaskId,
    url: url === null ? null : reference('url', url),
  };
}

export function sameExternalTaskRef(
  left: ExternalTaskRef | null,
  right: ExternalTaskRef | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.source === right.source && left.id === right.id && left.url === right.url;
}
