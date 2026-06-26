# Mission: Purge qwen and make opencode model-aware in stats (task-1290)

## Goal

Remove `qwen` as a runtime and product-facing agent-family label everywhere except possibly in tests and factual legacy fixtures that still need it for coverage. Replace it with a better family name for the `opencode` path, and make sure the actual model id used by `opencode` is captured in stats so operators can compare model experiments over time. The product should not guess that a weird model name means "custom" or "Qwen"; it should record the exact model and its provenance.

## Why Now

- `qwen` is a footgun. It is a specific model family name, but in this codebase it has been overloaded to mean "the opencode path", which invites hallucinated assumptions and makes the product harder to explain.
- Operators using local or custom `opencode` setups need stats that show which exact model ran, because they will switch models often and need to evaluate outcomes across those runs.
- The current design already has model plumbing in places, but the product contract is still too fuzzy. This mission makes the identity model explicit and removes the ambiguous family name from the runtime surface.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: eliminate qwen as a runtime alias, preserve exact model ids in stats, make opencode experiments comparable, remove hallucination-prone naming

## Scope

### In scope

- `config/agents.json`
  Replace `qwen` as the agent-family key used for eligibility and selection with the chosen non-Qwen family label for the opencode path. Update all step eligibility arrays to use the new family name.
- `lib/agents/`
  Update launcher selection, resume handling, fallback handling, and telemetry hooks so the renamed family still launches `opencode` correctly and records the exact configured model when one exists.
- `lib/core/product-config.js`
  Adjust model resolution so the configured model id is treated as first-class data for the selected family, not as a Qwen-shaped special case.
- `lib/commands/stats.js`
  Ensure stats rows capture the actual model id used by `opencode` and preserve it for reporting, instead of collapsing the row back to a family label when a model is configured.
- `docs/agents.md`, `docs/operator-setup.md`, `README.md`
  Remove user-facing `qwen` naming from workflow and setup documentation, and document `opencode` and the model field in a way that makes custom-model usage obvious.
- `lib/core/fmt.js`, `test/fmt.test.js`
  Update the displayed family label so the public label is not `qwen`, and keep the tests aligned with the new name.
- `test/`
  Update or add tests so the renamed family, launcher behavior, and stats model recording are verified end-to-end. Tests may keep factual `qwen` fixtures only when they are explicitly validating migration or legacy compatibility.

### Out of scope

- Leaving `qwen` in runtime family selection, launcher routing, eligibility config, or public docs after the migration is complete.
- Changing the `opencode` binary name or the fact that operators can still type `opencode` in config and user-facing input.
- Guessing whether a strange model name is "custom" based on its string shape.
- Reworking unrelated workflow behavior that does not affect family renaming, model provenance, or stats.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `config/agents.json` no longer uses `qwen` as the runtime family key for any step eligibility array.
2. User-facing docs in `docs/agents.md`, `docs/operator-setup.md`, and `README.md` no longer present `qwen` as the public name of the opencode path.
3. `lib/core/fmt.js` no longer renders `qwen` as the display label for the opencode family, and `test/fmt.test.js` asserts the replacement label.
4. `lib/agents/opencode.js` still launches `opencode` with an optional `-m <model>` override, and the selected model comes from config or telemetry provenance rather than from a Qwen-specific rule.
5. `lib/agents/opencode-telemetry.js` preserves the exact model id returned by `opencode export` when present, and falls back cleanly when the export does not include a model.
6. `lib/commands/stats.js` records the actual model id for `opencode` runs so repeated experiments with different models remain distinguishable in weekly and mission stats.
7. The launcher, review, and integration paths continue to work end-to-end with the renamed family, including resume behavior, fallback selection, telemetry capture, and stats recording.
8. `npm test` passes with zero failures after the migration.
9. The final diff is limited to the runtime rename, model/stats plumbing, the directly affected docs, and the updated tests unless a verified compatibility fix requires a narrow expansion.

## Risks and Assumptions

- Risk: removing `qwen` from runtime selection can ripple through review fallback, stats rollups, and mission docs if any path still expects the old family name. Mitigation: update the family name consistently instead of leaving compatibility aliases in user-facing code.
- Risk: stats can become misleading if they still collapse the model back to the family label. Mitigation: store the exact model id from config or telemetry as first-class data.
- Risk: tests and fixtures may still need `qwen` in order to prove the migration or legacy compatibility. Mitigation: keep those cases explicit and quarantined to tests where needed.
- Assumption: the best product shape is a single `opencode`-backed family name with explicit model provenance, not an overloaded `qwen` alias.

## Checkpoints

- CP 1: Naming migration planned.
  Identify every runtime, doc, and stats use of `qwen` and mark it as delete, migrate, or preserve only for tests/factual fixtures.
- CP 2: Runtime family renamed.
  The opencode path uses the new family label everywhere in eligibility, launch, resume, fallback, and display code.
- CP 3: Model provenance recorded.
  Stats rows and telemetry preserve the actual model id used by `opencode`.
- CP 4: Docs aligned.
  The operator docs and README describe `opencode` without exposing `qwen` as the public family name.
- CP 5: Verification clean.
  `npm test` passes and the diff reflects the migration cleanly.

## Gates

- [ ] `npm test` passes with zero failures.
- [ ] `git diff --name-only` stays within the scoped files unless the migration forces an additional documented file.
- [ ] Manual audit confirms `qwen` is gone from runtime family selection and public docs, except for any test-only legacy cases.
- [ ] Manual audit confirms stats capture the exact `opencode` model id.

## Restricted Areas

- Do not leave a compatibility alias for `qwen` in production runtime selection just to avoid touching tests.
- Do not drop model ids from stats or telemetry for the sake of simplifying the family rename.
- Do not rewrite historical fixtures unless they need to prove the migration or preserve a test case.

## Stop Rules

- Stop if the rename cannot be completed without leaving `qwen` as a production runtime alias; that means the migration needs a different design.
- Stop if stats cannot preserve exact model ids without a broader schema change that should be modeled explicitly.
- Stop if `npm test` fails for unrelated reasons outside the migration scope.
