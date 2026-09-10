# CP-6: The contract in the summary, and a demo that keeps its colours

Two operator findings on the round-2 delivery:

1. The summary named the contract path but not its content, so learning what the
   mission commits an implementer to still meant opening a pager.
2. The rendered demo GIF was monochrome.

## The contract digest

`px draft` now closes with the Goal and the contract's shape:

```text
[PASS] Drafted parallix-adhoc-0001 in 23s: fix hello world greeting (parallix-adhoc-0001)
  contract  .../missions/parallix-adhoc-0001/MISSION.md
  branch    mission/parallix-adhoc-0001
  agent     custom

Goal
  Make `hello.sh` print the correct greeting. Currently it prints `Helo, Wrld!`; it must print
  `Hello, World!`.

  4 success criteria · 1 checkpoint · 1 gate · NEL Small (0–80)
```

The Goal's first paragraph, wrapped to the terminal and capped at six lines,
answers "what did it commit me to"; the counts answer "how big is it". The full
document stays one path away rather than being dumped after a minutes-long agent
run — the summary itself would have scrolled off.

`readMissionDigest` splits MISSION.md on its top-level headings rather than
matching a lookahead, because the last section of a file has no following
heading to anchor against — the first attempt silently reported zero gates.
Criteria are counted whether the contract numbers or bullets them; the scaffold's
falsifiability blockquote starts with `>` and is not counted. A missing or
malformed file yields an empty digest, never a new failure mode.

## Colour in the rendered demo

The colours were never lost from the cast (`px` still writes SGR codes, verified
in `docs/assets/first-value-demo.cast`) — the renderer dropped them, and had
always done so. Three defects, each found by looking at the rendered frames:

1. **SGR codes were stripped along with cursor control.** The renderer now keeps
   a pen (foreground colour, bold) and stores the screen as coloured cells.
2. **ImageMagick renders SVG with its own MSVG renderer, which ignores
   `font-family`.** Every frame was drawn in a proportional face, so no column
   arithmetic could line up — a probe of 50 `M` glyphs measures 648 px against
   150 px for 50 `i` glyphs under an explicit `DejaVu-Sans-Mono` request. Frames
   are now drawn with ImageMagick's text primitives, which honour `-font`, and
   the glyph advance is measured at startup rather than derived from font
   metrics.
3. **Bold was rendered as a bold face**, which advances differently from the
   regular face and reopened the alignment gaps. Bold is now a brighter
   foreground, which is what a terminal's bold reads as anyway.

The GIF's palette went from 16 to 64 colours to carry the terminal palette.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC18: summary carries the Goal and the contract's shape | `"px draft prints the contract goal and its shape so no pager is needed"`, `"px draft counts bullet-style success criteria too"`, `"px draft summary survives a contract with no Goal section"`, `test/draft.test.ts` | PASS |
| SC19: rendered demo keeps colour and monospaced columns | `node scripts/render-first-value-demo.mjs`; `docs/assets/first-value-demo.gif` frames show the `[INFO]`/branch/path colouring in aligned columns | PASS |
| SC17: demo re-recorded against this tree | `./scripts/record-first-value-demo.sh` (exit 0); the recorded draft phase ends with the digest above | PASS |
| Earlier criteria unaffected | `"px draft default output ends with a mission summary naming px active"`, `"px draft default output omits every internal-plumbing line"`, `"px draft emits the worktree as the shell-init cd signal"`, `test/draft.test.ts` | PASS |
| Verification gate green on the final tree | `./scripts/verify-local.sh all` | PASS |
| Lint, typecheck, test-hygiene clean | `./scripts/verify-local.sh static-analysis` | PASS |
