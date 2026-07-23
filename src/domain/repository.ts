export type RepositoryId = string & { readonly __brand: 'RepositoryId' };

export function repositoryId(value: string): RepositoryId {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Repository id must not be empty');
  }
  return normalized as RepositoryId;
}

/** One repository option shown by repository-selecting interfaces. */
export interface KnownRepository {
  readonly id: RepositoryId;
  readonly displayName: string;
}
