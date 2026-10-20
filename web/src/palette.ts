/**
 * The operator-board design authority: palette, semantic surfaces and the
 * spacing, radius, tracking and type scales, transcribed from the design
 * authority (`Parallix Board GPU.dc.html` in the reference acceptance
 * artifact). Values are literal so the rendered board matches the reference.
 *
 * One authority, one set of steps: board, card, lane and modal surfaces name a
 * token instead of re-picking a near-identical pixel value. When a surface used
 * a value between two steps it moved to the nearest step, so drift stays at or
 * under 2px and no text step went down. Values that are layout geometry rather
 * than design rhythm — column and rail widths, lane minimums, control hit areas,
 * chart dimensions, dialog widths and card separation — stay literal at the component that owns
 * them, because changing them changes what fits on screen rather than how
 * tightly the surface reads.
 *
 * Three literal color groups stay outside this authority on purpose, and each
 * is decoration or an outside identity rather than board design rhythm: the fan
 * chrome gradients and inset shadows in `fan.tsx`, the reference grille slats in
 * `flight-column.tsx`, and the agent-family brand accents in `format.ts` (a
 * family color belongs to the family, not to the board). The scrollbar thumb
 * radius in `style.css` is literal because the audited reference treatment is
 * asserted against that exact value.
 *
 * Green is a reserved meaning, not a general-purpose accent: it marks only a
 * control the operator can act on now (`action-button.tsx`, the create-mission
 * submit) and a gate the server reports as passed (`GATE_COLOR`). Progress,
 * liveness, completion and review outcomes use the other accents, so a green
 * mark on the board always answers the question "what can I do, or did the gate
 * pass?" and never "how far along is this?".
 */
export const C = {
  page: 'radial-gradient(120% 80% at 50% 0%,#12151a 0%,#08090b 70%)',
  panel: '#0b0e11',
  card: '#101419',
  cardHead: 'linear-gradient(180deg,#1b2027 0%,#141920 100%)',
  cardFoot: '#0d1115',
  idleCard: 'linear-gradient(180deg,#141920,#101419)',
  log: '#08090b',
  rule: '#1b2128',
  cardEdge: '#232a31',
  headEdge: '#2a323a',
  pill: '#0f1216',
  /** A pressed or open control surface — one step above the pill, below text. */
  controlOn: '#141a20',
  /** A chart lane with no status of its own. */
  chartLane: '#33404b',
  text: '#c9d2d9',
  muted: '#8b97a1',
  /** Secondary text also passes after the shipped card group opacity (0.75). */
  dim: '#a4b0b9',
  faint: '#98a5af',
  /** Decorative strokes and fills; never informational text. */
  stroke: '#3f4a53',
  /** Reserved: an enabled affirmative action and a passed gate, nothing else. */
  green: '#5ee08a',
  greenEdge: '#2c4735',
  greenFill: '#15211a',
  cyan: '#6fd0e8',
  /** The cyan partner of the green fill/edge pair for a selected or evidenced surface. */
  cyanEdge: '#27495a',
  cyanFill: '#12222a',
  amber: '#e8b84b',
  red: '#e2604e',
  purple: '#c489e0',
  /** A mission the server has shipped: a recorded fact, not an available action. */
  done: '#6aa8e8',
  /** A chart band for the earliest lane; one step under `chartLane`, no status. */
  chartQuiet: '#243039',
} as const;

/**
 * The review attempt budget. A review round spends one of a fixed number of
 * attempts; it is not progress toward the goal, so it borrows none of the
 * reserved success green. Each state is named by a glyph and a sentence as well
 * as a hue, so the distinction survives greyscale, a screen reader and a
 * colorblind operator. The hues are the board's existing non-success accents:
 * cyan for a recorded approval, amber for a recorded request for changes,
 * purple (the review family) for the attempt in hand.
 */
export const REVIEW = {
  approved: C.cyan,
  changesRequested: C.amber,
  current: C.purple,
  /** A recorded disposition the board has no glyph of its own for. */
  recorded: C.dim,
  /** A past attempt the server records no disposition for. */
  unknown: C.faint,
  /** An attempt the server has not reached: an outline with no mark. */
  approvedFill: 'rgba(111,208,232,.16)',
  changesRequestedFill: 'rgba(232,184,75,.14)',
} as const;

/** The reference's root type treatment: mono body, condensed display heads. */
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const DISPLAY = "'Barlow Condensed', 'Arial Narrow', ui-sans-serif, system-ui, sans-serif";

/**
 * The rendered type ladder, largest to smallest. It is a hierarchy contract,
 * not a set of exact sizes: a surface picks the step for the role its text
 * plays, so a dialog title always reads above body text and metadata reads
 * below it. Migration never moved text to a smaller step than it already had.
 * Compact metadata shares the metadata step to preserve the readable 11px floor. The only sub-11px mark on the card is
 * the aria-hidden 8px actor dot: a decorative glyph, not a text step.
 */
export const TYPE = {
  /** The board wordmark — the only display-face heading at this step. */
  display: 19,
  /** Dialog and modal titles. */
  title: 18,
  /** Lane headings, card titles and section heads. */
  heading: 13,
  /** The one large figure in a metrics panel — above the section head it labels. */
  figure: 15,
  /** Prose a reader has to read: dialog copy, form fields, evidence rows. */
  body: 12,
  /** Secondary prose and control labels: next action, counts, log lines. */
  meta: 11,
  /** Compact readable metadata: chips, flags, timestamps and agent tags. */
  micro: 11,
} as const;

/** Letter-spacing steps for the condensed display face and for micro labels. */
export const TRACK = {
  /** Micro labels, flags and control labels. */
  tight: 0.5,
  /** Pills and agent tags. */
  normal: 1,
  /** Lane and rail headings in the display face. */
  display: 2,
  /** The wordmark. */
  mark: 3,
} as const;

/**
 * The spacing rhythm. `xs`/`sm` are inline gaps and chip padding, `md` is a
 * card's inner padding and row gap, `lg` is a card's outer padding and dialog
 * rhythm, `xl` is the board gutter, `xxl` is page-level padding outside a
 * region. A value between two steps takes the nearest step.
 */
export const SPACE = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 11,
  xl: 14,
  xxl: 18,
} as const;

/** Corner radii by role. A chip is not a card and neither is a pill control. */
export const RADIUS = {
  chip: 2,
  control: 4,
  card: 6,
  panel: 8,
  pill: 20,
} as const;

/**
 * Semantic modal surfaces. A dialog has no palette of its own: it takes the
 * board's card/edge/text tokens and the board's own status accents, so a
 * checkpoint or history dialog reads as the same product as the lane behind it.
 * Status meaning is unchanged — these are surfaces, not facts. The accent is
 * cyan, not green: a selected control, an evidence row and a live pane say
 * "this one is picked out", not "this passed", and green stays reserved for the
 * actions and gates that actually mean that.
 */
export const MODAL = {
  scrim: 'rgba(0,0,0,.6)',
  surface: C.card,
  edge: C.cardEdge,
  text: C.text,
  muted: C.muted,
  faint: C.faint,
  /** The board's selection accent, used for a selected control or evidence. */
  accent: C.cyan,
  accentFill: C.cyanFill,
  accentEdge: C.cyanEdge,
  /** A neutral control inside a dialog. */
  controlEdge: C.headEdge,
  /** The inset behind a form field — darker than the dialog surface. */
  field: C.log,
  /** An interrupted or partial state, never a success. */
  warning: C.amber,
  shadow: '0 12px 36px rgba(0,0,0,.6)',
} as const;

/**
 * The destructive surface, kept as its own semantic group rather than folded
 * into MODAL. Cancellation deletes lifecycle rows, so its panel and its delete
 * control carry a red family of their own. This is a deliberate exception to
 * "one palette": `C.red` stays the blocked/failed status accent, and nothing
 * here changes what a status means — it only marks an irreversible action.
 */
export const DANGER = {
  surface: '#1d1112',
  edge: '#7a2f2f',
  text: '#e0b7b7',
  /** The delete control itself. */
  fill: '#3a1618',
  controlEdge: '#a83c3c',
  controlText: '#f0a0a0',
} as const;
