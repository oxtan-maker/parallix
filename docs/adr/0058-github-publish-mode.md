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

We want the exact, locally-generated **cumulative publication tip** to become
the commit GitHub independently verifies **before** it is allowed to advance
remote `main`. Local development keeps integrating at full speed; one hosted
run verifies the resulting tree, including every earlier local integration it
contains. This requires choosing where to publish that unverified tip and who
owns the final fast-forward; it does not require a hosted run for every
intermediate local commit.

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
| Verify the cumulative publication tip, then fast-forward | Yes | Yes | No | Parallix | A failed or pending chosen tip delays publication until a later exact tip is verified |
| Run required local gates, then push directly to `main` | Yes | Yes | No, under the local gate policy | Parallix | Keeps the existing locally enforced trust boundary, but outsiders cannot inspect independent verification evidence before the commit lands |
| Verify one candidate branch before integrating it locally | Yes, if the candidate is later fast-forwarded | **No** | No | Parallix | Preserves trust but puts GitHub latency back on the development critical path |
| Submit each mission through a GitHub pull request | Not necessarily; GitHub may squash or rebase | Only until later work needs the unmerged result on its target branch | No | GitHub | GitHub checks and merge latency serialize single-developer integration; collaboration and conventional branch protection justify that cost in `github-pr` |

The first option is the only one that simultaneously preserves the exact
locally generated commit, makes independent verification publicly inspectable
before publication, and lets local development continue while GitHub is slow.
The direct-push option still enforces repository-owned local gates; it lacks the
additional external evidence this mode exists to provide. The chosen option's
cost is that the selected publication tip must finish before it can advance.

## Decision

Adopt a **`github-publish`** publication mode that is additive to (not a
replacement for) the existing trunk-based squash-merge integration path. On
each publication attempt the mode:

1. Selects the current exact locally-generated cumulative tip `D` and publishes
   it unchanged to `refs/github-publish/<D>`, preserving its SHA. No
   GitHub-side squash/rebase/recreation and no local squash onto `main` occur
   for this publication.
2. Transitions that publication attempt through a durable state machine:
   `publication pending` → `externally verified` or `external verification
   failed`.
3. After the hosted `ci-required` run succeeds for exact `D`, re-reads
   `origin/main` and fast-forwards it from the previously observed published
   ancestor `P` to `D`. Any divergence, non-descendancy, or changed tip fails
   closed (no force-push).
4. On the unchanged `main` push, reuses the durable successful Actions history
   for `github-publish/D` as release authorization. It does not repeat the
   source verification payload; it checks the prior workflow path, push event,
   exact SHA and branch, successful `ci-required` job, and completion before
   the main workflow began.

The verification ref encodes the commit SHA. An existing ref at the same SHA is
an idempotent retry; one at a different SHA is a collision and fails closed.

### State model

Durable states (publication-attempt level; no board lanes added):

- `publication pending` — the exact cumulative tip is published to its
  verification ref, awaiting hosted CI. Slow/unavailable GitHub stays here
  (retry), never becomes authorization.
- `externally verified` — `ci-required` reported success for this exact tip.
- `published` — that same SHA was advanced onto `origin/main` via fast-forward.
- `external verification failed` — the selected tip did not receive the
  required proof; another tip must be selected and verified before publication.

The publication invariant is an exact-tip invariant: with `origin/main = P`
and local history `P -> A -> B -> C -> D`, the single hosted verification of
`github-publish/D` proves the complete tree at `D`, including `A`, `B`, and
`C`. `main` may fast-forward directly from `P` to verified `D`; intermediate
commits do not need individual hosted verification records.

### Fail-closed invariant

Advancing `origin/main` uses a fast-forward from `P` to the exact verified tip
`D`. Before each push the engine re-reads `origin/main`, confirms that `P` is
unchanged and an ancestor of `D`, and confirms no unexpected remote movement.
Any mismatch fails closed: no advance, explicit failure, never a
non-fast-forward push. The subsequent main-triggered release must independently
read the durable prior Actions proof for `D`; it cannot authorize itself or a
same-named check from another workflow. If no reusable publication proof exists,
the shared release workflow runs full verification on the exact main SHA before
release. This preserves regular `github-pr` merge, squash, and rebase publication;
a PR check alone never authorizes release of a newly created main SHA. API errors
or malformed evidence block release rather than being treated as absent proof.

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
- **Cumulative-tip advancement** keeps history linear and fast-forwardable
  while allowing one externally verified tree to include many local commits.
- **Verification oracle is injected.** Verification completion comes from
  operator-provided CI; the engine treats slow/unavailable GitHub as `pending`
  with retry, not failure.
- **Operator status command** exposes local head, published head, missions
  awaiting verification, verified-but-blocked missions, and failed verification.
- **Scope limit.** No multi-developer coordination, sharded verification, or
  distributed scheduling. Single-developer assumed; still fail-closed on remote
  divergence.
- **Publication delay.** A failed or delayed selected tip delays its release,
  but later local work may be accumulated into a new exact tip and verified as
  one tree.
- **Ref lifecycle.** The temporary `github-publish/<D>` ref may be removed
  after publication. Release authorization remains valid because it reads the
  durable GitHub Actions/check history, not the ref's continued existence.

## Reconsideration triggers

- Repositories need multiple developers to publish concurrently; use
  `github-pr` rather than weakening ordered publication.
- Repeated publication-tip verification delays cost more than preserving
  identical local and remote history; choose a different integration mode
  explicitly.
- The verification provider can attest to an otherwise unreachable commit
  without a remote ref; the temporary publication mechanism can then be
  simplified without changing the ordering invariant.
