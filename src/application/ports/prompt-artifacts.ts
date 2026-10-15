/** Immutable, readable worktree artifacts retained for every referencing agent's lifetime. */
export interface PromptArtifactPort {
  retain(_content: string): Promise<string>;
}
