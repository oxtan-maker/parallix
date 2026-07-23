import type { KnownRepository, RepositoryId } from '../../domain/repository.js';

export function projectRepositorySelector(repositories: readonly KnownRepository[]): KnownRepository[] {
  const unique = new Map<RepositoryId, KnownRepository>();
  for (const repository of repositories) { unique.set(repository.id, repository); }
  return [...unique.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
