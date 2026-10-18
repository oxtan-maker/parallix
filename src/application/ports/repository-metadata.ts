/** Atomic snapshots of generated repository metadata, preserving file modes. */
export interface RepositoryMetadataWriter {
  writeJson(_path: string, _value: unknown, _options: { readonly mode: number }): void;
}
