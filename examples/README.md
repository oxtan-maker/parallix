# Parallix Examples

These examples use the provisional `px` runner from inside a **caller-supplied**
target repository. They contain no fixed workstation paths, no sibling worktree
names, no npm global install directory, no local registry URL, and they copy no
`parallix/` source into the target repo.

In every command below:

- `PARALLIX_DIR` is the directory holding the parallix runtime when running
  `node "$PARALLIX_DIR/px.js"` directly.
- `TARGET_REPO` is a repository path **you** supply, then `cd` into before
  running `px`.

## Read-only environment check

Runs `verify-env` which answers "Can I use this repo?" with an explicit verdict:

```sh
cd "$TARGET_REPO"
node "$PARALLIX_DIR/px.js" verify-env
```

On a healthy repo the output ends with `[PASS] Environment verdict: USABLE`.
On a blocked repo (e.g. invalid `workflow.config.json`) it exits 1 and prints `[FAIL] Environment verdict: NOT USABLE` followed by remediation steps.

## Record a mission review event (writes only under the target repo)

```sh
cd "$TARGET_REPO"
node "$PARALLIX_DIR/px.js" review-event my-slug --type human_note --actor reviewer \
  --content "example note" --skip-git
```

## Runnable smoke

`run-verify-env-smoke.sh` creates a throwaway target repo with `mktemp -d`,
runs `verify-env` against it, and cleans up. It takes the parallix directory as
an optional first argument (defaults to the directory containing this package's
`px.js`):

```sh
./run-verify-env-smoke.sh                 # uses the bundled px.js
./run-verify-env-smoke.sh /path/to/parallix/workflow
```

## Enterprise tarball transfer smoke

`run-enterprise-tarball-workflow-smoke.sh` proves the enterprise transfer shape:
it packs `parallix/` with `npm pack` into a throwaway transfer dir, then
`npm install -g`s the tarball into an **isolated** global prefix (via
`npm_config_prefix`, so it never touches the machine's real global install) and
drives a throwaway target repo through `config`, `status`, `draft`, `handoff`,
and `review-event` using the resulting `px` command. It asserts exactly one `px`
is installed and that its `px.js` lives in the global prefix — never inside the
target repo or mission worktree — then cleans up after itself:

```sh
./run-enterprise-tarball-workflow-smoke.sh
```

See `../README.md` for the canonical packaging and install commands.
