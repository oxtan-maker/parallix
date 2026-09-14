# ADR 0058: github-publish mode decouples verification from publication

- Status: **Accepted**
- Date: 2026-09-08
- Related: ADR 0041 (integration pipeline gates), ADR 0045 (parallix branch model), ADR 0048 (fail-closed harness defense)

## Context

The existing local integration mode squash-merges each mission onto the local
primary branch. When GitHub verification runs before that integration, it
verifies a candidate that is replaced by the locally generated integration
commit. The verified SHA therefore never reaches `main`, and waiting for GitHub
also serializes development behind CI latency.

We want the exact, locally-generated integration commit to become the commit
GitHub independently verifies **before** that commit is allowed to advance
remote `main`. Local development keeps integrating at full speed; GitHub
verifies each resulting commit asynchronously. This requires choosing where to
publish an unverified commit, who owns the final merge, and whether later local
integrations may proceed while an earlier commit is still being verified.

## Place in the configurable integration model

The 2500 wave makes integration authority a repository choice rather than a
single global workflow. The modes are alternatives for different operating
conditions; `github-publish` does not supersede the other two.

| Mode | Best fit | Final integration authority | GitHub on development critical path | Commit identity on remote target | Principal tradeoff |
|---|---|---|---|---|---|
| `local` | Offline or GitHub-independent development | Parallix | No | Local integration commit; no GitHub attestation | Fastest and simplest, but GitHub supplies no publication trust boundary |
| `github-publish` | Single-developer, high-throughput trunk | Parallix after external verification | No | Exact locally generated integration SHA | Preserves throughput and identity, but publication is ordered and later green commits can be blocked |
| `github-pr` | Collaborative repositories governed by GitHub review policy | GitHub | **Yes** for integration onto the shared target | GitHub may create a merge, squash, or rebase SHA | Supports collaboration and conventional protection, but GitHub latency slows the integration cadence that subsequent single-developer work builds upon |

Repositories select one mode explicitly; absence preserves `local`. Invalid or
unsupported values fail closed. Shared GitHub verification can serve both
GitHub-aware modes, but the evidence and merge authority remain mode-specific.
For a single developer, `github-pr` puts comparatively slow GitHub checks and
merge processing between completed work and the updated target branch used by
later missions. `github-publish` exists chiefly to remove that latency from the
local integration path without giving up external verification before remote
publication.

## Publication designs considered

| Option | Exact integration SHA reaches `main` | Later local integrations continue during CI | Unverified commit reaches `main` | Merge authority | Cost / limitation |
|---|---|---|---|---|---|
| Per-commit verification refs, then ordered fast-forward | Yes | Yes | No | Parallix | Requires durable per-commit state and blocks publication behind the first pending or failed commit |
| Run required local gates, then push directly to `main` | Yes | Yes | No, under the local gate policy | Parallix | Keeps the existing locally enforced trust boundary, but outsiders cannot inspect independent verification evidence before the commit lands |
| Verify one candidate branch before integrating it locally | Yes, if the candidate is later fast-forwarded | **No** | No | Parallix | Preserves trust but puts GitHub latency back on the development critical path |
| Submit each mission through a GitHub pull request | Not necessarily; GitHub may squash or rebase | Only until later work needs the unmerged result on its target branch | No | GitHub | GitHub checks and merge latency serialize single-developer integration; collaboration and conventional branch protection justify that cost in `github-pr` |

The first option is the only one that simultaneously preserves the exact
locally generated commit, makes independent verification publicly inspectable
before publication, and lets local development continue while GitHub is slow.
The direct-push option still enforces repository-owned local gates; it lacks the
additional external evidence this mode exists to provide. The chosen option's
cost is ordered publication: a later successful commit cannot pass an earlier
pending or failed commit even when its own verification has completed.

## Decision

Adopt a **`github-publish`** publication mode that is additive to (not a
replacement for) the existing trunk-based squash-merge integration path. On
each poll the mode:

1. Publishes the exact locally-generated integration commit unchanged to a
   per-commit **verification ref** (`refs/github-publish/<sha>`), preserving the
   SHA. No GitHub-side squash/rebase/recreation, no local squash onto `main`
   for commits published under this mode.
2. Transitions the mission/commit through a durable state machine:
   `locally integrated` → `external verification pending` → `externally
   verified` or `external verification failed`.
3. Advances `origin/main` **only** through the highest contiguous run of
   `externally verified` commits that are also the direct next unpublished
   descendants of `origin/main`, using a fast-forward. Any divergence from the
   expected ancestor fails closed (no force-push).

The verification ref encodes the commit SHA. An existing ref at the same SHA is
an idempotent retry; one at a different SHA is a collision and fails closed.

### State model

Durable states (mission/commit level; no board lanes added):

- `locally integrated` — the integration commit exists locally, unpublished.
- `external verification pending` — published to the verification ref, awaiting
  operator CI result. Slow/unavailable GitHub stays here (retry), never fails.
- `externally verified` — operator CI reported success for this exact SHA.
- `published` — advanced onto `origin/main` via fast-forward.
- `external verification failed` — operator CI reported failure; blocks the
  contiguous run.

The publication invariant: `origin/main` advances only through the highest
contiguous sequence of `externally verified` local integration commits.
`P -> A -> B -> C -> D` with `A ✅ B ✅ C ❌ D ✅` may advance through B but must
NOT skip C and publish D.

### Fail-closed invariant

Advancing `origin/main` uses a fast-forward to the contiguous verified commit.
Before each push the engine re-reads `origin/main`, confirms the verified commit
is a descendant and the direct next unpublished descendant, and confirms no
unexpected remote movement (upstream fetch). Any mismatch fails closed: no
advance, explicit failure, never a non-fast-forward push. This preserves the
fail-closed invariant that protected `main` only advances through verified,
contiguous history (ADR 0048).

### History mutation boundary

The exact-SHA preservation requires that post-integration history mutations
(squash, worktree-path rewrite, noise patches) not run for commits published
under this mode. The publication engine itself never mutates a commit: it
publishes the integration commit verbatim and fast-forwards `main`, so the
SHA is preserved end to end. Post-integration transforms must therefore be
bypassed for this mode while the default local mode remains unchanged. If the
integration commit cannot be published without mutation, publication fails
closed.

## Consequences

- **Additive.** The default squash-merge integration path is untouched unless
  `github-publish` is enabled; its prior tests keep passing unchanged.
- **Contiguous advancement** bounds how far `origin/main` moves per poll and
  keeps history linear and fast-forwardable.
- **Verification oracle is injected.** Verification completion comes from
  operator-provided CI; the engine treats slow/unavailable GitHub as `pending`
  with retry, not failure.
- **Operator status command** exposes local head, published head, missions
  awaiting verification, verified-but-blocked missions, and failed verification.
- **Scope limit.** No multi-developer coordination, sharded verification, or
  distributed scheduling. Single-developer assumed; still fail-closed on remote
  divergence.
- **Head-of-line blocking.** One failed or delayed commit prevents every later
  commit from reaching remote `main`, even when those later commits are green.
  This is the accepted cost of keeping remote history contiguous and identical
  to local integration history.
- **Ref lifecycle.** Per-commit verification refs accumulate until a later
  cleanup policy removes them. Automatic cleanup is deferred because it is not
  required for safe publication.

## Reconsideration triggers

- Repositories need multiple developers to publish concurrently; use
  `github-pr` rather than weakening ordered publication.
- Sustained head-of-line blocking costs more than preserving identical local
  and remote history; choose a different integration mode explicitly.
- The verification provider can attest to an otherwise unreachable commit
  without a remote ref; the temporary publication mechanism can then be
  simplified without changing the ordering invariant.
