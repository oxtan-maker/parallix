Run the execute workflow mode as described in `parallix/README.md`.

Claude-specific additions only:
- mission slug argument: `$ARGUMENTS`
- keep the mission worktree outside the repo directory at `../<project>-$ARGUMENTS`
- treat this command as a thin launcher, not a second specification
