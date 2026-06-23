# CP-2 — Draft README written; authority content extracted

## Summary

Rewrote `README.md` from the 309-line "parallix Authority Reference" operator manual into a
credible GitHub landing page, and extracted all the internal operational content into
`docs/authority-reference.md` (verbatim, with only the relative-path references corrected to
this repo's root layout and a pointer note back to the README). Nothing was deleted —
workflow modes, the authority stack table, agent selection, the layered validation model,
checkpoint model, state map + command aliases, stats, persistent operator data, and the full
public-distribution story now live in `docs/authority-reference.md`.

The new README follows the task-1336-specified structure (adopted in CP-1): a positioning
line + intro that answers the five landing-page questions in the first 300 words, then Why
Parallix? → What it does → The core workflow → Quick start → Example → Use cases → What
Parallix is not → Current status → Documentation → Development → License. The "What it does"
section has six bullets, each tied to a use case (UC-1…UC-6) with its Confirmed/Partial
confidence carried through from `docs/use-cases.md`.

All checks were verified mechanically (see Goal Check). `npm test` re-run green after the
rewrite (1603 pass / 0 fail).

## Goal Check

| Checkpoint requirement | Evidence | Status |
|---|---|---|
| All nine required sections present, in order | `README.md` `## Why Parallix?` `:21`, `## What it does` `:32`, `## The core workflow` `:43`, `## Quick start` `:57`, `## Example` `:80`, `## Use cases` `:107`, `## What Parallix is not` `:115`, `## Current status` `:122`, `## Documentation` `:133` (verified by heading-order grep) | ✅ |
| First 300 words answer "what is Parallix" | `README.md:3` ("Parallix is a local-first CLI for running several AI coding agents…") | ✅ |
| First 300 words answer "who is it for" | `README.md:5` ("built for solo maintainers and small-team leads who already drive AI coding agents") | ✅ |
| First 300 words answer "what pain" | `README.md:5` ("two agents fighting over one checkout, a run dying when a provider hits its usage cap…") | ✅ |
| First 300 words answer "why not a single agent directly" | `README.md:9` ("Why not just use Claude Code, Codex, Aider, or OpenCode directly? … Parallix is the harness around them") | ✅ |
| First 300 words answer "first concrete thing" | `README.md:11`–`:17` ("The first concrete thing you can do…" + `npm pack` / `npm install -g ./magnus-parallix-*.tgz` / `px draft`). Commands corrected and end-to-end verified in round-2 act-on-review (see CP-4 "Review round 2 resolution"). | ✅ |
| "What it does" has 5–7 bullets, each UC-tied with confidence | `README.md:36`–`:41` — 6 bullets: UC-1 Confirmed, UC-2 Confirmed, UC-3 Confirmed, UC-4 Partial, UC-5 Confirmed, UC-6 Partial | ✅ |
| No internal abstractions in first 500 words | banned-term script over first 500 words → 0 violations (authority stack / state-map / adapter internals / mode tables / config boundary / canonical markdown companion / conflict resolution) | ✅ |
| Internal authority content extracted, not deleted | `docs/authority-reference.md:1` — authority stack `:36`, mode table `:26`, command aliases `:168`, validation model `:54`, state map `:153` | ✅ |
| Gate green after rewrite | `npm test` → "pass 1603 / fail 0" (re-run, exit 0) | ✅ |

## Next action

Run the CP-3 SEO + credibility review: confirm ≥6 of 9 SEO phrases (currently 9/9 after
adding "AI coding workflow" at `README.md:31`), re-confirm no internal abstractions in the
first 500 words, and do a tone pass to ensure the page reads as a skeptical engineering
manager wrote it (no superlatives, every throughput figure carried with its erosion caveat,
UC-4/UC-6 framed as Partial). Then proceed to CP-4 final gate.
