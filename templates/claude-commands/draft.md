Run the draft workflow mode as described in `parallix/README.md`.

Claude-specific additions only:
- mission slug argument: `$ARGUMENTS`
- create or use the dedicated mission worktree at `../<project>-$ARGUMENTS` (sibling of the primary repo)
- treat this command as a thin launcher, not a second draft specification
